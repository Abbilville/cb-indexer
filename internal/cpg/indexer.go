package cpg

import (
	"bytes"
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	"cb-indexer/internal/registry"
)

const MissingJoernHelp = "Joern executable not found on PATH or JOERN_HOME. " +
	"Please install Joern from https://github.com/joernio/joern/releases (extract joern-cli and add to PATH) " +
	"or install Docker to run the containerized engine."

// SupportedLanguages lists languages supported by Joern and cb-indexer CPG.
var SupportedLanguages = []string{
	"c", "cpp", "java", "python", "javascript", "typescript", "go", "kotlin", "php", "csharp",
}

// FindJoernExecutable searches PATH, JOERN_HOME, and standard locations for joern or joern-parse.
func FindJoernExecutable() (parseBin string, mainBin string) {
	if custom := os.Getenv("JOERN_PARSE_PATH"); custom != "" {
		if _, err := os.Stat(custom); err == nil {
			parseBin = custom
		}
	}
	if custom := os.Getenv("JOERN_PATH"); custom != "" {
		if _, err := os.Stat(custom); err == nil {
			mainBin = custom
		}
	}

	searchDirs := filepath.SplitList(os.Getenv("PATH"))
	if jh := os.Getenv("JOERN_HOME"); jh != "" {
		searchDirs = append([]string{jh, filepath.Join(jh, "bin")}, searchDirs...)
	}

	extensions := []string{""}
	if runtime.GOOS == "windows" {
		extensions = []string{".bat", ".cmd", ".exe", ""}
	}

	for _, dir := range searchDirs {
		for _, ext := range extensions {
			if parseBin == "" {
				candidate := filepath.Join(dir, "joern-parse"+ext)
				if info, err := os.Stat(candidate); err == nil && !info.IsDir() {
					parseBin = candidate
				}
			}
			if mainBin == "" {
				candidate := filepath.Join(dir, "joern"+ext)
				if info, err := os.Stat(candidate); err == nil && !info.IsDir() {
					mainBin = candidate
				}
			}
		}
		if parseBin != "" && mainBin != "" {
			break
		}
	}

	return parseBin, mainBin
}

// CheckJoernStatus checks whether Joern is available and returns CPGStatus.
func CheckJoernStatus() CPGStatus {
	parseBin, mainBin := FindJoernExecutable()
	avail := parseBin != "" || mainBin != ""

	version := "native-fallback"
	binPath := parseBin
	if binPath == "" {
		binPath = mainBin
	}

	if binPath != "" {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		cmd := exec.CommandContext(ctx, binPath, "--version")
		var out bytes.Buffer
		cmd.Stdout = &out
		if cmd.Run() == nil {
			version = strings.TrimSpace(out.String())
		} else {
			version = "installed"
		}
	}

	cacheItems := ScanGlobalCPGCache()
	totalNodes := 0
	totalEdges := 0
	for _, item := range cacheItems {
		if item.Nodes != nil {
			totalNodes += *item.Nodes
		}
		if item.Edges != nil {
			totalEdges += *item.Edges
		}
	}

	help := ""
	if !avail {
		help = MissingJoernHelp
	}

	return CPGStatus{
		Available:      avail,
		Engine:         "joern",
		BinaryPath:     binPath,
		Version:        version,
		SupportedLangs: SupportedLanguages,
		CacheDir:       GetCPGCacheDir(),
		IndexedRepos:   len(cacheItems),
		TotalNodes:     totalNodes,
		TotalEdges:     totalEdges,
		Help:           help,
	}
}

// IndexSingleRepo indexes a single repository into a CPG SQLite database.
func IndexSingleRepo(ctx context.Context, repoPath, repoName string, force bool) CPGIndexResult {
	start := time.Now()
	absPath, err := filepath.Abs(repoPath)
	if err != nil {
		absPath = repoPath
	}

	stat, err := os.Stat(absPath)
	if err != nil || !stat.IsDir() {
		return CPGIndexResult{
			Name:       repoName,
			Path:       absPath,
			Status:     "failed",
			DurationMs: time.Since(start).Milliseconds(),
			Error:      fmt.Sprintf("repository directory does not exist: %s", absPath),
		}
	}

	normPath := filepath.ToSlash(absPath)
	dbPath := GetCPGDBPath(repoName)

	timeStr := start.Format("15:04:05")
	fmt.Printf("[%s] [cb-indexer/cpg] 🚀 Indexing CPG for '%s' (path: %s)...\n", timeStr, repoName, normPath)

	parseBin, _ := FindJoernExecutable()

	var extracted *ExtractedCPG
	var fileHashes map[string]string
	var outLogs string

	if parseBin != "" {
		// Run native Joern CLI
		tmpDir, err := os.MkdirTemp("", "cpg-export-*")
		if err == nil {
			defer os.RemoveAll(tmpDir)
			cpgBin := filepath.Join(tmpDir, "cpg.bin")
			exportDir := filepath.Join(tmpDir, "export")

			// Step 1: joern-parse <repoPath> --output <cpgBin>
			parseCtx, cancelParse := context.WithTimeout(ctx, 10*time.Minute)
			defer cancelParse()

			cmdParse := exec.CommandContext(parseCtx, parseBin, normPath, "--output", cpgBin)
			var stdout, stderr bytes.Buffer
			cmdParse.Stdout = &stdout
			cmdParse.Stderr = &stderr
			parseErr := cmdParse.Run()
			outLogs = stdout.String() + "\n" + stderr.String()

			if parseErr == nil {
				// Step 2: joern-export
				exportBin := filepath.Join(filepath.Dir(parseBin), "joern-export")
				if runtime.GOOS == "windows" {
					exportBin += ".bat"
				}
				exportCtx, cancelExport := context.WithTimeout(ctx, 5*time.Minute)
				defer cancelExport()

				cmdExport := exec.CommandContext(exportCtx, exportBin, cpgBin, "--repr", "all", "--format", "graphson", "--out", exportDir)
				if cmdExport.Run() == nil {
					extracted, _ = ParseGraphSON(exportDir, repoName)
				}
			}
		}
	}

	// Fallback analyzer if Joern was not present or didn't produce output
	if extracted == nil || len(extracted.Nodes) == 0 {
		var err error
		extracted, fileHashes, err = FallbackAnalyzeRepo(normPath, repoName)
		if err != nil {
			dur := time.Since(start).Milliseconds()
			fmt.Printf("[%s] [cb-indexer/cpg] ✗ Failed indexing '%s': %v\n", time.Now().Format("15:04:05"), repoName, err)
			return CPGIndexResult{
				Name:       repoName,
				Path:       normPath,
				Status:     "failed",
				DurationMs: dur,
				Error:      err.Error(),
			}
		}
	}

	// Persist to SQLite
	meta := CPGProjectMeta{
		Name:       repoName,
		RootPath:   normPath,
		IndexedAt:  time.Now(),
		CPGVersion: "joern-cpg-v1",
	}

	insertedNodes, insertedEdges, err := SaveCPG(ctx, dbPath, meta, extracted.Nodes, extracted.Edges, fileHashes)
	if err != nil {
		dur := time.Since(start).Milliseconds()
		return CPGIndexResult{
			Name:       repoName,
			Path:       normPath,
			Status:     "failed",
			DurationMs: dur,
			Error:      fmt.Sprintf("failed to save CPG database: %v", err),
		}
	}

	dur := time.Since(start).Milliseconds()
	nodeCount := insertedNodes
	edgeCount := insertedEdges

	fmt.Printf("[%s] [cb-indexer/cpg] ✓ Indexed '%s' (%d nodes, %d edges) in %dms\n",
		time.Now().Format("15:04:05"), repoName, nodeCount, edgeCount, dur)

	return CPGIndexResult{
		Name:       repoName,
		Path:       normPath,
		Status:     "success",
		Nodes:      nodeCount,
		Edges:      edgeCount,
		DurationMs: dur,
		Output:     outLogs,
	}
}

// BatchIndexReport holds summary of batch CPG indexing run.
type BatchIndexReport struct {
	ProjectID   string           `json:"project_id"`
	ProjectName string           `json:"project_name"`
	TotalRepos  int              `json:"total_repos"`
	Successful  int              `json:"successful"`
	Failed      int              `json:"failed"`
	TotalNodes  int              `json:"total_nodes"`
	TotalEdges  int              `json:"total_edges"`
	DurationMs  int64            `json:"duration_ms"`
	Results     []CPGIndexResult `json:"results"`
}

// BatchIndexProjects indexes all repos in a registry into CPG databases.
func BatchIndexProjects(ctx context.Context, reg *registry.ProjectRegistry, force bool, progressCb func(curr, total int, repo, status string, durMs int64)) BatchIndexReport {
	start := time.Now()
	report := BatchIndexReport{
		ProjectID:   reg.ProjectID,
		ProjectName: reg.Name,
		TotalRepos:  len(reg.Repos),
	}

	baseDir := ""
	if reg.SourcePath != "" {
		baseDir = filepath.Dir(reg.SourcePath)
	}

	for idx, repo := range reg.Repos {
		select {
		case <-ctx.Done():
			break
		default:
		}

		fullPath := repo.LocalPath
		if fullPath != "" && !filepath.IsAbs(fullPath) && baseDir != "" {
			fullPath = filepath.Join(baseDir, fullPath)
		}

		res := IndexSingleRepo(ctx, fullPath, repo.Name, force)
		report.Results = append(report.Results, res)

		if res.Status == "success" {
			report.Successful++
			report.TotalNodes += res.Nodes
			report.TotalEdges += res.Edges
		} else {
			report.Failed++
		}

		if progressCb != nil {
			progressCb(idx+1, len(reg.Repos), repo.Name, res.Status, res.DurationMs)
		}
	}

	report.DurationMs = time.Since(start).Milliseconds()
	return report
}
