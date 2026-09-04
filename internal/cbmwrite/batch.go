package cbmwrite

import (
	"context"
	"path/filepath"
	"time"

	"oss-indexer/internal/graphmeta"
	"oss-indexer/internal/registry"
)

// BatchIndexReport contains aggregated statistics and individual repo index results.
type BatchIndexReport struct {
	ProjectID   string            `json:"project_id"`
	ProjectName string            `json:"project_name"`
	TotalRepos  int               `json:"total_repos"`
	Successful  int               `json:"successful"`
	Failed      int               `json:"failed"`
	Mode        string            `json:"mode"`
	Results     []RepoIndexResult `json:"results"`
}

// ProgressCallback is invoked as each repository starts and finishes indexing.
type ProgressCallback func(current, total int, repoName, status, errStr string, durationMs int64)

// BatchIndexProject executes batch AST indexing across all repositories in a project.
func BatchIndexProject(ctx context.Context, reg *registry.ProjectRegistry, mode string, persistence bool) BatchIndexReport {
	return BatchIndexProjectWithProgress(ctx, reg, mode, persistence, nil)
}

// BatchIndexProjectWithProgress executes batch AST indexing and emits progress callbacks.
func BatchIndexProjectWithProgress(ctx context.Context, reg *registry.ProjectRegistry, mode string, persistence bool, onProgress ProgressCallback) BatchIndexReport {
	if mode == "" {
		mode = "moderate"
	}

	total := len(reg.Repos)
	var results []RepoIndexResult
	successCount := 0
	baseDir := ""
	if reg.SourcePath != "" {
		baseDir = filepath.Dir(reg.SourcePath)
	}

	for i, repo := range reg.Repos {
		idx := i + 1
		fullPath := repo.LocalPath
		if fullPath != "" && !filepath.IsAbs(fullPath) && baseDir != "" {
			fullPath = filepath.Join(baseDir, fullPath)
		}

		if onProgress != nil {
			onProgress(idx, total, repo.Name, "indexing", "", 0)
		}

		start := time.Now()
		res := IndexSingleRepo(ctx, fullPath, repo.Name, mode, persistence)
		durMs := time.Since(start).Milliseconds()

		results = append(results, res)
		if res.Status == "success" {
			successCount++
		}

		if onProgress != nil {
			onProgress(idx, total, repo.Name, res.Status, res.Error, durMs)
		}
	}

	return BatchIndexReport{
		ProjectID:   reg.ProjectID,
		ProjectName: reg.Name,
		TotalRepos:  len(reg.Repos),
		Successful:  successCount,
		Failed:      len(reg.Repos) - successCount,
		Mode:        mode,
		Results:     results,
	}
}

// PurgeReport holds the summary of purged knowledge graphs for a project.
type PurgeReport struct {
	ProjectID   string             `json:"project_id"`
	ProjectName string             `json:"project_name"`
	TotalRepos  int                `json:"total_repos"`
	Purged      int                `json:"purged"`
	Results     []RepoDeleteResult `json:"results"`
}

// PurgeProjectGraphs deletes all codebase-memory-mcp graphs associated with a project's repositories.
func PurgeProjectGraphs(ctx context.Context, reg *registry.ProjectRegistry) PurgeReport {
	var results []RepoDeleteResult
	purgedCount := 0

	for _, repo := range reg.Repos {
		candidates := []string{repo.Name}
		if repo.LocalPath != "" {
			slug := graphmeta.DeriveCbmSlug(repo.LocalPath)
			if slug != repo.Name {
				candidates = append(candidates, slug)
			}
		}

		repoSuccess := false
		var lastRes RepoDeleteResult

		for _, cand := range candidates {
			res := DeleteIndexedGraph(ctx, cand)
			lastRes = res
			if res.Status == "success" {
				repoSuccess = true
				break
			}
		}

		if repoSuccess {
			purgedCount++
			results = append(results, RepoDeleteResult{
				Name:   repo.Name,
				Status: "success",
			})
		} else {
			results = append(results, lastRes)
		}
	}

	return PurgeReport{
		ProjectID:   reg.ProjectID,
		ProjectName: reg.Name,
		TotalRepos:  len(reg.Repos),
		Purged:      purgedCount,
		Results:     results,
	}
}
