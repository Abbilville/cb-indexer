package gitwatcher

import (
	"context"
	"fmt"
	"path/filepath"
	"time"

	"cb-indexer/internal/cbmwrite"
	"cb-indexer/internal/graphmeta"
	"cb-indexer/internal/registry"
)

// DaemonStatusReport describes the operational state of the indexing daemon.
type DaemonStatusReport struct {
	ActiveProjects int           `json:"active_projects"`
	LastRun        *time.Time    `json:"last_run,omitempty"`
	RecentLogs     []IndexRunLog `json:"recent_logs"`
	CbmStatus      any           `json:"cbm_status"`
}

// CheckIndexStatus returns the operational status and recent run logs of the indexer.
func CheckIndexStatus(projectTarget string) DaemonStatusReport {
	recent := GetRecentLogs(5)
	cbm := cbmwrite.CheckCodebaseMemoryStatus()

	projects := registry.ListAvailableProjects()

	var lastRun *time.Time
	if len(recent) > 0 {
		lastRun = &recent[0].Timestamp
	}

	return DaemonStatusReport{
		ActiveProjects: len(projects),
		LastRun:        lastRun,
		RecentLogs:     recent,
		CbmStatus:      cbm,
	}
}

// ProcessProjectCycle inspects a single project, optionally pulls git updates, and indexes changed repos.
func ProcessProjectCycle(ctx context.Context, reg *registry.ProjectRegistry, autoPull bool, mode string) IndexRunLog {
	start := time.Now()
	var pulledRepos []string
	var indexedRepos []string
	var errLogs []string

	cached := graphmeta.ScanGlobalCbmCache()
	baseDir := ""
	if reg.SourcePath != "" {
		baseDir = filepath.Dir(reg.SourcePath)
	}

	for _, repo := range reg.Repos {
		fullPath := repo.LocalPath
		if fullPath != "" && !filepath.IsAbs(fullPath) && baseDir != "" {
			fullPath = filepath.Join(baseDir, fullPath)
		}

		if autoPull {
			pulled, err := GitPull(ctx, fullPath)
			if err == nil && pulled {
				pulledRepos = append(pulledRepos, repo.Name)
			}
		}

		idxInfo := graphmeta.GetRepoIndexInfo(fullPath, repo.Name, cached)
		// If unindexed or pulled, trigger index
		shouldIndex := !idxInfo.IsIndexed
		for _, p := range pulledRepos {
			if p == repo.Name {
				shouldIndex = true
				break
			}
		}

		if shouldIndex {
			res := cbmwrite.IndexSingleRepo(ctx, fullPath, repo.Name, mode, false)
			if res.Status == "success" {
				indexedRepos = append(indexedRepos, repo.Name)
			} else if res.Error != "" {
				errLogs = append(errLogs, fmt.Sprintf("%s: %s", repo.Name, res.Error))
			}
		}
	}

	duration := time.Since(start).Milliseconds()
	logEntry := IndexRunLog{
		Timestamp:   time.Now(),
		DurationMs:  duration,
		ProjectID:   reg.ProjectID,
		TotalRepos:  len(reg.Repos),
		ReposPulled: pulledRepos,
		Indexed:     indexedRepos,
		Errors:      errLogs,
		Success:     len(errLogs) == 0,
	}

	LogIndexRun(logEntry)
	return logEntry
}

// RunDaemon starts a periodic ticker loop that regularly scans and indexes repositories.
func RunDaemon(ctx context.Context, interval time.Duration, autoPull bool, regTarget string, mode string) error {
	if interval < 10*time.Second {
		interval = 15 * time.Minute
	}
	if mode == "" {
		mode = "moderate"
	}

	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	runOnce := func() {
		var registries []*registry.ProjectRegistry
		if regTarget != "" {
			if reg, err := registry.LoadRegistry(regTarget); err == nil {
				registries = append(registries, reg)
			}
		} else {
			available := registry.ListAvailableProjects()
			for _, p := range available {
				if p.RegistryPath != "" {
					if reg, err := registry.LoadRegistry(p.RegistryPath); err == nil {
						registries = append(registries, reg)
					}
				}
			}
		}

		for _, reg := range registries {
			ProcessProjectCycle(ctx, reg, autoPull, mode)
		}
	}

	// Run initial cycle immediately
	runOnce()

	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-ticker.C:
			runOnce()
		}
	}
}
