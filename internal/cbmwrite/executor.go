package cbmwrite

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
)

const MissingCbmHelp = "codebase-memory-mcp executable not found on PATH or standard install directories. " +
	"Please install it globally using: `npm install -g codebase-memory-mcp@latest` or run `install.ps1` on Windows."

// FindCodebaseMemoryExecutable searches PATH and common installation directories for the binary.
func FindCodebaseMemoryExecutable() string {
	name := "codebase-memory-mcp"
	pathDirs := filepath.SplitList(os.Getenv("PATH"))

	if runtime.GOOS == "windows" {
		home, err := os.UserHomeDir()
		if err == nil {
			localApp := os.Getenv("LOCALAPPDATA")
			if localApp == "" {
				localApp = filepath.Join(home, "AppData", "Local")
			}
			appData := os.Getenv("APPDATA")
			if appData == "" {
				appData = filepath.Join(home, "AppData", "Roaming")
			}
			pathDirs = append(pathDirs,
				filepath.Join(localApp, "Programs", "codebase-memory-mcp"),
				filepath.Join(appData, "npm"),
			)
		}
	} else {
		home, err := os.UserHomeDir()
		if err == nil {
			pathDirs = append(pathDirs, filepath.Join(home, ".local", "bin"))
		}
		pathDirs = append(pathDirs, "/usr/local/bin", "/opt/homebrew/bin")
	}

	extensions := []string{""}
	if runtime.GOOS == "windows" {
		extensions = []string{".cmd", ".exe", ".bat", ".ps1", ""}
	}

	for _, dir := range pathDirs {
		for _, ext := range extensions {
			fullPath := filepath.Join(dir, name+ext)
			if stat, err := os.Stat(fullPath); err == nil && !stat.IsDir() {
				return fullPath
			}
		}
	}

	if runtime.GOOS == "windows" {
		return "codebase-memory-mcp.cmd"
	}
	return "codebase-memory-mcp"
}

// CbmStatus represents the availability status of codebase-memory-mcp.
type CbmStatus struct {
	Available      bool   `json:"available"`
	Executable     string `json:"executable"`
	IsExplicitPath bool   `json:"is_explicit_path"`
	InstallCommand string `json:"install_command"`
}

// CheckCodebaseMemoryStatus verifies if codebase-memory-mcp is reachable.
func CheckCodebaseMemoryStatus() CbmStatus {
	found := FindCodebaseMemoryExecutable()
	isExplicit := filepath.IsAbs(found)
	return CbmStatus{
		Available:      isExplicit,
		Executable:     found,
		IsExplicitPath: isExplicit,
		InstallCommand: "npm install -g codebase-memory-mcp@latest",
	}
}

// RepoIndexResult holds the execution outcome of indexing a single repository.
type RepoIndexResult struct {
	Name   string `json:"name"`
	Path   string `json:"path"`
	Status string `json:"status"` // success, failed, error
	Output string `json:"output,omitempty"`
	Error  string `json:"error,omitempty"`
}

// IndexSingleRepo invokes codebase-memory-mcp CLI to index a single repository into AST graph.
func IndexSingleRepo(ctx context.Context, repoPath, repoName, mode string, persistence bool) RepoIndexResult {
	cbmExe := FindCodebaseMemoryExecutable()
	absPath, err := filepath.Abs(repoPath)
	if err != nil {
		absPath = repoPath
	}

	if stat, err := os.Stat(absPath); err != nil || !stat.IsDir() {
		return RepoIndexResult{
			Name:   repoName,
			Path:   absPath,
			Status: "error",
			Error:  fmt.Sprintf("Repository directory does not exist: %s", absPath),
		}
	}

	normalizedPath := strings.ReplaceAll(absPath, "\\", "/")
	if mode == "" {
		mode = "moderate"
	}

	args := []string{
		"cli",
		"index_repository",
		"--repo-path",
		normalizedPath,
		"--name",
		repoName,
		"--mode",
		mode,
	}
	if persistence {
		args = append(args, "--persistence", "true")
	}

	start := time.Now()
	timeStr := start.Format("15:04:05")
	fmt.Printf("[%s] [oss-indexer] 🚀 Indexing repository '%s' (path: %s, mode: %s)...\n", timeStr, repoName, normalizedPath, mode)

	execCtx, cancel := context.WithTimeout(ctx, 10*time.Minute)
	defer cancel()

	cmd := exec.CommandContext(execCtx, cbmExe, args...)
	var stdoutBuf, stderrBuf bytes.Buffer
	cmd.Stdout = &stdoutBuf
	cmd.Stderr = &stderrBuf

	err = cmd.Run()
	stdout := strings.TrimSpace(stdoutBuf.String())
	stderr := strings.TrimSpace(stderrBuf.String())
	dur := time.Since(start).Round(time.Millisecond)

	if err != nil {
		errStr := stderr
		if errStr == "" {
			errStr = stdout
		}
		if errStr == "" {
			errStr = err.Error()
		}
		fmt.Printf("[%s] [oss-indexer] ✗ Failed indexing '%s' after %v: %s\n", time.Now().Format("15:04:05"), repoName, dur, errStr)
		return RepoIndexResult{
			Name:   repoName,
			Path:   normalizedPath,
			Status: "failed",
			Error:  errStr,
		}
	}

	fmt.Printf("[%s] [oss-indexer] ✓ Successfully indexed '%s' in %v\n", time.Now().Format("15:04:05"), repoName, dur)
	return RepoIndexResult{
		Name:   repoName,
		Path:   normalizedPath,
		Status: "success",
		Output: stdout,
	}
}

// RepoDeleteResult holds the execution outcome of purging a project graph.
type RepoDeleteResult struct {
	Name   string `json:"name"`
	Status string `json:"status"` // success, failed, error
	Output string `json:"output,omitempty"`
	Error  string `json:"error,omitempty"`
}

// DeleteIndexedGraph purges an indexed knowledge graph for a project from CBM.
func DeleteIndexedGraph(ctx context.Context, projectName string) RepoDeleteResult {
	cbmExe := FindCodebaseMemoryExecutable()

	execCtx, cancel := context.WithTimeout(ctx, 45*time.Second)
	defer cancel()

	cmd := exec.CommandContext(execCtx, cbmExe, "cli", "delete_project", "--project", projectName)
	var stdoutBuf, stderrBuf bytes.Buffer
	cmd.Stdout = &stdoutBuf
	cmd.Stderr = &stderrBuf

	err := cmd.Run()
	stdout := strings.TrimSpace(stdoutBuf.String())
	stderr := strings.TrimSpace(stderrBuf.String())

	if err != nil {
		errStr := stderr
		if errStr == "" {
			errStr = stdout
		}
		if errStr == "" {
			errStr = err.Error()
		}
		return RepoDeleteResult{
			Name:   projectName,
			Status: "failed",
			Error:  errStr,
		}
	}

	return RepoDeleteResult{
		Name:   projectName,
		Status: "success",
		Output: stdout,
	}
}
