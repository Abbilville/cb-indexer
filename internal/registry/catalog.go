package registry

import (
	"os"
	"path/filepath"
	"strings"

	"gopkg.in/yaml.v3"
)

// GetUserConfigDir returns the default config directory path ~/.config/cb-mcp (fallback: ~/.config/oss-mcp).
func GetUserConfigDir() string {
	home, err := os.UserHomeDir()
	if err != nil {
		home = "."
	}
	newPath := filepath.Join(home, ".config", "cb-mcp")
	legacyPath := filepath.Join(home, ".config", "oss-mcp")
	if _, err := os.Stat(newPath); err == nil {
		return newPath
	}
	if _, err := os.Stat(legacyPath); err == nil {
		return legacyPath
	}
	return newPath
}

// GetUserProjectsCatalogPath returns the default machine catalog path (honoring MCP_PROJECTS_CATALOG override).
func GetUserProjectsCatalogPath() string {
	if envPath := os.Getenv("MCP_PROJECTS_CATALOG"); envPath != "" {
		return envPath
	}
	return filepath.Join(GetUserConfigDir(), "projects.yaml")
}

// GetProjectsCatalog loads and merges projects from user config and env var MCP_PROJECTS_CATALOG.
func GetProjectsCatalog() map[string]ProjectCatalogEntry {
	userPath := GetUserProjectsCatalogPath()
	merged := make(map[string]ProjectCatalogEntry)

	if info, err := os.Stat(userPath); err == nil && !info.IsDir() {
		data, err := os.ReadFile(userPath)
		if err == nil {
			var cat ProjectsCatalog
			if err := yaml.Unmarshal(data, &cat); err == nil && cat.Projects != nil {
				for pid, pinfo := range cat.Projects {
					merged[pid] = pinfo
				}
			}
		}
	}
	return merged
}

// RegisterProjectInCatalog adds or updates a project entry in the user catalog projects.yaml.
func RegisterProjectInCatalog(projectID string, entry ProjectCatalogEntry) error {
	if projectID == "" {
		return nil
	}
	userPath := GetUserProjectsCatalogPath()
	if userPath == "" {
		return nil
	}

	parentDir := filepath.Dir(userPath)
	if err := os.MkdirAll(parentDir, 0755); err != nil {
		return err
	}

	var cat ProjectsCatalog
	cat.Projects = make(map[string]ProjectCatalogEntry)

	if data, err := os.ReadFile(userPath); err == nil {
		_ = yaml.Unmarshal(data, &cat)
		if cat.Projects == nil {
			cat.Projects = make(map[string]ProjectCatalogEntry)
		}
	}

	cat.Projects[projectID] = entry
	outData, err := yaml.Marshal(cat)
	if err != nil {
		return err
	}

	return os.WriteFile(userPath, outData, 0644)
}

// UnregisterProjectFromCatalog removes a project entry from catalog files.
func UnregisterProjectFromCatalog(projectID string) bool {
	var catalogPaths []string
	userPath := GetUserProjectsCatalogPath()
	if userPath != "" {
		catalogPaths = append(catalogPaths, userPath)
	}
	if envPath := os.Getenv("MCP_PROJECTS_CATALOG"); envPath != "" {
		catalogPaths = append(catalogPaths, envPath)
	}

	removed := false
	for _, cPath := range catalogPaths {
		if info, err := os.Stat(cPath); err == nil && !info.IsDir() {
			data, err := os.ReadFile(cPath)
			if err != nil {
				continue
			}
			var raw map[string]any
			if err := yaml.Unmarshal(data, &raw); err == nil {
				if projects, ok := raw["projects"].(map[string]any); ok {
					if _, exists := projects[projectID]; exists {
						delete(projects, projectID)
						outData, err := yaml.Marshal(raw)
						if err == nil {
							_ = os.WriteFile(cPath, outData, 0644)
							removed = true
						}
					}
				}
			}
		}
	}
	return removed
}

// ProjectSummary represents a registered project's high-level info for listing.
type ProjectSummary struct {
	ProjectID    string `json:"project_id"`
	Name         string `json:"name"`
	Description  string `json:"description"`
	RegistryPath string `json:"registry_path"`
	RootPath     string `json:"root_path"`
	TotalRepos   int    `json:"total_repos"`
}

// ListAvailableProjects returns all registered projects in catalogs and the current workspace.
func ListAvailableProjects() []ProjectSummary {
	catalog := GetProjectsCatalog()
	var projects []ProjectSummary

	for pid, info := range catalog {
		if info.RegistryPath != "" {
			if stat, err := os.Stat(info.RegistryPath); err != nil || stat.IsDir() {
				// Registry file no longer exists (e.g. temporary test directory deleted)
				continue
			}
		}

		name := info.Name
		if name == "" {
			name = pid
		}

		totalRepos := 0
		if info.RegistryPath != "" {
			if data, err := os.ReadFile(info.RegistryPath); err == nil {
				var raw struct {
					Repos []any `yaml:"repos"`
				}
				if err := yaml.Unmarshal(data, &raw); err == nil {
					totalRepos = len(raw.Repos)
				}
			}
		}

		projects = append(projects, ProjectSummary{
			ProjectID:    pid,
			Name:         name,
			Description:  info.Description,
			RegistryPath: info.RegistryPath,
			RootPath:     info.RootPath,
			TotalRepos:   totalRepos,
		})
	}

	// Check if active workspace has a registry.yaml
	workspaceReg := DiscoverWorkspaceRegistry("")
	if workspaceReg != "" {
		if data, err := os.ReadFile(workspaceReg); err == nil {
			var raw struct {
				ProjectID   string `yaml:"project_id"`
				Name        string `yaml:"name"`
				Description string `yaml:"description"`
				Repos       []any  `yaml:"repos"`
			}
			if err := yaml.Unmarshal(data, &raw); err == nil {
				pID := raw.ProjectID
				if pID == "" {
					pID = filepath.Base(filepath.Dir(workspaceReg))
				}
				name := raw.Name
				if name == "" {
					name = pID
				}
				desc := raw.Description
				if desc == "" {
					desc = "Active workspace project (" + filepath.Dir(workspaceReg) + ")"
				}

				alreadyExists := false
				for _, p := range projects {
					if strings.EqualFold(p.ProjectID, pID) || strings.EqualFold(p.RegistryPath, workspaceReg) {
						alreadyExists = true
						break
					}
				}
				if !alreadyExists {
					// Prepend active workspace
					projects = append([]ProjectSummary{{
						ProjectID:    pID,
						Name:         name,
						Description:  desc,
						RegistryPath: workspaceReg,
						RootPath:     filepath.Dir(workspaceReg),
						TotalRepos:   len(raw.Repos),
					}}, projects...)
				}
			}
		}
	}

	return projects
}
