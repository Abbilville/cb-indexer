package registry

import (
	"strings"
)

// RepoInfo represents metadata for a single repository or microservice.
type RepoInfo struct {
	Name        string   `json:"name" yaml:"name"`
	Owner       string   `json:"owner,omitempty" yaml:"owner,omitempty"`
	LocalPath   string   `json:"local_path" yaml:"local_path"`
	Description string   `json:"description,omitempty" yaml:"description,omitempty"`
	TechStack   []string `json:"tech_stack,omitempty" yaml:"tech_stack,omitempty"`
	EntryPoint  string   `json:"entry_point,omitempty" yaml:"entry_point,omitempty"`
	Port        *int     `json:"port,omitempty" yaml:"port,omitempty"`
	Tags        []string `json:"tags,omitempty" yaml:"tags,omitempty"`
}

// RelationshipInfo represents a dependency or communication edge between two repositories.
type RelationshipInfo struct {
	Source      string         `json:"source" yaml:"source"`
	Target      string         `json:"target" yaml:"target"`
	Type        string         `json:"type" yaml:"type"` // api_call, depends_on, shared_resource, event_stream, submodule
	Description string         `json:"description,omitempty" yaml:"description,omitempty"`
	Metadata    map[string]any `json:"metadata,omitempty" yaml:"metadata,omitempty"`
}

// ProjectRegistry represents a collection of repositories and their architectural graph.
type ProjectRegistry struct {
	ProjectID     string             `json:"project_id" yaml:"project_id"`
	Name          string             `json:"name" yaml:"name"`
	Description   string             `json:"description,omitempty" yaml:"description,omitempty"`
	Repos         []RepoInfo         `json:"repos" yaml:"repos"`
	Relationships []RelationshipInfo `json:"relationships" yaml:"relationships"`
	SourcePath    string             `json:"source_path,omitempty" yaml:"-"`
}

// ProjectCatalogEntry represents a project entry in the machine-wide projects catalog (~/.config/oss-mcp/projects.yaml).
type ProjectCatalogEntry struct {
	Name         string `json:"name,omitempty" yaml:"name,omitempty"`
	Description  string `json:"description,omitempty" yaml:"description,omitempty"`
	RegistryPath string `json:"registry_path,omitempty" yaml:"registry_path,omitempty"`
	RootPath     string `json:"root_path,omitempty" yaml:"root_path,omitempty"`
}

// ProjectsCatalog represents the root wrapper of projects.yaml.
type ProjectsCatalog struct {
	Projects map[string]ProjectCatalogEntry `json:"projects" yaml:"projects"`
}

// GetRepo finds a repository by name (case-insensitive).
func (pr *ProjectRegistry) GetRepo(name string) *RepoInfo {
	if name == "" {
		return nil
	}
	target := strings.ToLower(name)
	for i := range pr.Repos {
		if strings.ToLower(pr.Repos[i].Name) == target {
			return &pr.Repos[i]
		}
	}
	return nil
}

// GetInboundRelationships returns all relationships targeting the given repo (case-insensitive).
func (pr *ProjectRegistry) GetInboundRelationships(repoName string) []RelationshipInfo {
	if repoName == "" {
		return nil
	}
	target := strings.ToLower(repoName)
	var rels []RelationshipInfo
	for _, rel := range pr.Relationships {
		if strings.ToLower(rel.Target) == target {
			rels = append(rels, rel)
		}
	}
	return rels
}

// GetOutboundRelationships returns all relationships originating from the given repo (case-insensitive).
func (pr *ProjectRegistry) GetOutboundRelationships(repoName string) []RelationshipInfo {
	if repoName == "" {
		return nil
	}
	target := strings.ToLower(repoName)
	var rels []RelationshipInfo
	for _, rel := range pr.Relationships {
		if strings.ToLower(rel.Source) == target {
			rels = append(rels, rel)
		}
	}
	return rels
}
