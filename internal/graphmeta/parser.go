package graphmeta

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// ArtifactInfo represents metadata parsed from a repository's .codebase-memory/artifact.json.
type ArtifactInfo struct {
	Name         string    `json:"name"`
	ProjectID    string    `json:"project_id"`
	RootPath     string    `json:"root_path"`
	IsIndexed    bool      `json:"is_indexed"`
	Nodes        *int      `json:"nodes"`
	Edges        *int      `json:"edges"`
	Commit       string    `json:"commit,omitempty"`
	IndexedAt    time.Time `json:"indexed_at"`
	ArtifactPath string    `json:"artifact_path"`
	Source       string    `json:"source"`
}

// rawArtifactJson represents the JSON structure in .codebase-memory/artifact.json.
type rawArtifactJson struct {
	SchemaVersion  int    `json:"schema_version"`
	Commit         string `json:"commit"`
	IndexedAt      string `json:"indexed_at"`
	Project        string `json:"project"`
	Nodes          *int   `json:"nodes"`
	Edges          *int   `json:"edges"`
	OriginalSize   int64  `json:"original_size"`
	CompressedSize int64  `json:"compressed_size"`
}

// ReadLocalRepoArtifact reads and parses .codebase-memory/artifact.json inside repoPath if it exists.
func ReadLocalRepoArtifact(repoPath string) *ArtifactInfo {
	if repoPath == "" {
		return nil
	}
	absPath, err := filepath.Abs(repoPath)
	if err != nil {
		absPath = repoPath
	}

	artifactPath := filepath.Join(absPath, ".codebase-memory", "artifact.json")
	stat, err := os.Stat(artifactPath)
	if err != nil || stat.IsDir() {
		return nil
	}

	data, err := os.ReadFile(artifactPath)
	if err != nil {
		return nil
	}

	var raw rawArtifactJson
	if err := json.Unmarshal(data, &raw); err != nil {
		return nil
	}

	projectName := raw.Project
	if projectName == "" {
		projectName = filepath.Base(absPath)
	}

	var indexedTime time.Time
	if raw.IndexedAt != "" {
		if t, err := time.Parse(time.RFC3339, raw.IndexedAt); err == nil {
			indexedTime = t
		}
	}
	if indexedTime.IsZero() {
		indexedTime = stat.ModTime()
	}

	return &ArtifactInfo{
		Name:         projectName,
		ProjectID:    projectName,
		RootPath:     strings.ReplaceAll(absPath, "\\", "/"),
		IsIndexed:    true,
		Nodes:        raw.Nodes,
		Edges:        raw.Edges,
		Commit:       raw.Commit,
		IndexedAt:    indexedTime,
		ArtifactPath: strings.ReplaceAll(artifactPath, "\\", "/"),
		Source:       "local_artifact",
	}
}
