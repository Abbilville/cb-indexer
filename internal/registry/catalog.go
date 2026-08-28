package registry

import (
	"os"
	"path/filepath"
	"strings"

	"gopkg.in/yaml.v3"
)

// GetUserConfigDir returns the default config directory path ~/.config/oss-mcp.
func GetUserConfigDir() string {
	home, err := os.UserHomeDir()
	if err != nil {
		home = "."
	}
	return filepath.Join(home, ".config", "oss-mcp")
}

// GetUserProjectsCatalogPath returns the default machine catalog path.
func GetUserProjectsCatalogPath() string {
	return filepath.Join(GetUserConfigDir(), "projects.yaml")
}

// GetProjectsCatalog loads and merges projects from user config and env var MCP_PROJECTS_CATALOG.
func GetProjectsCatalog() map[string]ProjectCatalogEntry {
	var catalogPaths []string
	userPath := GetUserProjectsCatalogPath()
	if userPath != "" {
		catalogPaths = append(catalogPaths, userPath)
	}
	if envPath := os.Getenv("MCP_PROJECTS_CATALOG"); envPath != "" {
		catalogPaths = append(catalogPaths, envPath)
	}

	merged := make(map[string]ProjectCatalogEntry)
	for _, cPath := range catalogPaths {
		if info, err := os.Stat(cPath); err == nil && !info.IsDir() {
			data, err := os.ReadFile(cPath)
			if err != nil {
				continue
			}
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
}

// ListAvailableProjects returns all registered projects in catalogs and the current workspace.
func ListAvailableProjects() []ProjectSummary {
	catalog := GetProjectsCatalog()
	var projects []ProjectSummary

	for pid, info := range catalog {
		name := info.Name
		if name == "" {
			name = pid
		}
		projects = append(projects, ProjectSummary{
			ProjectID:    pid,
			Name:         name,
			Description:  info.Description,
			RegistryPath: info.RegistryPath,
			RootPath:     info.RootPath,
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
					}}, projects...)
				}
			}
		}
	}

	return projects
}
