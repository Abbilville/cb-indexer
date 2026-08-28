package graphmeta

import (
	"encoding/json"
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"strings"
	"time"
)

// CbmCacheItem represents an indexed knowledge graph found in global cache directories.
type CbmCacheItem struct {
	Name         string    `json:"name"`
	ProjectID    string    `json:"project_id"`
	DBPath       string    `json:"db_path"`
	SizeBytes    int64     `json:"size_bytes"`
	LastModified time.Time `json:"last_modified"`
	IsIndexed    bool      `json:"is_indexed"`
	Nodes        *int      `json:"nodes,omitempty"`
	Edges        *int      `json:"edges,omitempty"`
	Source       string    `json:"source"`
}

// CbmProjectItem represents a project parsed from codebase-memory-mcp CLI output.
type CbmProjectItem struct {
	Name      string `json:"name"`
	ProjectID string `json:"project_id"`
	RootPath  string `json:"root_path,omitempty"`
	Nodes     *int   `json:"nodes,omitempty"`
	Edges     *int   `json:"edges,omitempty"`
}

// DeriveCbmSlug converts a filesystem path to the slug pattern used by codebase-memory-mcp.
func DeriveCbmSlug(localPath string) string {
	cleaned := strings.TrimSpace(localPath)
	cleaned = strings.Trim(cleaned, "/\\")
	re := regexp.MustCompile(`[:/\\_]+`)
	return re.ReplaceAllString(cleaned, "-")
}

// ScanGlobalCbmCache searches global cache directories for indexed SQLite / graph databases.
func ScanGlobalCbmCache() []CbmCacheItem {
	var results []CbmCacheItem
	var candidateDirs []string

	home, err := os.UserHomeDir()
	if err == nil {
		candidateDirs = append(candidateDirs,
			filepath.Join(home, ".cache", "codebase-memory-mcp"),
			filepath.Join(home, ".codebase-memory"),
		)
	}

	if runtime.GOOS == "windows" {
		if localApp := os.Getenv("LOCALAPPDATA"); localApp != "" {
			candidateDirs = append(candidateDirs,
				filepath.Join(localApp, "codebase-memory-mcp"),
				filepath.Join(localApp, "cache", "codebase-memory-mcp"),
			)
		}
	}

	for _, dir := range candidateDirs {
		entries, err := os.ReadDir(dir)
		if err != nil {
			continue
		}
		for _, entry := range entries {
			if !entry.IsDir() && strings.HasSuffix(entry.Name(), ".db") && !strings.HasPrefix(entry.Name(), "_") {
				dbPath := filepath.Join(dir, entry.Name())
				projectName := strings.TrimSuffix(entry.Name(), ".db")
				info, err := entry.Info()
				if err != nil {
					continue
				}

				results = append(results, CbmCacheItem{
					Name:         projectName,
					ProjectID:    projectName,
					DBPath:       strings.ReplaceAll(dbPath, "\\", "/"),
					SizeBytes:    info.Size(),
					LastModified: info.ModTime(),
					IsIndexed:    true,
					Source:       "global_cache",
				})
			}
		}
	}

	return results
}

// ExtractProjectsFromCbmOutput parses JSON/MCP text outputs from codebase-memory-mcp CLI.
func ExtractProjectsFromCbmOutput(stdout, stderr string) []CbmProjectItem {
	combined := stdout + "\n" + stderr
	var projects []CbmProjectItem

	lines := strings.Split(combined, "\n")
	for _, line := range lines {
		trimmed := strings.TrimSpace(line)
		if strings.HasPrefix(trimmed, "{") && (strings.Contains(trimmed, `"projects"`) || strings.Contains(trimmed, `"structuredContent"`) || strings.Contains(trimmed, `"content"`)) {
			var raw struct {
				Projects          []CbmProjectItem `json:"projects"`
				StructuredContent struct {
					Projects []CbmProjectItem `json:"projects"`
				} `json:"structuredContent"`
				Content []struct {
					Type string `json:"type"`
					Text string `json:"text"`
				} `json:"content"`
			}
			if err := json.Unmarshal([]byte(trimmed), &raw); err == nil {
				if len(raw.Projects) > 0 {
					projects = append(projects, raw.Projects...)
				}
				if len(raw.StructuredContent.Projects) > 0 {
					projects = append(projects, raw.StructuredContent.Projects...)
				}
				for _, c := range raw.Content {
					if c.Type == "text" && c.Text != "" {
						var sub struct {
							Projects []CbmProjectItem `json:"projects"`
						}
						if err := json.Unmarshal([]byte(c.Text), &sub); err == nil && len(sub.Projects) > 0 {
							projects = append(projects, sub.Projects...)
						}
					}
				}
			}
		}
	}

	return projects
}
