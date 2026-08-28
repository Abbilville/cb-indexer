package mcpserver

import (
	"context"
	"fmt"
	"net/http"

	"github.com/modelcontextprotocol/go-sdk/mcp"
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

// ServeHTTP starts an HTTP listener exposing the MCP Streamable HTTP transport.
func ServeHTTP(ctx context.Context, s *mcp.Server, port int, authToken string) error {
	addr := fmt.Sprintf(":%d", port)
	handler := mcp.NewStreamableHTTPHandler(func(r *http.Request) *mcp.Server {
		return s
	}, nil)

	mux := http.NewServeMux()
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

	mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"status":"healthy","service":"oss-indexer"}`))
	})

	server := &http.Server{
		Addr:    addr,
		Handler: mux,
	}

	go func() {
		<-ctx.Done()
		_ = server.Shutdown(context.Background())
	}()

	fmt.Printf("[oss-indexer] Serving MCP on HTTP http://127.0.0.1:%d/mcp\n", port)
	if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		return err
	}
	return nil
}

// ServeStdio runs the server over standard input/output.
func ServeStdio(ctx context.Context, s *mcp.Server) error {
	return s.Run(ctx, &mcp.StdioTransport{})
}
