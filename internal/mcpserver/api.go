package mcpserver

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"time"

	"cb-indexer/internal/cbmwrite"
	"cb-indexer/internal/gitwatcher"
	"cb-indexer/internal/graphmeta"
	"cb-indexer/internal/registry"
	"cb-indexer/internal/scanner"
)

var (
	indexingMutex sync.Mutex
	isIndexing    bool
)

func writeJSON(w http.ResponseWriter, status int, data any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(data)
}

func writeError(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, map[string]string{"error": message})
}

// corsMiddleware adds standard CORS headers for development/standalone clients.
func corsMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-API-Key")

		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

// checkAuth validates token if OSS_INDEXER_AUTH_TOKEN is configured.
func checkAuth(r *http.Request, authToken string) bool {
	if authToken == "" {
		return true
	}
	authHeader := r.Header.Get("Authorization")
	if authHeader == "Bearer "+authToken || r.Header.Get("X-API-Key") == authToken {
		return true
	}
	// Also allow ?token= parameter for convenient browser testing
	if r.URL.Query().Get("token") == authToken {
		return true
	}
	return false
}

// RegisterRESTEndpoints registers JSON REST endpoints on the provided ServeMux.
func RegisterRESTEndpoints(mux *http.ServeMux, authToken string) {
	// 0. GET /api/events (Server-Sent Events stream for real-time progress)
	mux.HandleFunc("/api/events", HandleSSE)

	// 1. GET /api/projects
	mux.HandleFunc("/api/projects", func(w http.ResponseWriter, r *http.Request) {
		if !checkAuth(r, authToken) {
			writeError(w, http.StatusUnauthorized, "Unauthorized")
			return
		}
		if r.Method != http.MethodGet {
			writeError(w, http.StatusMethodNotAllowed, "Method not allowed")
			return
		}

		available := registry.ListAvailableProjects()
		cached := graphmeta.ScanGlobalCbmCache()

		writeJSON(w, http.StatusOK, map[string]any{
			"registered_projects":           available,
			"indexed_codebase_memory_graphs": cached,
			"total_registered_projects":     len(available),
			"total_indexed_graphs":          len(cached),
		})
	})

	// 2. GET /api/overview
	mux.HandleFunc("/api/overview", func(w http.ResponseWriter, r *http.Request) {
		if !checkAuth(r, authToken) {
			writeError(w, http.StatusUnauthorized, "Unauthorized")
			return
		}
		if r.Method != http.MethodGet {
			writeError(w, http.StatusMethodNotAllowed, "Method not allowed")
			return
		}

		projectParam := r.URL.Query().Get("project")
		if projectParam == "" {
			avail := registry.ListAvailableProjects()
			if len(avail) > 0 {
				projectParam = avail[0].ProjectID
			}
		}

		reg, err := registry.LoadRegistry(projectParam)
		if err != nil {
			// If not found, return empty fallback rather than hard 500
			writeJSON(w, http.StatusOK, map[string]any{
				"project_id":     projectParam,
				"project_name":   "No Active Project",
				"description":    "No registry.yaml found. Use the Scan or Onboard feature to discover repositories.",
				"total_repos":    0,
				"indexed_repos":  0,
				"repos":          []any{},
				"relationships":  []any{},
				"is_all_indexed": false,
			})
			return
		}

		status := graphmeta.CheckProjectStatus(reg)
		writeJSON(w, http.StatusOK, status)
	})

	// 3. GET /api/status
	mux.HandleFunc("/api/status", func(w http.ResponseWriter, r *http.Request) {
		if !checkAuth(r, authToken) {
			writeError(w, http.StatusUnauthorized, "Unauthorized")
			return
		}
		if r.Method != http.MethodGet {
			writeError(w, http.StatusMethodNotAllowed, "Method not allowed")
			return
		}

		projectParam := r.URL.Query().Get("project")
		if projectParam == "" {
			avail := registry.ListAvailableProjects()
			if len(avail) > 0 {
				projectParam = avail[0].ProjectID
			}
		}
		daemonStatus := gitwatcher.CheckIndexStatus(projectParam)

		indexingMutex.Lock()
		indexingActive := isIndexing
		indexingMutex.Unlock()

		writeJSON(w, http.StatusOK, map[string]any{
			"daemon":          daemonStatus,
			"is_indexing":     indexingActive,
			"server_time":     time.Now().Format(time.RFC3339),
			"active_projects": daemonStatus.ActiveProjects,
		})
	})

	// 4. POST /api/trigger
	mux.HandleFunc("/api/trigger", func(w http.ResponseWriter, r *http.Request) {
		if !checkAuth(r, authToken) {
			writeError(w, http.StatusUnauthorized, "Unauthorized")
			return
		}
		if r.Method != http.MethodPost {
			writeError(w, http.StatusMethodNotAllowed, "Method not allowed")
			return
		}

		var req struct {
			Project     string `json:"project"`
			RepoName    string `json:"repo_name"`
			Mode        string `json:"mode"`
			Pull        bool   `json:"pull"`
			Persistence bool   `json:"persistence"`
		}

		if err := json.NewDecoder(r.Body).Decode(&req); err != nil && err.Error() != "EOF" {
			writeError(w, http.StatusBadRequest, "Invalid JSON body: "+err.Error())
			return
		}

		indexingMutex.Lock()
		if isIndexing {
			indexingMutex.Unlock()
			writeError(w, http.StatusConflict, "Indexing job already in progress")
			return
		}
		isIndexing = true
		indexingMutex.Unlock()

		defer func() {
			indexingMutex.Lock()
			isIndexing = false
			indexingMutex.Unlock()
		}()

		mode := req.Mode
		if mode == "" {
			mode = "moderate"
		}

		targetProject := req.Project
		if targetProject == "" {
			avail := registry.ListAvailableProjects()
			if len(avail) > 0 {
				targetProject = avail[0].ProjectID
			}
		}

		reg, err := registry.LoadRegistry(targetProject)
		if err != nil {
			writeError(w, http.StatusBadRequest, "Failed to load project registry: "+err.Error())
			return
		}

		jobCtx, jobCancel := context.WithTimeout(context.Background(), 30*time.Minute)
		defer jobCancel()
		startTime := time.Now()

		if req.RepoName != "" {
			repo := reg.GetRepo(req.RepoName)
			if repo == nil {
				writeError(w, http.StatusNotFound, fmt.Sprintf("Repo '%s' not found in registry", req.RepoName))
				return
			}
			baseDir := ""
			if reg.SourcePath != "" {
				baseDir = filepath.Dir(reg.SourcePath)
			}
			fullPath := repo.LocalPath
			if fullPath != "" && !filepath.IsAbs(fullPath) && baseDir != "" {
				fullPath = filepath.Join(baseDir, fullPath)
			}

			Broadcast(EventMessage{
				Type:      "started",
				ProjectID: reg.ProjectID,
				RepoName:  repo.Name,
				Current:   1,
				Total:     1,
				Status:    "indexing",
				Message:   fmt.Sprintf("Indexing '%s'...", repo.Name),
			})

			if req.Pull {
				if _, err := gitwatcher.GitPull(jobCtx, fullPath); err != nil {
					Broadcast(EventMessage{
						Type:      "log",
						ProjectID: reg.ProjectID,
						RepoName:  repo.Name,
						Status:    "warning",
						Message:   fmt.Sprintf("Git pull '%s' failed: %v", repo.Name, err),
					})
				}
			}
			res := cbmwrite.IndexSingleRepo(jobCtx, fullPath, repo.Name, mode, req.Persistence)
			durMs := time.Since(startTime).Milliseconds()

			Broadcast(EventMessage{
				Type:       "completed",
				ProjectID:  reg.ProjectID,
				RepoName:   repo.Name,
				Current:    1,
				Total:      1,
				Status:     res.Status,
				DurationMs: durMs,
				Message:    fmt.Sprintf("Indexing '%s' %s in %dms", repo.Name, res.Status, durMs),
			})

			var errs []string
			if res.Error != "" {
				errs = append(errs, res.Error)
			}
			gitwatcher.LogIndexRun(gitwatcher.IndexRunLog{
				Timestamp:  time.Now(),
				DurationMs: durMs,
				ProjectID:  reg.ProjectID,
				TotalRepos: 1,
				Indexed:    []string{repo.Name},
				Errors:     errs,
				Success:    res.Status == "success",
			})

			writeJSON(w, http.StatusOK, map[string]any{
				"status":  "completed",
				"type":    "single_repo",
				"result":  res,
				"project": reg.ProjectID,
			})
			return
		}

		Broadcast(EventMessage{
			Type:      "started",
			ProjectID: reg.ProjectID,
			Total:     len(reg.Repos),
			Status:    "indexing",
			Message:   fmt.Sprintf("Starting batch indexing for %s (%d repos)...", reg.Name, len(reg.Repos)),
		})

		if req.Pull {
			baseDir := ""
			if reg.SourcePath != "" {
				baseDir = filepath.Dir(reg.SourcePath)
			}
			if baseDir != "" {
				if _, err := gitwatcher.GitPull(jobCtx, baseDir); err != nil {
					Broadcast(EventMessage{
						Type:      "log",
						ProjectID: reg.ProjectID,
						Status:    "warning",
						Message:   fmt.Sprintf("Git pull root repository failed: %v", err),
					})
				}
			}
			for _, repo := range reg.Repos {
				fullPath := repo.LocalPath
				if fullPath != "" && !filepath.IsAbs(fullPath) && baseDir != "" {
					fullPath = filepath.Join(baseDir, fullPath)
				}
				if fullPath != "" && fullPath != baseDir {
					if _, err := gitwatcher.GitPull(jobCtx, fullPath); err != nil {
						Broadcast(EventMessage{
							Type:      "log",
							ProjectID: reg.ProjectID,
							RepoName:  repo.Name,
							Status:    "warning",
							Message:   fmt.Sprintf("Git pull '%s' failed: %v", repo.Name, err),
						})
					}
				}
			}
		}

		report := cbmwrite.BatchIndexProjectWithProgress(jobCtx, reg, mode, req.Persistence, func(current, total int, repoName, status, errStr string, durMs int64) {
			Broadcast(EventMessage{
				Type:       "progress",
				ProjectID:  reg.ProjectID,
				RepoName:   repoName,
				Current:    current,
				Total:      total,
				Status:     status,
				DurationMs: durMs,
				Message:    fmt.Sprintf("[%d/%d] %s: %s", current, total, repoName, status),
			})
		})

		totalDurMs := time.Since(startTime).Milliseconds()

		var indexedList []string
		var errorList []string
		for _, r := range report.Results {
			if r.Status == "success" {
				indexedList = append(indexedList, r.Name)
			} else if r.Error != "" {
				errorList = append(errorList, fmt.Sprintf("%s: %s", r.Name, r.Error))
			}
		}

		gitwatcher.LogIndexRun(gitwatcher.IndexRunLog{
			Timestamp:  time.Now(),
			DurationMs: totalDurMs,
			ProjectID:  reg.ProjectID,
			TotalRepos: len(reg.Repos),
			Indexed:    indexedList,
			Errors:     errorList,
			Success:    len(errorList) == 0,
		})

		Broadcast(EventMessage{
			Type:       "completed",
			ProjectID:  reg.ProjectID,
			Current:    report.Successful,
			Total:      len(reg.Repos),
			Status:     "completed",
			DurationMs: totalDurMs,
			Message:    fmt.Sprintf("Completed batch index for %s: %d/%d successful in %dms", reg.Name, report.Successful, len(reg.Repos), totalDurMs),
		})

		writeJSON(w, http.StatusOK, map[string]any{
			"status":  "completed",
			"type":    "batch",
			"report":  report,
			"project": reg.ProjectID,
		})
	})

	// 5. POST /api/scan
	mux.HandleFunc("/api/scan", func(w http.ResponseWriter, r *http.Request) {
		if !checkAuth(r, authToken) {
			writeError(w, http.StatusUnauthorized, "Unauthorized")
			return
		}
		if r.Method != http.MethodPost {
			writeError(w, http.StatusMethodNotAllowed, "Method not allowed")
			return
		}

		var req struct {
			WorkspacePath string `json:"workspace_path"`
			ProjectID     string `json:"project_id"`
			OutputFile    string `json:"output_file"`
		}

		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeError(w, http.StatusBadRequest, "Invalid JSON body: "+err.Error())
			return
		}

		if req.WorkspacePath == "" {
			req.WorkspacePath = "."
		}

		reg, err := scanner.ScanWorkspace(req.WorkspacePath, req.ProjectID)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "Scan failed: "+err.Error())
			return
		}

		outPath := req.OutputFile
		if outPath == "" {
			outPath = filepath.Join(req.WorkspacePath, "registry.yaml")
		}

		saved, err := registry.SaveRegistry(reg, outPath)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "Failed to save registry: "+err.Error())
			return
		}

		writeJSON(w, http.StatusOK, map[string]any{
			"status":        "success",
			"registry_path": saved,
			"project_id":    reg.ProjectID,
			"repos_count":   len(reg.Repos),
			"repos":         reg.Repos,
			"relationships": reg.Relationships,
		})
	})

	// 6. POST /api/project/remove (or DELETE /api/projects)
	mux.HandleFunc("/api/project/remove", func(w http.ResponseWriter, r *http.Request) {
		if !checkAuth(r, authToken) {
			writeError(w, http.StatusUnauthorized, "Unauthorized")
			return
		}
		if r.Method != http.MethodPost && r.Method != http.MethodDelete {
			writeError(w, http.StatusMethodNotAllowed, "Method not allowed")
			return
		}

		var req struct {
			ProjectID   string `json:"project_id"`
			PurgeGraphs bool   `json:"purge_graphs"`
		}
		_ = json.NewDecoder(r.Body).Decode(&req)
		if req.ProjectID == "" {
			req.ProjectID = r.URL.Query().Get("project")
		}

		if req.ProjectID == "" {
			writeError(w, http.StatusBadRequest, "project_id is required")
			return
		}

		reg, _ := registry.LoadRegistry(req.ProjectID)
		pID := req.ProjectID
		if reg != nil {
			pID = reg.ProjectID
		}

		ctx := r.Context()
		if req.PurgeGraphs {
			if reg != nil {
				_ = cbmwrite.PurgeProjectGraphs(ctx, reg)
			} else {
				_ = cbmwrite.DeleteIndexedGraph(ctx, pID)
			}
		}

		unregistered := registry.UnregisterProjectFromCatalog(pID)
		writeJSON(w, http.StatusOK, map[string]any{
			"status":       "success",
			"project_id":   pID,
			"unregistered": unregistered,
		})
	})

	// 7. GET /api/browse-dirs?path=... (Directory listing fallback)
	mux.HandleFunc("/api/browse-dirs", func(w http.ResponseWriter, r *http.Request) {
		if !checkAuth(r, authToken) {
			writeError(w, http.StatusUnauthorized, "Unauthorized")
			return
		}
		targetPath := r.URL.Query().Get("path")
		if targetPath == "" {
			targetPath = "."
		}
		abs, err := filepath.Abs(targetPath)
		if err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		entries, err := os.ReadDir(abs)
		if err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		var dirs []string
		for _, e := range entries {
			if e.IsDir() && !strings.HasPrefix(e.Name(), ".") {
				dirs = append(dirs, e.Name())
			}
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"current": abs,
			"parent":  filepath.Dir(abs),
			"dirs":    dirs,
		})
	})

	// 8. POST & GET /api/browse-folder (Opens native folder picker dialog in OS explorer)
	mux.HandleFunc("/api/browse-folder", func(w http.ResponseWriter, r *http.Request) {
		if !checkAuth(r, authToken) {
			writeError(w, http.StatusUnauthorized, "Unauthorized")
			return
		}
		if r.Method != http.MethodPost && r.Method != http.MethodGet {
			writeError(w, http.StatusMethodNotAllowed, "Method not allowed")
			return
		}

		var selectedPath string
		var err error

		switch runtime.GOOS {
		case "windows":
			psCmd := `Add-Type -AssemblyName System.Windows.Forms; $f = New-Object System.Windows.Forms.FolderBrowserDialog; $f.Description = 'Select Project Folder'; $f.ShowNewFolderButton = $true; if ($f.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::Out.Write($f.SelectedPath) }`
			cmd := exec.Command("powershell", "-NoProfile", "-STA", "-Command", psCmd)
			out, runErr := cmd.Output()
			if runErr == nil {
				selectedPath = strings.TrimSpace(string(out))
			} else {
				err = runErr
			}
		case "darwin":
			cmd := exec.Command("osascript", "-e", `POSIX path of (choose folder with prompt "Select Project Folder")`)
			out, runErr := cmd.Output()
			if runErr == nil {
				selectedPath = strings.TrimSpace(string(out))
			} else {
				err = runErr
			}
		default:
			cmd := exec.Command("zenity", "--file-selection", "--directory", "--title=Select Project Folder")
			out, runErr := cmd.Output()
			if runErr == nil {
				selectedPath = strings.TrimSpace(string(out))
			} else {
				err = runErr
			}
		}

		if selectedPath == "" {
			if err != nil {
				writeJSON(w, http.StatusOK, map[string]any{
					"status":  "error",
					"message": err.Error(),
				})
				return
			}
			writeJSON(w, http.StatusOK, map[string]any{
				"status": "cancelled",
			})
			return
		}

		cleanPath := filepath.Clean(selectedPath)
		writeJSON(w, http.StatusOK, map[string]any{
			"status": "success",
			"path":   cleanPath,
		})
	})

	// 9. GET /api/rag/search (Remote AST symbol search across indexed SQLite graphs)
	mux.HandleFunc("/api/rag/search", func(w http.ResponseWriter, r *http.Request) {
		if !checkAuth(r, authToken) {
			writeError(w, http.StatusUnauthorized, "Unauthorized")
			return
		}
		if r.Method != http.MethodGet {
			writeError(w, http.StatusMethodNotAllowed, "Method not allowed")
			return
		}

		query := r.URL.Query().Get("q")
		repo := r.URL.Query().Get("repo")
		label := r.URL.Query().Get("label")
		limitStr := r.URL.Query().Get("limit")

		limit := 25
		if limitStr != "" {
			if l, err := strconv.Atoi(limitStr); err == nil && l > 0 {
				limit = l
			}
		}

		symbols, err := graphmeta.SearchGlobalSymbols(query, repo, label, limit)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "Search failed: "+err.Error())
			return
		}

		writeJSON(w, http.StatusOK, map[string]any{
			"status":  "success",
			"query":   query,
			"repo":    repo,
			"label":   label,
			"total":   len(symbols),
			"symbols": symbols,
		})
	})

	// 10. GET /api/rag/context (Remote source code snippet slice for symbol context)
	mux.HandleFunc("/api/rag/context", func(w http.ResponseWriter, r *http.Request) {
		if !checkAuth(r, authToken) {
			writeError(w, http.StatusUnauthorized, "Unauthorized")
			return
		}
		if r.Method != http.MethodGet {
			writeError(w, http.StatusMethodNotAllowed, "Method not allowed")
			return
		}

		projectParam := r.URL.Query().Get("project")
		repoName := r.URL.Query().Get("repo")
		filePath := r.URL.Query().Get("file")
		startStr := r.URL.Query().Get("start")
		endStr := r.URL.Query().Get("end")
		paddingStr := r.URL.Query().Get("padding")

		if repoName == "" || filePath == "" {
			writeError(w, http.StatusBadRequest, "repo and file parameters are required")
			return
		}

		startLine := 1
		if startStr != "" {
			if s, err := strconv.Atoi(startStr); err == nil && s > 0 {
				startLine = s
			}
		}
		endLine := startLine + 30
		if endStr != "" {
			if e, err := strconv.Atoi(endStr); err == nil && e >= startLine {
				endLine = e
			}
		}
		padding := 3
		if paddingStr != "" {
			if p, err := strconv.Atoi(paddingStr); err == nil && p >= 0 {
				padding = p
			}
		}

		if projectParam == "" {
			avail := registry.ListAvailableProjects()
			if len(avail) > 0 {
				projectParam = avail[0].ProjectID
			}
		}

		reg, err := registry.LoadRegistry(projectParam)
		if err != nil {
			writeError(w, http.StatusBadRequest, "Failed to load project: "+err.Error())
			return
		}

		repo := reg.GetRepo(repoName)
		if repo == nil {
			writeError(w, http.StatusNotFound, fmt.Sprintf("Repository '%s' not found in project '%s'", repoName, reg.ProjectID))
			return
		}

		baseDir := ""
		if reg.SourcePath != "" {
			baseDir = filepath.Dir(reg.SourcePath)
		}
		absRepoPath := repo.LocalPath
		if absRepoPath != "" && !filepath.IsAbs(absRepoPath) && baseDir != "" {
			absRepoPath = filepath.Join(baseDir, absRepoPath)
		}

		snippet, err := graphmeta.GetCodeSnippet(absRepoPath, filePath, startLine, endLine, padding)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "Failed to read code snippet: "+err.Error())
			return
		}
		snippet.Project = repo.Name

		writeJSON(w, http.StatusOK, map[string]any{
			"status":  "success",
			"project": reg.ProjectID,
			"repo":    repo.Name,
			"context": snippet,
		})
	})

	// 11. GET /api/graph (2D & 3D Knowledge Graph & Topology endpoint)
	mux.HandleFunc("/api/graph", func(w http.ResponseWriter, r *http.Request) {
		if !checkAuth(r, authToken) {
			writeError(w, http.StatusUnauthorized, "Unauthorized")
			return
		}
		if r.Method != http.MethodGet {
			writeError(w, http.StatusMethodNotAllowed, "Method not allowed")
			return
		}

		projectParam := r.URL.Query().Get("project")
		repoParam := r.URL.Query().Get("repo")
		scope := r.URL.Query().Get("scope") // "ast" or "topology"
		query := r.URL.Query().Get("q")
		limitStr := r.URL.Query().Get("limit")
		labelsParam := r.URL.Query().Get("labels")
		typesParam := r.URL.Query().Get("types")

		limit := 250
		if limitStr != "" {
			if l, err := strconv.Atoi(limitStr); err == nil && l > 0 {
				limit = l
			}
		}

		var labels []string
		if labelsParam != "" {
			for _, l := range strings.Split(labelsParam, ",") {
				if trimmed := strings.TrimSpace(l); trimmed != "" {
					labels = append(labels, trimmed)
				}
			}
		}

		var edgeTypes []string
		if typesParam != "" {
			for _, t := range strings.Split(typesParam, ",") {
				if trimmed := strings.TrimSpace(t); trimmed != "" {
					edgeTypes = append(edgeTypes, trimmed)
				}
			}
		}

		if projectParam == "" {
			avail := registry.ListAvailableProjects()
			if len(avail) > 0 {
				projectParam = avail[0].ProjectID
			}
		}

		// Topology scope:
		if scope == "topology" || (repoParam == "" && scope != "ast") {
			reg, err := registry.LoadRegistry(projectParam)
			if err == nil {
				status := graphmeta.CheckProjectStatus(reg)
				topoGraph := graphmeta.BuildTopologyGraph(&status)
				writeJSON(w, http.StatusOK, topoGraph)
				return
			}
		}

		// AST Scope:
		if repoParam == "" || repoParam == "all" {
			var repoNames []string
			if reg, err := registry.LoadRegistry(projectParam); err == nil {
				for _, r := range reg.Repos {
					repoNames = append(repoNames, r.Name)
				}
			}

			dbItems := graphmeta.FindAllCbmDBs(projectParam, repoNames)
			if len(dbItems) > 0 {
				payload, err := graphmeta.QueryMultiGraphData(dbItems, limit, labels, edgeTypes, query)
				if err == nil {
					writeJSON(w, http.StatusOK, payload)
					return
				}
			}
		}

		// Single repo AST DB
		dbTarget := repoParam
		if dbTarget == "" {
			dbTarget = projectParam
		}
		dbPath, err := graphmeta.FindCbmDB(dbTarget)
		if err != nil {
			// Fallback: If no AST DB exists, return topology graph instead of failing
			if reg, regErr := registry.LoadRegistry(projectParam); regErr == nil {
				status := graphmeta.CheckProjectStatus(reg)
				topoGraph := graphmeta.BuildTopologyGraph(&status)
				writeJSON(w, http.StatusOK, topoGraph)
				return
			}
			writeError(w, http.StatusNotFound, "No graph database found: "+err.Error())
			return
		}

		payload, err := graphmeta.QueryGraphData(dbPath, limit, labels, edgeTypes, query)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "Failed to query graph data: "+err.Error())
			return
		}
		writeJSON(w, http.StatusOK, payload)
	})

	// 12. GET /api/ai/credentials (Detect active AI harness / environment credentials)
	mux.HandleFunc("/api/ai/credentials", func(w http.ResponseWriter, r *http.Request) {
		if !checkAuth(r, authToken) {
			writeError(w, http.StatusUnauthorized, "Unauthorized")
			return
		}
		if r.Method != http.MethodGet {
			writeError(w, http.StatusMethodNotAllowed, "Method not allowed")
			return
		}

		var detected []map[string]any
		home, _ := os.UserHomeDir()

		// 1. Google Gemini
		if os.Getenv("GEMINI_API_KEY") != "" || os.Getenv("GOOGLE_API_KEY") != "" {
			detected = append(detected, map[string]any{
				"provider":  "gemini",
				"name":      "Google Gemini",
				"source":    "System Environment",
				"available": true,
				"detail":    "Active GEMINI_API_KEY / GOOGLE_API_KEY detected in environment",
			})
		} else if _, err := os.Stat(filepath.Join(home, ".config", "gcloud", "application_default_credentials.json")); err == nil {
			detected = append(detected, map[string]any{
				"provider":  "gemini",
				"name":      "Google Gemini",
				"source":    "Google Cloud ADC / gcloud auth",
				"available": true,
				"detail":    "Google Cloud Application Default Credentials detected",
			})
		}

		// 2. Anthropic Claude
		if os.Getenv("ANTHROPIC_API_KEY") != "" || os.Getenv("CLAUDE_API_KEY") != "" {
			detected = append(detected, map[string]any{
				"provider":  "claude",
				"name":      "Anthropic Claude",
				"source":    "System Environment",
				"available": true,
				"detail":    "Active ANTHROPIC_API_KEY detected in environment",
			})
		} else if stat, err := os.Stat(filepath.Join(home, ".claude.json")); err == nil && !stat.IsDir() {
			detected = append(detected, map[string]any{
				"provider":  "claude",
				"name":      "Anthropic Claude",
				"source":    "Claude Code CLI Session (~/.claude.json)",
				"available": true,
				"detail":    "Claude Code subscription / CLI session detected",
			})
		}

		// 3. OpenAI / Codex / Copilot
		if os.Getenv("OPENAI_API_KEY") != "" {
			detected = append(detected, map[string]any{
				"provider":  "openai",
				"name":      "OpenAI / Codex",
				"source":    "System Environment",
				"available": true,
				"detail":    "Active OPENAI_API_KEY detected in environment",
			})
		} else if stat, err := os.Stat(filepath.Join(home, ".config", "github-copilot")); err == nil && stat.IsDir() {
			detected = append(detected, map[string]any{
				"provider":  "openai",
				"name":      "OpenAI / Copilot",
				"source":    "GitHub Copilot CLI Session",
				"available": true,
				"detail":    "GitHub Copilot authentication detected",
			})
		}

		// 4. DeepSeek / Custom
		if os.Getenv("DEEPSEEK_API_KEY") != "" {
			detected = append(detected, map[string]any{
				"provider":  "custom",
				"name":      "DeepSeek",
				"source":    "System Environment",
				"available": true,
				"detail":    "Active DEEPSEEK_API_KEY detected in environment",
			})
		}

		// 5. Ollama Local Host
		ollamaHost := os.Getenv("OLLAMA_HOST")
		if ollamaHost == "" {
			ollamaHost = "http://localhost:11434"
		}
		detected = append(detected, map[string]any{
			"provider":  "custom",
			"name":      "Local Ollama (Oh My Pi / Offline)",
			"source":    "Localhost:11434",
			"available": true,
			"detail":    "Local Ollama / OpenAI-compatible endpoint (" + ollamaHost + ")",
		})

		writeJSON(w, http.StatusOK, map[string]any{"detected": detected})
	})

	// 12. POST /api/ai/chat (Proxy for AI chat queries with graph context)
	mux.HandleFunc("/api/ai/chat", func(w http.ResponseWriter, r *http.Request) {
		if !checkAuth(r, authToken) {
			writeError(w, http.StatusUnauthorized, "Unauthorized")
			return
		}
		if r.Method != http.MethodPost {
			writeError(w, http.StatusMethodNotAllowed, "Method not allowed")
			return
		}

		var req struct {
			Provider     string   `json:"provider"`
			AuthMode     string   `json:"auth_mode"`
			APIKey       string   `json:"api_key"`
			SessionToken string   `json:"session_token"`
			Model        string   `json:"model"`
			BaseURL      string   `json:"base_url"`
			SystemPrompt string   `json:"system_prompt"`
			Temperature  *float64 `json:"temperature"`
			Messages     []struct {
				Role    string `json:"role"`
				Content string `json:"content"`
			} `json:"messages"`
		}

		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeError(w, http.StatusBadRequest, "Invalid request body: "+err.Error())
			return
		}

		apiKey := strings.TrimSpace(req.APIKey)
		sessionToken := strings.TrimSpace(req.SessionToken)

		// Auto-detect from system environment if in harness mode or keys are empty
		if apiKey == "" && sessionToken == "" {
			switch req.Provider {
			case "gemini":
				apiKey = os.Getenv("GEMINI_API_KEY")
				if apiKey == "" {
					apiKey = os.Getenv("GOOGLE_API_KEY")
				}
			case "claude":
				apiKey = os.Getenv("ANTHROPIC_API_KEY")
				if apiKey == "" {
					apiKey = os.Getenv("CLAUDE_API_KEY")
				}
			case "openai":
				apiKey = os.Getenv("OPENAI_API_KEY")
			case "custom":
				apiKey = os.Getenv("DEEPSEEK_API_KEY")
			}
		}

		effectiveToken := apiKey
		if effectiveToken == "" {
			effectiveToken = sessionToken
		}

		ctx, cancel := context.WithTimeout(r.Context(), 90*time.Second)
		defer cancel()

		client := &http.Client{Timeout: 90 * time.Second}

		switch req.Provider {
		case "gemini":
			if effectiveToken == "" {
				writeError(w, http.StatusBadRequest, "No API Key, Google OAuth token, or GEMINI_API_KEY environment variable detected.")
				return
			}
			model := req.Model
			if model == "" {
				model = "gemini-2.5-flash"
			}
			url := fmt.Sprintf("https://generativelanguage.googleapis.com/v1beta/models/%s:generateContent?key=%s",
				model, effectiveToken)

			var contents []map[string]any
			for _, m := range req.Messages {
				role := "user"
				if m.Role == "assistant" {
					role = "model"
				}
				contents = append(contents, map[string]any{
					"role":  role,
					"parts": []map[string]string{{"text": m.Content}},
				})
			}

			payload := map[string]any{
				"systemInstruction": map[string]any{
					"parts": []map[string]string{{"text": req.SystemPrompt}},
				},
				"contents": contents,
			}
			bodyBytes, _ := json.Marshal(payload)
			httpReq, err := http.NewRequestWithContext(ctx, "POST", url, bytes.NewReader(bodyBytes))
			if err != nil {
				writeError(w, http.StatusInternalServerError, err.Error())
				return
			}
			httpReq.Header.Set("Content-Type", "application/json")

			resp, err := client.Do(httpReq)
			if err != nil {
				writeError(w, http.StatusBadGateway, err.Error())
				return
			}
			defer resp.Body.Close()

			respBytes, _ := io.ReadAll(resp.Body)
			if resp.StatusCode != http.StatusOK {
				writeError(w, resp.StatusCode, string(respBytes))
				return
			}

			var geminiResp struct {
				Candidates []struct {
					Content struct {
						Parts []struct {
							Text string `json:"text"`
						} `json:"parts"`
					} `json:"content"`
				} `json:"candidates"`
			}
			if err := json.Unmarshal(respBytes, &geminiResp); err == nil && len(geminiResp.Candidates) > 0 && len(geminiResp.Candidates[0].Content.Parts) > 0 {
				writeJSON(w, http.StatusOK, map[string]string{"response": geminiResp.Candidates[0].Content.Parts[0].Text})
				return
			}
			writeError(w, http.StatusInternalServerError, "Failed to parse Gemini response")
			return

		case "claude":
			if effectiveToken == "" {
				writeError(w, http.StatusBadRequest, "No API Key, Claude Session token, or ANTHROPIC_API_KEY environment variable detected.")
				return
			}
			model := req.Model
			if model == "" {
				model = "claude-3-5-sonnet-20241022"
			}
			url := "https://api.anthropic.com/v1/messages"
			var claudeMessages []map[string]string
			for _, m := range req.Messages {
				claudeMessages = append(claudeMessages, map[string]string{
					"role":    m.Role,
					"content": m.Content,
				})
			}

			payload := map[string]any{
				"model":      model,
				"max_tokens": 2048,
				"system":     req.SystemPrompt,
				"messages":   claudeMessages,
			}
			bodyBytes, _ := json.Marshal(payload)
			httpReq, err := http.NewRequestWithContext(ctx, "POST", url, bytes.NewReader(bodyBytes))
			if err != nil {
				writeError(w, http.StatusInternalServerError, err.Error())
				return
			}
			httpReq.Header.Set("Content-Type", "application/json")
			if sessionToken != "" {
				httpReq.Header.Set("Authorization", "Bearer "+sessionToken)
			} else {
				httpReq.Header.Set("x-api-key", effectiveToken)
			}
			httpReq.Header.Set("anthropic-version", "2023-06-01")

			resp, err := client.Do(httpReq)
			if err != nil {
				writeError(w, http.StatusBadGateway, err.Error())
				return
			}
			defer resp.Body.Close()

			respBytes, _ := io.ReadAll(resp.Body)
			if resp.StatusCode != http.StatusOK {
				writeError(w, resp.StatusCode, string(respBytes))
				return
			}

			var claudeResp struct {
				Content []struct {
					Text string `json:"text"`
				} `json:"content"`
			}
			if err := json.Unmarshal(respBytes, &claudeResp); err == nil && len(claudeResp.Content) > 0 {
				writeJSON(w, http.StatusOK, map[string]string{"response": claudeResp.Content[0].Text})
				return
			}
			writeError(w, http.StatusInternalServerError, "Failed to parse Claude response")
			return

		default:
			// OpenAI or Custom OpenAI-compatible
			baseUrl := req.BaseURL
			if baseUrl == "" {
				baseUrl = "https://api.openai.com/v1"
			}
			url := fmt.Sprintf("%s/chat/completions", strings.TrimRight(baseUrl, "/"))

			var openAiMessages []map[string]string
			if req.SystemPrompt != "" {
				openAiMessages = append(openAiMessages, map[string]string{
					"role":    "system",
					"content": req.SystemPrompt,
				})
			}
			for _, m := range req.Messages {
				openAiMessages = append(openAiMessages, map[string]string{
					"role":    m.Role,
					"content": m.Content,
				})
			}

			model := req.Model
			if model == "" {
				model = "gpt-4o"
			}
			payload := map[string]any{
				"model":    model,
				"messages": openAiMessages,
			}
			bodyBytes, _ := json.Marshal(payload)
			httpReq, err := http.NewRequestWithContext(ctx, "POST", url, bytes.NewReader(bodyBytes))
			if err != nil {
				writeError(w, http.StatusInternalServerError, err.Error())
				return
			}
			httpReq.Header.Set("Content-Type", "application/json")
			if effectiveToken != "" {
				httpReq.Header.Set("Authorization", "Bearer "+effectiveToken)
			}

			resp, err := client.Do(httpReq)
			if err != nil {
				writeError(w, http.StatusBadGateway, err.Error())
				return
			}
			defer resp.Body.Close()

			respBytes, _ := io.ReadAll(resp.Body)
			if resp.StatusCode != http.StatusOK {
				writeError(w, resp.StatusCode, string(respBytes))
				return
			}

			var openAiResp struct {
				Choices []struct {
					Message struct {
						Content string `json:"content"`
					} `json:"message"`
				} `json:"choices"`
			}
			if err := json.Unmarshal(respBytes, &openAiResp); err == nil && len(openAiResp.Choices) > 0 {
				writeJSON(w, http.StatusOK, map[string]string{"response": openAiResp.Choices[0].Message.Content})
				return
			}
			writeError(w, http.StatusInternalServerError, "Failed to parse OpenAI response")
			return
		}
	})
}

