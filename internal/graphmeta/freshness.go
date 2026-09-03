package graphmeta

import (
	"fmt"
	"path/filepath"
	"strings"
	"time"

	"oss-indexer/internal/registry"
	"oss-indexer/internal/scanner"
)

// RepoIndexInfo represents the indexing status for a single repository.
type RepoIndexInfo struct {
	IsIndexed    bool    `json:"is_indexed"`
	IndexNodes   *int    `json:"index_nodes,omitempty"`
	IndexEdges   *int    `json:"index_edges,omitempty"`
	IndexedAt    *string `json:"indexed_at,omitempty"`
	IndexProject string  `json:"index_project,omitempty"`
	Source       string  `json:"source,omitempty"`
}

// GetRepoIndexInfo inspects local artifacts and global cache to determine indexing status.
func GetRepoIndexInfo(repoPath string, repoName string, cached []CbmCacheItem) RepoIndexInfo {
	// 1. Check local artifact
	if repoPath != "" {
		if art := ReadLocalRepoArtifact(repoPath); art != nil {
			tStr := art.IndexedAt.Format(time.RFC3339)
			return RepoIndexInfo{
				IsIndexed:    true,
				IndexNodes:   art.Nodes,
				IndexEdges:   art.Edges,
				IndexedAt:    &tStr,
				IndexProject: art.ProjectID,
				Source:       art.Source,
			}
		}
	}

	// 2. Check global cache
	cacheList := cached
	if cacheList == nil {
		cacheList = ScanGlobalCbmCache()
	}

	slug := ""
	if repoPath != "" {
		slug = strings.ToLower(DeriveCbmSlug(repoPath))
	}
	nameLower := strings.ToLower(repoName)

	for _, item := range cacheList {
		itemName := strings.ToLower(item.Name)
		itemPID := strings.ToLower(item.ProjectID)

		if (nameLower != "" && (itemName == nameLower || itemPID == nameLower)) ||
			(slug != "" && (itemName == slug || itemPID == slug)) {
			tStr := item.LastModified.Format(time.RFC3339)
			return RepoIndexInfo{
				IsIndexed:    true,
				IndexNodes:   item.Nodes,
				IndexEdges:   item.Edges,
				IndexedAt:    &tStr,
				IndexProject: item.Name,
				Source:       item.Source,
			}
		}
	}

	return RepoIndexInfo{
		IsIndexed: false,
	}
}

// RepoStatusDetail represents the status detail of a repository in a project status report.
type RepoStatusDetail struct {
	Name        string   `json:"name"`
	LocalPath   string   `json:"local_path"`
	Description string   `json:"description,omitempty"`
	TechStack   []string `json:"tech_stack,omitempty"`
	Port        *int     `json:"port,omitempty"`
	IsIndexed   bool     `json:"is_indexed"`
	IndexNodes  *int     `json:"index_nodes,omitempty"`
	IndexEdges  *int     `json:"index_edges,omitempty"`
	IndexedAt   *string  `json:"indexed_at,omitempty"`
	Source      string   `json:"source,omitempty"`
	GitURL      string   `json:"git_url,omitempty"`
	GitOrigin   string   `json:"git_origin,omitempty"` // "root" or "service"
}

// ProjectStatusReport represents a complete health & freshness report for a project ecosystem.
type ProjectStatusReport struct {
	ProjectID          string                      `json:"project_id"`
	ProjectName        string                      `json:"project_name"`
	Description        string                      `json:"description,omitempty"`
	GitURL             string                      `json:"git_url,omitempty"`
	SourcePath         string                      `json:"source_path,omitempty"`
	TotalRepos         int                         `json:"total_repos"`
	IndexedRepos       int                         `json:"indexed_repos"`
	UnindexedRepos     int                         `json:"unindexed_repos"`
	TotalNodes         int                         `json:"total_nodes"`
	TotalEdges         int                         `json:"total_edges"`
	TotalRelationships int                         `json:"total_relationships"`
	Relationships      []registry.RelationshipInfo `json:"relationships"`
	Repos              []RepoStatusDetail          `json:"repos"`
}

// CheckProjectStatus evaluates indexing freshness for all repositories in the registry.
func CheckProjectStatus(reg *registry.ProjectRegistry) ProjectStatusReport {
	cached := ScanGlobalCbmCache()
	var details []RepoStatusDetail
	indexedCount := 0
	totalNodes := 0
	totalEdges := 0

	baseDir := ""
	if reg.SourcePath != "" {
		baseDir = filepath.Dir(reg.SourcePath)
	}

	rootGitURL := reg.GitURL
	if rootGitURL == "" && baseDir != "" {
		rootGitURL = scanner.GetGitRemoteURL(baseDir)
	}
	if rootGitURL == "" {
		for _, repo := range reg.Repos {
			if repo.LocalPath != "" {
				p := repo.LocalPath
				if !filepath.IsAbs(p) && baseDir != "" {
					p = filepath.Join(baseDir, p)
				}
				if g := scanner.GetGitRemoteURL(filepath.Dir(p)); g != "" {
					rootGitURL = g
					break
				}
			}
		}
	}

	for _, repo := range reg.Repos {
		fullPath := repo.LocalPath
		if fullPath != "" && !filepath.IsAbs(fullPath) && baseDir != "" {
			fullPath = filepath.Join(baseDir, fullPath)
		}

		gitURL := repo.GitURL
		gitOrigin := repo.GitOrigin
		if gitURL == "" && fullPath != "" {
			svcGit := scanner.GetGitRemoteURL(fullPath)
			if svcGit != "" && svcGit != rootGitURL {
				gitURL = svcGit
				gitOrigin = "service"
			} else if rootGitURL != "" {
				gitOrigin = "root"
				if baseDir != "" {
					rel, err := filepath.Rel(baseDir, fullPath)
					if err == nil && rel != "." && rel != "" {
						gitURL = fmt.Sprintf("%s/tree/main/%s", rootGitURL, strings.ReplaceAll(rel, "\\", "/"))
					} else {
						gitURL = rootGitURL
					}
				} else {
					gitURL = rootGitURL
				}
			}
		}

		idx := GetRepoIndexInfo(fullPath, repo.Name, cached)
		if idx.IsIndexed {
			indexedCount++
		}
		if idx.IndexNodes != nil {
			totalNodes += *idx.IndexNodes
		}
		if idx.IndexEdges != nil {
			totalEdges += *idx.IndexEdges
		}

		details = append(details, RepoStatusDetail{
			Name:        repo.Name,
			LocalPath:   repo.LocalPath,
			Description: repo.Description,
			TechStack:   repo.TechStack,
			Port:        repo.Port,
			IsIndexed:   idx.IsIndexed,
			IndexNodes:  idx.IndexNodes,
			IndexEdges:  idx.IndexEdges,
			IndexedAt:   idx.IndexedAt,
			Source:      idx.Source,
			GitURL:      gitURL,
			GitOrigin:   gitOrigin,
		})
	}

	rels := reg.Relationships
	if len(rels) == 0 {
		baseDir := ""
		if reg.SourcePath != "" {
			baseDir = filepath.Dir(reg.SourcePath)
		}
		rels = scanner.InferRelationships(reg.Repos, baseDir)
	}

	return ProjectStatusReport{
		ProjectID:          reg.ProjectID,
		ProjectName:        reg.Name,
		Description:        reg.Description,
		GitURL:             rootGitURL,
		SourcePath:         reg.SourcePath,
		TotalRepos:         len(reg.Repos),
		IndexedRepos:       indexedCount,
		UnindexedRepos:     len(reg.Repos) - indexedCount,
		TotalNodes:         totalNodes,
		TotalEdges:         totalEdges,
		TotalRelationships: len(rels),
		Relationships:      rels,
		Repos:              details,
	}
}
