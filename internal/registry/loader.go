package registry

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"gopkg.in/yaml.v3"
)

// CandidateRegistryNames is the prioritized list of filenames for auto-discovery.
var CandidateRegistryNames = []string{
	"registry.yaml",
	"registry.yml",
	".repo-registry.yaml",
	".repo-registry.yml",
	filepath.Join(".agents", "registry.yaml"),
	filepath.Join(".agents", "registry.yml"),
}

// DiscoverWorkspaceRegistry walks up the directory tree looking for a registry manifest.
func DiscoverWorkspaceRegistry(startDir string) string {
	var current string
	if startDir != "" {
		current, _ = filepath.Abs(startDir)
	} else {
		wd, err := os.Getwd()
		if err != nil {
			return ""
		}
		current = wd
	}

	for {
		for _, cand := range CandidateRegistryNames {
			candPath := filepath.Join(current, cand)
			if stat, err := os.Stat(candPath); err == nil && !stat.IsDir() {
				abs, err := filepath.Abs(candPath)
				if err == nil {
					return abs
				}
				return candPath
			}
		}
		parent := filepath.Dir(current)
		if parent == current {
			break
		}
		current = parent
	}
	return ""
}

// ResolveRegistryPath resolves the absolute path to a registry manifest based on hierarchy.
func ResolveRegistryPath(target string) (string, error) {
	// 1. Direct file or directory path
	if target != "" {
		absTarget, _ := filepath.Abs(target)
		if stat, err := os.Stat(absTarget); err == nil {
			if !stat.IsDir() {
				return absTarget, nil
			}
			// Search candidate filenames in directory
			for _, cand := range CandidateRegistryNames {
				candPath := filepath.Join(absTarget, cand)
				if cStat, err := os.Stat(candPath); err == nil && !cStat.IsDir() {
					return filepath.Abs(candPath)
				}
			}
		}

		// Direct lookup in projects catalog
		catalog := GetProjectsCatalog()
		for pid, entry := range catalog {
			if strings.EqualFold(pid, target) || strings.EqualFold(entry.RegistryPath, target) || strings.EqualFold(entry.RootPath, target) {
				if entry.RegistryPath != "" {
					regPath := entry.RegistryPath
					if !filepath.IsAbs(regPath) {
						regPath, _ = filepath.Abs(regPath)
					}
					if stat, err := os.Stat(regPath); err == nil && !stat.IsDir() {
						return regPath, nil
					}
				}
			}
		}
	}

	// 2. Environment variables
	for _, envKey := range []string{"MCP_REGISTRY_PATH", "REPO_REGISTRY_PATH"} {
		if envVal := os.Getenv(envKey); envVal != "" {
			absEnv, _ := filepath.Abs(envVal)
			if stat, err := os.Stat(absEnv); err == nil && !stat.IsDir() {
				return absEnv, nil
			}
		}
	}

	// 3. Workspace traversal
	if wsPath := DiscoverWorkspaceRegistry(""); wsPath != "" {
		return wsPath, nil
	}

	return "", errors.New("no registry.yaml found in current workspace. Run scan or provide --registry <path>")
}

// LoadRegistry loads and parses a ProjectRegistry from target path, catalog, env, or workspace.
func LoadRegistry(target string) (*ProjectRegistry, error) {
	resolvedPath, err := ResolveRegistryPath(target)
	if err != nil {
		return nil, err
	}

	data, err := os.ReadFile(resolvedPath)
	if err != nil {
		return nil, fmt.Errorf("failed to read registry at %s: %w", resolvedPath, err)
	}

	var reg ProjectRegistry
	if err := yaml.Unmarshal(data, &reg); err != nil {
		return nil, fmt.Errorf("invalid registry YAML format in %s: %w", resolvedPath, err)
	}

	if reg.ProjectID == "" {
		base := filepath.Base(resolvedPath)
		ext := filepath.Ext(base)
		reg.ProjectID = strings.TrimSuffix(base, ext)
	}
	if reg.Name == "" {
		reg.Name = reg.ProjectID
	}
	reg.SourcePath = resolvedPath

	return &reg, nil
}

// SaveRegistry serializes and writes a ProjectRegistry to the specified output path.
func SaveRegistry(registry *ProjectRegistry, outputPath string) (string, error) {
	if registry == nil {
		return "", errors.New("registry cannot be nil")
	}

	absOut, err := filepath.Abs(outputPath)
	if err != nil {
		absOut = outputPath
	}

	parentDir := filepath.Dir(absOut)
	if err := os.MkdirAll(parentDir, 0755); err != nil {
		return "", fmt.Errorf("failed to create directory %s: %w", parentDir, err)
	}

	data, err := yaml.Marshal(registry)
	if err != nil {
		return "", fmt.Errorf("failed to marshal registry to YAML: %w", err)
	}

	if err := os.WriteFile(absOut, data, 0644); err != nil {
		return "", fmt.Errorf("failed to write registry to %s: %w", absOut, err)
	}

	registry.SourcePath = absOut

	// Register project in the global machine-wide catalog
	_ = RegisterProjectInCatalog(registry.ProjectID, ProjectCatalogEntry{
		Name:         registry.Name,
		Description:  registry.Description,
		RegistryPath: absOut,
		RootPath:     parentDir,
	})

	return absOut, nil
}
