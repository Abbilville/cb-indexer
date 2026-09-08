package mcpserver

import (
	"context"
	"encoding/json"
	"fmt"
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
}

