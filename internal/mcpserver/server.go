package mcpserver

import (
	"context"
	"fmt"
	"io/fs"
	"net/http"
	"strings"

	"github.com/modelcontextprotocol/go-sdk/mcp"

	"oss-indexer/web"
)

// NewServer creates and configures the oss-indexer MCP server instance.
func NewServer() *mcp.Server {
	s := mcp.NewServer(&mcp.Implementation{
		Name:    "oss-indexer",
		Version: "0.2.0",
	}, nil)

	RegisterTools(s)
	return s
}

// ServeHTTP starts an HTTP listener exposing the MCP Streamable HTTP transport, REST API, and Web Dashboard.
func ServeHTTP(ctx context.Context, s *mcp.Server, port int, authToken string) error {
	addr := fmt.Sprintf(":%d", port)
	handler := mcp.NewStreamableHTTPHandler(func(r *http.Request) *mcp.Server {
		return s
	}, nil)

	mux := http.NewServeMux()

	// 1. MCP Streamable Transport Endpoint
	mux.HandleFunc("/mcp", func(w http.ResponseWriter, r *http.Request) {
		if authToken != "" {
			authHeader := r.Header.Get("Authorization")
			if authHeader != "Bearer "+authToken && r.Header.Get("X-API-Key") != authToken {
				http.Error(w, `{"error":"Unauthorized"}`, http.StatusUnauthorized)
				return
			}
		}
		handler.ServeHTTP(w, r)
	})

	// 2. Health Endpoint
	mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		authRequired := authToken != ""
		_, _ = w.Write([]byte(fmt.Sprintf(`{"status":"healthy","service":"oss-indexer","auth_required":%t}`, authRequired)))
	})

	// 3. REST API Endpoints for Dashboard & Standalone Clients
	RegisterRESTEndpoints(mux, authToken)

	// 4. Embedded Web Dashboard Static Asset Serving
	staticFS, err := fs.Sub(web.FS, ".")
	if err == nil {
		fileServer := http.FileServer(http.FS(staticFS))
		mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
			// Don't intercept API or MCP calls
			if strings.HasPrefix(r.URL.Path, "/api") || strings.HasPrefix(r.URL.Path, "/mcp") || strings.HasPrefix(r.URL.Path, "/health") {
				http.NotFound(w, r)
				return
			}
			if r.URL.Path == "/dashboard" {
				r.URL.Path = "/"
			}
			fileServer.ServeHTTP(w, r)
		})
	}

	server := &http.Server{
		Addr:    addr,
		Handler: corsMiddleware(mux),
	}

	go func() {
		<-ctx.Done()
		_ = server.Shutdown(context.Background())
	}()

	fmt.Printf("[oss-indexer] Dashboard UI:    http://127.0.0.1:%d/\n", port)
	fmt.Printf("[oss-indexer] MCP HTTP Server: http://127.0.0.1:%d/mcp\n", port)
	if authToken != "" {
		fmt.Printf("[oss-indexer] Auth Status:     ENABLED (API & Dashboard require token)\n")
	} else {
		fmt.Printf("[oss-indexer] Auth Status:     DISABLED (Open local development mode)\n")
	}
	if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		return err
	}
	return nil
}

// ServeStdio runs the server over standard input/output.
func ServeStdio(ctx context.Context, s *mcp.Server) error {
	return s.Run(ctx, &mcp.StdioTransport{})
}
