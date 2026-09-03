package mcpserver

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/modelcontextprotocol/go-sdk/mcp"

	"oss-indexer/internal/cbmwrite"
	"oss-indexer/internal/gitwatcher"
	"oss-indexer/internal/graphmeta"
	"oss-indexer/internal/registry"
	"oss-indexer/internal/scanner"
	"oss-indexer/internal/workflows"
)

// Tool Input Structs
type ProjectInput struct {
	Project string `json:"project,omitempty" jsonschema:"Optional project ID, registry path, or workspace directory"`
}

type RepoDetailsInput struct {
	RepoName string `json:"repo_name" jsonschema:"Name of the repository (case-insensitive)"`
	Project  string `json:"project,omitempty" jsonschema:"Optional project ID or registry path"`
}

type RelatedReposInput struct {
	RepoName  string `json:"repo_name" jsonschema:"Name of the repository (case-insensitive)"`
	Direction string `json:"direction,omitempty" jsonschema:"'inbound' (callers), 'outbound' (dependencies), or 'all' (default)"`
	Project   string `json:"project,omitempty" jsonschema:"Optional project ID or registry path"`
}

type TriggerIndexInput struct {
	Project     string `json:"project,omitempty" jsonschema:"Optional project ID or registry path"`
	RepoName    string `json:"repo_name,omitempty" jsonschema:"Optional specific repository name to index"`
	Mode        string `json:"mode,omitempty" jsonschema:"Indexing mode: 'moderate' (recommended), 'full', or 'fast'"`
	Pull        bool   `json:"pull,omitempty" jsonschema:"Whether to git pull latest commits before indexing (default: false)"`
	Persistence bool   `json:"persistence,omitempty" jsonschema:"Generate .codebase-memory/ artifacts in repo directories (default: false)"`
}

type ScanCreateInput struct {
	WorkspacePath string `json:"workspace_path" jsonschema:"Directory containing sub-repositories to scan"`
	OutputFile    string `json:"output_file,omitempty" jsonschema:"Optional path to save registry.yaml"`
}

type OnboardInput struct {
	WorkspacePath string `json:"workspace_path" jsonschema:"Directory containing sub-repositories to onboard"`
	ProjectID     string `json:"project_id,omitempty" jsonschema:"Custom project ID"`
	Mode          string `json:"mode,omitempty" jsonschema:"Indexing mode: 'moderate', 'full', or 'fast'"`
	OutputFile    string `json:"output_file,omitempty" jsonschema:"Optional path to save registry.yaml"`
}

type RemoveProjectInput struct {
	Project        string `json:"project" jsonschema:"Project ID or file path to registry.yaml"`
	PurgeGraphs    *bool  `json:"purge_graphs,omitempty" jsonschema:"Whether to purge codebase-memory-mcp graph databases (default: true)"`
	DeleteManifest *bool  `json:"delete_manifest,omitempty" jsonschema:"Whether to delete registry.yaml manifest from disk (default: true)"`
}

func RegisterTools(s *mcp.Server) {
	// Tool 1: get_architecture_overview
	mcp.AddTool(s, &mcp.Tool{
		Name:        "get_architecture_overview",
		Description: "Return a compact JSON overview of all repositories and their relationships.",
	}, func(ctx context.Context, req *mcp.CallToolRequest, input ProjectInput) (*mcp.CallToolResult, any, error) {
		reg, err := registry.LoadRegistry(input.Project)
		if err != nil {
			return errorResult(err), nil, nil
		}
		status := graphmeta.CheckProjectStatus(reg)
		return jsonResult(status), nil, nil
	})

	// Tool 2: get_repo_details
	mcp.AddTool(s, &mcp.Tool{
		Name:        "get_repo_details",
		Description: "Get comprehensive details for a specific repository within the project.",
	}, func(ctx context.Context, req *mcp.CallToolRequest, input RepoDetailsInput) (*mcp.CallToolResult, any, error) {
		reg, err := registry.LoadRegistry(input.Project)
		if err != nil {
			return errorResult(err), nil, nil
		}
		repo := reg.GetRepo(input.RepoName)
		if repo == nil {
			var available []string
			for _, r := range reg.Repos {
				available = append(available, r.Name)
			}
			return errorResult(fmt.Errorf("repository '%s' not found in project '%s'. Available: %s", input.RepoName, reg.ProjectID, strings.Join(available, ", "))), nil, nil
		}

		baseDir := ""
		if reg.SourcePath != "" {
			baseDir = filepath.Dir(reg.SourcePath)
		}
		fullPath := repo.LocalPath
		if fullPath != "" && !filepath.IsAbs(fullPath) && baseDir != "" {
			fullPath = filepath.Join(baseDir, fullPath)
		}

		idxInfo := graphmeta.GetRepoIndexInfo(fullPath, repo.Name, nil)
		inbound := reg.GetInboundRelationships(repo.Name)
		outbound := reg.GetOutboundRelationships(repo.Name)

		res := map[string]any{
			"project_id": reg.ProjectID,
			"repo": map[string]any{
				"name":          repo.Name,
				"owner":         repo.Owner,
				"local_path":    repo.LocalPath,
				"description":   repo.Description,
				"tech_stack":    repo.TechStack,
				"entry_point":   repo.EntryPoint,
				"port":          repo.Port,
				"is_indexed":    idxInfo.IsIndexed,
				"index_nodes":   idxInfo.IndexNodes,
				"index_edges":   idxInfo.IndexEdges,
				"indexed_at":    idxInfo.IndexedAt,
				"index_project": idxInfo.IndexProject,
			},
			"relationships": map[string]any{
				"inbound":  inbound,
				"outbound": outbound,
			},
		}
		return jsonResult(res), nil, nil
	})

	// Tool 3: get_related_repos
	mcp.AddTool(s, &mcp.Tool{
		Name:        "get_related_repos",
		Description: "Find all repositories directly connected to a given repo.",
	}, func(ctx context.Context, req *mcp.CallToolRequest, input RelatedReposInput) (*mcp.CallToolResult, any, error) {
		reg, err := registry.LoadRegistry(input.Project)
		if err != nil {
			return errorResult(err), nil, nil
		}
		repo := reg.GetRepo(input.RepoName)
		if repo == nil {
			return errorResult(fmt.Errorf("repository '%s' not found in registry", input.RepoName)), nil, nil
		}

		inbound := reg.GetInboundRelationships(repo.Name)
		outbound := reg.GetOutboundRelationships(repo.Name)

		var rels []registry.RelationshipInfo
		dir := strings.ToLower(input.Direction)
		switch dir {
		case "inbound":
			rels = inbound
		case "outbound":
			rels = outbound
		default:
			rels = append(inbound, outbound...)
		}

		res := map[string]any{
			"repo":              input.RepoName,
			"direction":         dir,
			"total_connections": len(rels),
			"relationships":     rels,
		}
		return jsonResult(res), nil, nil
	})

	// Tool 4: list_projects
	mcp.AddTool(s, &mcp.Tool{
		Name:        "list_projects",
		Description: "List all registered projects and codebase-memory-mcp indexed graph databases.",
	}, func(ctx context.Context, req *mcp.CallToolRequest, input ProjectInput) (*mcp.CallToolResult, any, error) {
		available := registry.ListAvailableProjects()
		cached := graphmeta.ScanGlobalCbmCache()

		res := map[string]any{
			"registered_projects":           available,
			"indexed_codebase_memory_graphs": cached,
			"total_registered_projects":     len(available),
			"total_indexed_graphs":          len(cached),
		}
		return jsonResult(res), nil, nil
	})

	// Tool 5: check_project_status
	mcp.AddTool(s, &mcp.Tool{
		Name:        "check_project_status",
		Description: "Check registry integrity and per-repo index freshness/timestamps in one call.",
	}, func(ctx context.Context, req *mcp.CallToolRequest, input ProjectInput) (*mcp.CallToolResult, any, error) {
		reg, err := registry.LoadRegistry(input.Project)
		if err != nil {
			return errorResult(err), nil, nil
		}
		report := graphmeta.CheckProjectStatus(reg)
		return jsonResult(report), nil, nil
	})

	// Tool 6: check_index_status
	mcp.AddTool(s, &mcp.Tool{
		Name:        "check_index_status",
		Description: "Return daemon health, last run timestamps, changed repos, and recent log errors.",
	}, func(ctx context.Context, req *mcp.CallToolRequest, input ProjectInput) (*mcp.CallToolResult, any, error) {
		report := gitwatcher.CheckIndexStatus(input.Project)
		return jsonResult(report), nil, nil
	})

	// Tool 7: trigger_index
	mcp.AddTool(s, &mcp.Tool{
		Name:        "trigger_index",
		Description: "Trigger immediate batch indexing for a project or specific repository.",
	}, func(ctx context.Context, req *mcp.CallToolRequest, input TriggerIndexInput) (*mcp.CallToolResult, any, error) {
		reg, err := registry.LoadRegistry(input.Project)
		if err != nil {
			return errorResult(err), nil, nil
		}

		mode := input.Mode
		if mode == "" {
			mode = "moderate"
		}

		if input.RepoName != "" {
			repo := reg.GetRepo(input.RepoName)
			if repo == nil {
				return errorResult(fmt.Errorf("repo '%s' not found", input.RepoName)), nil, nil
			}
			baseDir := ""
			if reg.SourcePath != "" {
				baseDir = filepath.Dir(reg.SourcePath)
			}
			fullPath := repo.LocalPath
			if fullPath != "" && !filepath.IsAbs(fullPath) && baseDir != "" {
				fullPath = filepath.Join(baseDir, fullPath)
			}
			if input.Pull {
				_, _ = gitwatcher.GitPull(ctx, fullPath)
			}
			res := cbmwrite.IndexSingleRepo(ctx, fullPath, repo.Name, mode, input.Persistence)
			return jsonResult(res), nil, nil
		}

		if input.Pull {
			baseDir := ""
			if reg.SourcePath != "" {
				baseDir = filepath.Dir(reg.SourcePath)
			}
			if baseDir != "" {
				_, _ = gitwatcher.GitPull(ctx, baseDir)
			}
			for _, r := range reg.Repos {
				fullPath := r.LocalPath
				if fullPath != "" && !filepath.IsAbs(fullPath) && baseDir != "" {
					fullPath = filepath.Join(baseDir, fullPath)
				}
				if fullPath != "" && fullPath != baseDir {
					_, _ = gitwatcher.GitPull(ctx, fullPath)
				}
			}
		}
		report := cbmwrite.BatchIndexProject(ctx, reg, mode, input.Persistence)
		return jsonResult(report), nil, nil
	})

	// Tool 8: scan_and_create_registry
	mcp.AddTool(s, &mcp.Tool{
		Name:        "scan_and_create_registry",
		Description: "Automatically scan a directory for repositories, infer tech stacks and relationships.",
	}, func(ctx context.Context, req *mcp.CallToolRequest, input ScanCreateInput) (*mcp.CallToolResult, any, error) {
		reg, err := scanner.ScanWorkspace(input.WorkspacePath, "")
		if err != nil {
			return errorResult(err), nil, nil
		}

		if input.OutputFile != "" {
			savedPath, err := registry.SaveRegistry(reg, input.OutputFile)
			if err != nil {
				return errorResult(err), nil, nil
			}
			return jsonResult(map[string]any{
				"status":        "success",
				"registry_path": savedPath,
				"overview":      graphmeta.CheckProjectStatus(reg),
			}), nil, nil
		}

		return jsonResult(map[string]any{
			"status":   "success",
			"overview": graphmeta.CheckProjectStatus(reg),
		}), nil, nil
	})

	// Tool 9: onboard_workspace
	mcp.AddTool(s, &mcp.Tool{
		Name:        "onboard_workspace",
		Description: "Execute atomic discovery, manifest generation, and batch indexing in a single call.",
	}, func(ctx context.Context, req *mcp.CallToolRequest, input OnboardInput) (*mcp.CallToolResult, any, error) {
		report, err := workflows.OnboardWorkspace(ctx, input.WorkspacePath, input.ProjectID, input.Mode, input.OutputFile)
		if err != nil {
			return errorResult(err), nil, nil
		}
		return jsonResult(report), nil, nil
	})

	// Tool 10: remove_project
	mcp.AddTool(s, &mcp.Tool{
		Name:        "remove_project",
		Description: "Remove a project from the catalog, purge its codebase-memory-mcp index graphs, and delete its manifest.",
	}, func(ctx context.Context, req *mcp.CallToolRequest, input RemoveProjectInput) (*mcp.CallToolResult, any, error) {
		reg, _ := registry.LoadRegistry(input.Project)
		pID := input.Project
		if reg != nil {
			pID = reg.ProjectID
		}

		purgeGraphs := true
		if input.PurgeGraphs != nil {
			purgeGraphs = *input.PurgeGraphs
		}

		deleteManifest := true
		if input.DeleteManifest != nil {
			deleteManifest = *input.DeleteManifest
		}

		var purgeReport any
		if purgeGraphs {
			if reg != nil {
				purgeReport = cbmwrite.PurgeProjectGraphs(ctx, reg)
			} else {
				res := cbmwrite.DeleteIndexedGraph(ctx, pID)
				purgeReport = map[string]any{
					"project_id": pID,
					"purged":     res.Status == "success",
					"result":     res,
				}
			}
		}

		unregistered := registry.UnregisterProjectFromCatalog(pID)
		manifestDeleted := false
		if deleteManifest && reg != nil && reg.SourcePath != "" {
			if _, err := os.Stat(reg.SourcePath); err == nil {
				_ = os.Remove(reg.SourcePath)
				manifestDeleted = true
			}
		}

		return jsonResult(map[string]any{
			"status":                     "success",
			"project_id":                 pID,
			"unregistered_from_catalog":  unregistered,
			"manifest_deleted":           manifestDeleted,
			"graph_purge_report":         purgeReport,
		}), nil, nil
	})
}

func jsonResult(data any) *mcp.CallToolResult {
	bytes, err := json.MarshalIndent(data, "", "  ")
	if err != nil {
		return errorResult(err)
	}
	return &mcp.CallToolResult{
		Content: []mcp.Content{
			&mcp.TextContent{
				Text: string(bytes),
			},
		},
	}
}

func errorResult(err error) *mcp.CallToolResult {
	errMap := map[string]string{"error": err.Error()}
	bytes, _ := json.MarshalIndent(errMap, "", "  ")
	return &mcp.CallToolResult{
		Content: []mcp.Content{
			&mcp.TextContent{
				Text: string(bytes),
			},
		},
		IsError: true,
	}
}
