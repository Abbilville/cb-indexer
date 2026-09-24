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
	"cb-indexer/internal/cpg"
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

	// 0.5. GET & POST /api/auth/verify (Validates token against server auth config)
	mux.HandleFunc("/api/auth/verify", func(w http.ResponseWriter, r *http.Request) {
		authRequired := authToken != ""
		authenticated := checkAuth(r, authToken)
		if authRequired && !authenticated {
			writeJSON(w, http.StatusUnauthorized, map[string]any{
				"status":        "unauthorized",
				"auth_required": true,
				"authenticated": false,
				"message":       "Invalid or missing API auth token",
			})
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"status":        "ok",
			"auth_required": authRequired,
			"authenticated": authenticated,
			"message":       "Authenticated",
		})
	})

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

		// Enrich status with CPG metrics
		cpgItems := cpg.ScanGlobalCPGCache()
		cpgMap := make(map[string]cpg.CPGCacheItem, len(cpgItems))
		for _, item := range cpgItems {
			cpgMap[strings.ToLower(item.Name)] = item
		}

		totalCpgNodes := 0
		totalCpgEdges := 0
		indexedCpgRepos := 0

		type enrichedRepo struct {
			graphmeta.RepoStatusDetail
			IsCPGIndexed bool `json:"is_cpg_indexed"`
			CPGNodes     *int `json:"cpg_nodes,omitempty"`
			CPGEdges     *int `json:"cpg_edges,omitempty"`
		}

		enrichedRepos := make([]enrichedRepo, 0, len(status.Repos))
		for _, r := range status.Repos {
			er := enrichedRepo{RepoStatusDetail: r}
			if item, exists := cpgMap[strings.ToLower(r.Name)]; exists && item.IsIndexed {
				er.IsCPGIndexed = true
				er.CPGNodes = item.Nodes
				er.CPGEdges = item.Edges
				indexedCpgRepos++
				if item.Nodes != nil {
					totalCpgNodes += *item.Nodes
				}
				if item.Edges != nil {
					totalCpgEdges += *item.Edges
				}
			}
			enrichedRepos = append(enrichedRepos, er)
		}

		cpgStat := cpg.CheckJoernStatus()

		overviewPayload := map[string]any{
			"project_id":          status.ProjectID,
			"project_name":        status.ProjectName,
			"description":         status.Description,
			"git_url":             status.GitURL,
			"source_path":         status.SourcePath,
			"total_repos":         status.TotalRepos,
			"indexed_repos":       status.IndexedRepos,
			"unindexed_repos":     status.UnindexedRepos,
			"total_nodes":         status.TotalNodes,
			"total_edges":         status.TotalEdges,
			"total_relationships": status.TotalRelationships,
			"total_cpg_nodes":     totalCpgNodes,
			"total_cpg_edges":     totalCpgEdges,
			"indexed_cpg_repos":   indexedCpgRepos,
			"cpg_status":          cpgStat,
			"relationships":       status.Relationships,
			"repos":               enrichedRepos,
			"is_all_indexed":      status.IndexedRepos == status.TotalRepos,
		}
		writeJSON(w, http.StatusOK, overviewPayload)
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
			"cpg":             cpg.CheckJoernStatus(),
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
			Repo        string `json:"repo"`
			Mode        string `json:"mode"`
			Engine      string `json:"engine"` // "ast", "cpg", or "both"
			Pull        bool   `json:"pull"`
			Persistence bool   `json:"persistence"`
		}

		if err := json.NewDecoder(r.Body).Decode(&req); err != nil && err.Error() != "EOF" {
			writeError(w, http.StatusBadRequest, "Invalid JSON body: "+err.Error())
			return
		}

		if req.RepoName == "" {
			req.RepoName = req.Repo
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
			engine := strings.ToLower(strings.TrimSpace(req.Engine))
			if engine == "" {
				engine = "both"
			}

			var res cbmwrite.RepoIndexResult
			if engine != "cpg" {
				res = cbmwrite.IndexSingleRepo(jobCtx, fullPath, repo.Name, mode, req.Persistence)
				durMs := time.Since(startTime).Milliseconds()
				Broadcast(EventMessage{
					Type:       "completed",
					ProjectID:  reg.ProjectID,
					RepoName:   repo.Name,
					Current:    1,
					Total:      1,
					Status:     res.Status,
					DurationMs: durMs,
					Message:    fmt.Sprintf("AST Indexing '%s' %s in %dms", repo.Name, res.Status, durMs),
				})
			}

			var cpgRes *cpg.CPGIndexResult
			if engine == "cpg" || engine == "both" {
				Broadcast(EventMessage{
					Type:      "started",
					ProjectID: reg.ProjectID,
					RepoName:  repo.Name,
					Current:   1,
					Total:     1,
					Status:    "indexing",
					Message:   fmt.Sprintf("Indexing CPG for '%s'...", repo.Name),
				})
				r := cpg.IndexSingleRepo(jobCtx, fullPath, repo.Name, true)
				cpgRes = &r

				// Correlate with AST if available
				if astDb, err := graphmeta.FindCbmDB(repo.Name); err == nil {
					if cpgDb, err := cpg.FindCPGDB(repo.Name); err == nil {
						_, _ = cpg.CorrelateCPGDatabase(cpgDb, astDb)
					}
				}

				Broadcast(EventMessage{
					Type:       "completed",
					ProjectID:  reg.ProjectID,
					RepoName:   repo.Name,
					Current:    1,
					Total:      1,
					Status:     cpgRes.Status,
					DurationMs: cpgRes.DurationMs,
					Message:    fmt.Sprintf("CPG indexing '%s' %s (%d nodes, %d edges) in %dms", repo.Name, cpgRes.Status, cpgRes.Nodes, cpgRes.Edges, cpgRes.DurationMs),
				})
			}

			durMs := time.Since(startTime).Milliseconds()
			var errs []string
			if res.Error != "" {
				errs = append(errs, res.Error)
			}
			if cpgRes != nil && cpgRes.Error != "" {
				errs = append(errs, "CPG: "+cpgRes.Error)
			}
			success := (engine == "cpg" && cpgRes != nil && cpgRes.Status == "success") ||
				(engine != "cpg" && res.Status == "success")

			gitwatcher.LogIndexRun(gitwatcher.IndexRunLog{
				Timestamp:  time.Now(),
				DurationMs: durMs,
				ProjectID:  reg.ProjectID,
				TotalRepos: 1,
				Indexed:    []string{repo.Name},
				Errors:     errs,
				Success:    success,
			})

			responsePayload := map[string]any{
				"status":  "completed",
				"type":    "single_repo",
				"project": reg.ProjectID,
				"engine":  engine,
			}
			if res.Name != "" {
				responsePayload["ast_result"] = res
			}
			if cpgRes != nil {
				responsePayload["cpg_result"] = cpgRes
			}
			writeJSON(w, http.StatusOK, responsePayload)
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

		engine := strings.ToLower(strings.TrimSpace(req.Engine))
		if engine == "" {
			engine = "both"
		}

		var report *cbmwrite.BatchIndexReport
		if engine != "cpg" {
			r := cbmwrite.BatchIndexProjectWithProgress(jobCtx, reg, mode, req.Persistence, func(current, total int, repoName, status, errStr string, durMs int64) {
				Broadcast(EventMessage{
					Type:       "progress",
					ProjectID:  reg.ProjectID,
					RepoName:   repoName,
					Current:    current,
					Total:      total,
					Status:     status,
					DurationMs: durMs,
					Message:    fmt.Sprintf("[%d/%d AST] %s: %s", current, total, repoName, status),
				})
			})
			report = &r
		}

		var cpgReport *cpg.BatchIndexReport
		if engine == "cpg" || engine == "both" {
			r := cpg.BatchIndexProjects(jobCtx, reg, true, func(current, total int, repoName, status string, durMs int64) {
				Broadcast(EventMessage{
					Type:       "progress",
					ProjectID:  reg.ProjectID,
					RepoName:   repoName,
					Current:    current,
					Total:      total,
					Status:     "cpg_" + status,
					DurationMs: durMs,
					Message:    fmt.Sprintf("[%d/%d CPG] %s: %s (%dms)", current, total, repoName, status, durMs),
				})
			})
			cpgReport = &r

			// Correlate AST and CPG databases for each repo
			for _, r := range reg.Repos {
				if astDb, err := graphmeta.FindCbmDB(r.Name); err == nil {
					if cpgDb, err := cpg.FindCPGDB(r.Name); err == nil {
						_, _ = cpg.CorrelateCPGDatabase(cpgDb, astDb)
					}
				}
			}
		}

		totalDurMs := time.Since(startTime).Milliseconds()
		var indexedList []string
		var errorList []string
		if report != nil {
			for _, r := range report.Results {
				if r.Status == "success" {
					indexedList = append(indexedList, r.Name)
				} else if r.Error != "" {
					errorList = append(errorList, fmt.Sprintf("%s (AST): %s", r.Name, r.Error))
				}
			}
		}
		if cpgReport != nil {
			for _, r := range cpgReport.Results {
				if r.Status == "success" {
					if report == nil {
						indexedList = append(indexedList, r.Name)
					}
				} else if r.Error != "" {
					errorList = append(errorList, fmt.Sprintf("%s (CPG): %s", r.Name, r.Error))
				}
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

		completedCount := 0
		if report != nil {
			completedCount = report.Successful
		} else if cpgReport != nil {
			completedCount = cpgReport.Successful
		}

		Broadcast(EventMessage{
			Type:       "completed",
			ProjectID:  reg.ProjectID,
			Current:    completedCount,
			Total:      len(reg.Repos),
			Status:     "completed",
			DurationMs: totalDurMs,
			Message:    fmt.Sprintf("Completed batch index for %s (%s): %d/%d in %dms", reg.Name, engine, completedCount, len(reg.Repos), totalDurMs),
		})

		batchPayload := map[string]any{
			"status":     "completed",
			"type":       "batch",
			"project":    reg.ProjectID,
			"engine":     engine,
			"duration":   totalDurMs,
			"successful": completedCount,
		}
		if report != nil {
			batchPayload["ast_report"] = report
		}
		if cpgReport != nil {
			batchPayload["cpg_report"] = cpgReport
		}
		writeJSON(w, http.StatusOK, batchPayload)
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
			Path          string `json:"path"`
			ProjectID     string `json:"project_id"`
			OutputFile    string `json:"output_file"`
		}

		if err := json.NewDecoder(r.Body).Decode(&req); err != nil && err.Error() != "EOF" {
			writeError(w, http.StatusBadRequest, "Invalid JSON body: "+err.Error())
			return
		}

		if req.WorkspacePath == "" {
			req.WorkspacePath = req.Path
		}
		req.WorkspacePath = strings.Trim(strings.TrimSpace(req.WorkspacePath), "\"'")
		if req.WorkspacePath == "" {
			req.WorkspacePath = "."
		}

		reg, err := scanner.ScanWorkspace(req.WorkspacePath, req.ProjectID)
		if err != nil {
			writeError(w, http.StatusBadRequest, "Scan failed: "+err.Error())
			return
		}

		outPath := req.OutputFile
		if outPath == "" {
			outPath = filepath.Join(req.WorkspacePath, "registry.yaml")
		}

		saved, err := registry.SaveRegistry(reg, outPath)
		if err != nil {
			// Fallback: If target directory is read-only or inaccessible, save to user config directory
			fallbackDir := filepath.Join(registry.GetUserConfigDir(), "projects")
			_ = os.MkdirAll(fallbackDir, 0755)
			fallbackPath := filepath.Join(fallbackDir, reg.ProjectID+".yaml")
			savedFallback, fbErr := registry.SaveRegistry(reg, fallbackPath)
			if fbErr != nil {
				writeError(w, http.StatusInternalServerError, "Failed to save registry: "+err.Error())
				return
			}
			saved = savedFallback
		}

		writeJSON(w, http.StatusOK, map[string]any{
			"status":        "success",
			"registry_path": saved,
			"project_id":    reg.ProjectID,
			"total_repos":   len(reg.Repos),
			"repos_count":   len(reg.Repos),
			"repos":         reg.Repos,
			"relationships": reg.Relationships,
			"message":       fmt.Sprintf("Scan complete: found %d repositories", len(reg.Repos)),
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
			Project     string `json:"project"`
			PurgeGraphs bool   `json:"purge_graphs"`
			PurgeCpg    bool   `json:"purge_cpg"`
		}
		_ = json.NewDecoder(r.Body).Decode(&req)
		if req.ProjectID == "" {
			req.ProjectID = req.Project
		}
		if req.ProjectID == "" {
			req.ProjectID = r.URL.Query().Get("project_id")
		}
		if req.ProjectID == "" {
			req.ProjectID = r.URL.Query().Get("project")
		}
		req.ProjectID = strings.TrimSpace(req.ProjectID)

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
			// Remove manifest file to prevent ghost rediscovery in active workspace
			if reg != nil && reg.SourcePath != "" {
				_ = os.Remove(reg.SourcePath)
			}
		}

		if req.PurgeCpg || req.PurgeGraphs {
			if reg != nil {
				for _, r := range reg.Repos {
					_ = cpg.DeleteCPGDatabase(r.Name)
				}
			}
			_ = cpg.DeleteCPGDatabase(pID)
		}
		unregistered := registry.UnregisterProjectFromCatalog(pID)
		if req.ProjectID != pID {
			if registry.UnregisterProjectFromCatalog(req.ProjectID) {
				unregistered = true
			}
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"status":       "success",
			"project_id":   pID,
			"unregistered": unregistered,
		})
	})

	// 7. GET /api/browse-dirs?path=... (Directory listing for in-app IDE folder explorer)
	mux.HandleFunc("/api/browse-dirs", func(w http.ResponseWriter, r *http.Request) {
		if !checkAuth(r, authToken) {
			writeError(w, http.StatusUnauthorized, "Unauthorized")
			return
		}
		targetPath := strings.Trim(strings.TrimSpace(r.URL.Query().Get("path")), "\"'")
		if targetPath == "" {
			targetPath = "."
		}
		abs, err := filepath.Abs(targetPath)
		if err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		abs = filepath.Clean(abs)

		entries, err := os.ReadDir(abs)
		if err != nil {
			writeError(w, http.StatusBadRequest, "Cannot read directory: "+err.Error())
			return
		}

		showHidden := r.URL.Query().Get("show_hidden") == "true"
		var dirs []string
		for _, e := range entries {
			if e.IsDir() {
				name := e.Name()
				if !showHidden && strings.HasPrefix(name, ".") {
					continue
				}
				dirs = append(dirs, name)
			}
		}

		parent := filepath.Dir(abs)
		if parent == abs {
			parent = ""
		}

		var drives []string
		if runtime.GOOS == "windows" {
			for _, letter := range "ABCDEFGHIJKLMNOPQRSTUVWXYZ" {
				dPath := string(letter) + ":\\"
				if _, err := os.Stat(dPath); err == nil {
					drives = append(drives, dPath)
				}
			}
		}

		writeJSON(w, http.StatusOK, map[string]any{
			"current": abs,
			"parent":  parent,
			"dirs":    dirs,
			"drives":  drives,
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

		var req struct {
			Path string `json:"path"`
		}
		_ = json.NewDecoder(r.Body).Decode(&req)
		initPath := req.Path
		if initPath == "" {
			initPath = r.URL.Query().Get("path")
		}
		initPath = strings.Trim(strings.TrimSpace(initPath), "\"'")

		var selectedPath string
		var err error

		switch runtime.GOOS {
		case "windows":
			psScript := `$code = @"
using System;
using System.IO;
using System.Runtime.InteropServices;

public class NativeFolderBrowser {
    [DllImport("shell32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern int SHCreateItemFromParsingName(
        [MarshalAs(UnmanagedType.LPWStr)] string pszPath,
        IntPtr pbc,
        ref Guid riid,
        [MarshalAs(UnmanagedType.Interface)] out object ppv);

    [ComImport]
    [Guid("DC1C5A9C-E88A-4dde-A5A1-60F82A20AEF7")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IFileDialog {
        [PreserveSig] int Show(IntPtr parent);
        void SetFileTypes();
        void SetFileTypeIndex();
        void GetFileTypeIndex();
        void Advise();
        void Unadvise();
        void SetOptions(uint fos);
        void GetOptions(out uint fos);
        void SetDefaultFolder(object psi);
        void SetFolder(object psi);
        void GetFolder(out object ppsi);
        void GetCurrentSelection(out object ppsi);
        void SetFileName([MarshalAs(UnmanagedType.LPWStr)] string pszName);
        void GetFileName([MarshalAs(UnmanagedType.LPWStr)] out string pszName);
        void SetTitle([MarshalAs(UnmanagedType.LPWStr)] string pszTitle);
        void SetOkButtonLabel([MarshalAs(UnmanagedType.LPWStr)] string pszText);
        void SetFileNameLabel([MarshalAs(UnmanagedType.LPWStr)] string pszLabel);
        void GetResult(out IShellItem ppsi);
    }

    [ComImport]
    [Guid("42f85136-db7e-439c-85f1-e4075d135fc8")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IFileOpenDialog : IFileDialog {}

    [ComImport]
    [Guid("43826D1E-E718-42EE-BC55-A1E261C37BFE")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface IShellItem {
        void BindToHandler();
        void GetParent();
        void GetDisplayName(uint sigdnName, [MarshalAs(UnmanagedType.LPWStr)] out string ppszName);
        void GetAttributes();
        void Compare();
    }

    [ComImport]
    [Guid("DC1C5A9C-E88A-4dde-A5A1-60F82A20AEF7")]
    [CoClass(typeof(FileOpenDialogRCW))]
    private interface NativeFileOpenDialog : IFileOpenDialog {}

    [ComImport]
    [Guid("DC1C5A9C-E88A-4dde-A5A1-60F82A20AEF7")]
    [ClassInterface(ClassInterfaceType.None)]
    [TypeLibType(TypeLibTypeFlags.FCanCreate)]
    private class FileOpenDialogRCW {}

    public static string PickFolder(string initialFolder, string title) {
        var dialog = (IFileOpenDialog)new FileOpenDialogRCW();
        uint options;
        dialog.GetOptions(out options);
        dialog.SetOptions(options | 0x20 | 0x40);
        if (!string.IsNullOrEmpty(title)) {
            dialog.SetTitle(title);
        }
        if (!string.IsNullOrEmpty(initialFolder) && Directory.Exists(initialFolder)) {
            Guid iid = new Guid("43826D1E-E718-42EE-BC55-A1E261C37BFE");
            object folderItem;
            if (SHCreateItemFromParsingName(initialFolder, IntPtr.Zero, ref iid, out folderItem) == 0) {
                dialog.SetFolder(folderItem);
            }
        }
        int hr = dialog.Show(IntPtr.Zero);
        if (hr == 0) {
            IShellItem item;
            dialog.GetResult(out item);
            string path;
            item.GetDisplayName(0x80058000 /* SIGDN_FILESYSPATH */, out path);
            return path;
        }
        return null;
    }
}
"@
Add-Type -TypeDefinition $code -Language CSharp
$p = [NativeFolderBrowser]::PickFolder($env:INIT_PATH, 'Select Project Folder')
if ($p) { [Console]::Out.Write($p) }
`
			cmd := exec.Command("powershell", "-NoProfile", "-STA", "-Command", psScript)
			if initPath != "" {
				cmd.Env = append(os.Environ(), "INIT_PATH="+initPath)
			}
			out, runErr := cmd.Output()
			if runErr == nil {
				selectedPath = strings.TrimSpace(string(out))
			} else {
				// Fallback to basic folder dialog if COM RCW throws an unexpected error
				fallbackCmd := `Add-Type -AssemblyName System.Windows.Forms; $f = New-Object System.Windows.Forms.FolderBrowserDialog; $f.Description = 'Select Project Folder'; if ($f.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::Out.Write($f.SelectedPath) }`
				fbOut, fbErr := exec.Command("powershell", "-NoProfile", "-STA", "-Command", fallbackCmd).Output()
				if fbErr == nil {
					selectedPath = strings.TrimSpace(string(fbOut))
				} else {
					err = runErr
				}
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
		if scope == "topology" || (repoParam == "" && scope != "ast" && scope != "cpg") {
			reg, err := registry.LoadRegistry(projectParam)
			if err == nil {
				status := graphmeta.CheckProjectStatus(reg)
				topoGraph := graphmeta.BuildTopologyGraph(&status)
				writeJSON(w, http.StatusOK, topoGraph)
				return
			}
		}

		// CPG Scope:
		if scope == "cpg" {
			if repoParam == "" || repoParam == "all" {
				var repoNames []string
				if reg, err := registry.LoadRegistry(projectParam); err == nil {
					for _, r := range reg.Repos {
						repoNames = append(repoNames, r.Name)
					}
				}

				cpgItems := cpg.FindAllCPGDBs(projectParam, repoNames)
				if len(cpgItems) > 0 {
					payload, err := cpg.QueryMultiCPGGraph(cpgItems, limit, labels, edgeTypes, query)
					if err == nil {
						writeJSON(w, http.StatusOK, payload)
						return
					}
				}
			}

			// Single repo CPG DB
			dbTarget := repoParam
			if dbTarget == "" {
				dbTarget = projectParam
			}
			cpgPath, err := cpg.FindCPGDB(dbTarget)
			if err != nil {
				writeError(w, http.StatusNotFound, "No CPG database found for '"+dbTarget+"'. Please trigger CPG indexing first: "+err.Error())
				return
			}

			payload, err := cpg.QueryCPGGraph(cpgPath, limit, labels, edgeTypes, query)
			if err != nil {
				writeError(w, http.StatusInternalServerError, "Failed to query CPG data: "+err.Error())
				return
			}
			writeJSON(w, http.StatusOK, payload)
			return
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
	// 11.5. GET /api/cpg/status
	mux.HandleFunc("/api/cpg/status", func(w http.ResponseWriter, r *http.Request) {
		if !checkAuth(r, authToken) {
			writeError(w, http.StatusUnauthorized, "Unauthorized")
			return
		}
		writeJSON(w, http.StatusOK, cpg.CheckJoernStatus())
	})

	// 11.6. GET /api/cpg/query (callers, callees, references, cfg, data_flow, types)
	mux.HandleFunc("/api/cpg/query", func(w http.ResponseWriter, r *http.Request) {
		if !checkAuth(r, authToken) {
			writeError(w, http.StatusUnauthorized, "Unauthorized")
			return
		}
		repo := r.URL.Query().Get("repo")
		if repo == "" {
			repo = r.URL.Query().Get("project")
		}
		if repo == "" {
			writeError(w, http.StatusBadRequest, "Missing 'repo' or 'project' parameter")
			return
		}
		dbPath, err := cpg.FindCPGDB(repo)
		if err != nil {
			writeError(w, http.StatusNotFound, "CPG database not found: "+err.Error())
			return
		}

		queryType := r.URL.Query().Get("type")
		symbol := r.URL.Query().Get("symbol")
		if symbol == "" {
			symbol = r.URL.Query().Get("target")
		}

		switch strings.ToLower(queryType) {
		case "callers":
			res, err := cpg.GetCPGCallers(dbPath, symbol)
			if err != nil {
				writeError(w, http.StatusInternalServerError, err.Error())
				return
			}
			writeJSON(w, http.StatusOK, map[string]any{"query": queryType, "symbol": symbol, "results": res})
		case "callees":
			res, err := cpg.GetCPGCallees(dbPath, symbol)
			if err != nil {
				writeError(w, http.StatusInternalServerError, err.Error())
				return
			}
			writeJSON(w, http.StatusOK, map[string]any{"query": queryType, "symbol": symbol, "results": res})
		case "references", "refs":
			res, err := cpg.GetCPGReferences(dbPath, symbol)
			if err != nil {
				writeError(w, http.StatusInternalServerError, err.Error())
				return
			}
			writeJSON(w, http.StatusOK, map[string]any{"query": queryType, "symbol": symbol, "results": res})
		case "cfg", "control_flow":
			res, err := cpg.GetCPGControlFlow(dbPath, symbol)
			if err != nil {
				writeError(w, http.StatusInternalServerError, err.Error())
				return
			}
			writeJSON(w, http.StatusOK, map[string]any{"query": queryType, "symbol": symbol, "results": res})
		case "data_flow", "dataflow":
			source := r.URL.Query().Get("source")
			if source == "" {
				source = symbol
			}
			sink := r.URL.Query().Get("sink")
			res, err := cpg.GetCPGDataFlow(dbPath, source, sink)
			if err != nil {
				writeError(w, http.StatusInternalServerError, err.Error())
				return
			}
			writeJSON(w, http.StatusOK, map[string]any{"query": queryType, "source": source, "sink": sink, "results": res})
		case "types", "type_relations":
			res, err := cpg.GetCPGTypeRelations(dbPath, symbol)
			if err != nil {
				writeError(w, http.StatusInternalServerError, err.Error())
				return
			}
			writeJSON(w, http.StatusOK, map[string]any{"query": queryType, "symbol": symbol, "results": res})
		default:
			writeError(w, http.StatusBadRequest, "Invalid query type. Supported: callers, callees, references, cfg, data_flow, types")
		}
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
			case "groq":
				apiKey = os.Getenv("GROQ_API_KEY")
			case "deepseek":
				apiKey = os.Getenv("DEEPSEEK_API_KEY")
			case "openrouter":
				apiKey = os.Getenv("OPENROUTER_API_KEY")
			case "huggingface":
				apiKey = os.Getenv("HUGGINGFACE_API_KEY")
				if apiKey == "" {
					apiKey = os.Getenv("HF_TOKEN")
				}
			case "custom":
				apiKey = os.Getenv("CUSTOM_AI_API_KEY")
				if apiKey == "" {
					apiKey = os.Getenv("DEEPSEEK_API_KEY")
				}
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
			// OpenAI or OpenAI-compatible (Groq, DeepSeek, OpenRouter, Hugging Face, Ollama, Custom)
			baseUrl := strings.TrimRight(strings.TrimSpace(req.BaseURL), "/")
			if baseUrl == "" {
				switch req.Provider {
				case "openai":
					baseUrl = "https://api.openai.com/v1"
				case "groq":
					baseUrl = "https://api.groq.com/openai/v1"
				case "deepseek":
					baseUrl = "https://api.deepseek.com/v1"
				case "openrouter":
					baseUrl = "https://openrouter.ai/api/v1"
				case "huggingface":
					baseUrl = "https://router.huggingface.co/v1"
				case "ollama":
					baseUrl = "http://localhost:11434/v1"
				default:
					baseUrl = "https://api.openai.com/v1"
				}
			}
			if req.Provider == "huggingface" && strings.Contains(baseUrl, "hf-inference") {
				baseUrl = "https://router.huggingface.co/v1"
			}
			url := fmt.Sprintf("%s/chat/completions", baseUrl)

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

	// 13. GET /api/ai/models (Auto-detect available models for a provider)
	mux.HandleFunc("/api/ai/models", func(w http.ResponseWriter, r *http.Request) {
		if !checkAuth(r, authToken) {
			writeError(w, http.StatusUnauthorized, "Unauthorized")
			return
		}
		if r.Method != http.MethodGet {
			writeError(w, http.StatusMethodNotAllowed, "Method not allowed")
			return
		}

		provider := r.URL.Query().Get("provider")
		apiKey := r.URL.Query().Get("api_key")
		baseURL := r.URL.Query().Get("base_url")

		if provider == "" {
			provider = "gemini"
		}

		models, def, err := FetchProviderModels(r.Context(), provider, apiKey, baseURL)
		if err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}

		writeJSON(w, http.StatusOK, map[string]any{
			"provider": provider,
			"models":   models,
			"default":  def,
		})
	})

	// 14. POST /api/ai/oauth/device/start (Start GitHub Device Flow for Copilot/Codex)
	mux.HandleFunc("/api/ai/oauth/device/start", func(w http.ResponseWriter, r *http.Request) {
		if !checkAuth(r, authToken) {
			writeError(w, http.StatusUnauthorized, "Unauthorized")
			return
		}
		if r.Method != http.MethodPost {
			writeError(w, http.StatusMethodNotAllowed, "Method not allowed")
			return
		}

		res, err := StartGitHubDeviceOAuth(r.Context())
		if err != nil {
			writeError(w, http.StatusBadGateway, err.Error())
			return
		}

		writeJSON(w, http.StatusOK, res)
	})

	// 15. POST /api/ai/oauth/device/poll (Poll GitHub Device Flow for token exchange)
	mux.HandleFunc("/api/ai/oauth/device/poll", func(w http.ResponseWriter, r *http.Request) {
		if !checkAuth(r, authToken) {
			writeError(w, http.StatusUnauthorized, "Unauthorized")
			return
		}
		if r.Method != http.MethodPost {
			writeError(w, http.StatusMethodNotAllowed, "Method not allowed")
			return
		}

		var req struct {
			DeviceCode string `json:"device_code"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.DeviceCode == "" {
			writeError(w, http.StatusBadRequest, "device_code is required")
			return
		}

		res, err := PollGitHubDeviceOAuth(r.Context(), req.DeviceCode)
		if err != nil {
			writeError(w, http.StatusBadGateway, err.Error())
			return
		}

		writeJSON(w, http.StatusOK, res)
	})
}

