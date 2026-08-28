package scanner

import (
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"oss-indexer/internal/registry"
)

var codeExtensions = map[string]bool{
	".js": true, ".ts": true, ".jsx": true, ".tsx": true,
	".py": true, ".json": true, ".env": true, ".yaml": true,
	".yml": true, ".properties": true, ".go": true, ".java": true,
}

var ignoredDirs = map[string]bool{
	".agents": true, ".claude": true, ".codex": true, ".cursor": true,
	".gemini": true, ".git": true, ".idea": true, ".mcp": true,
	".mcp.json": true, ".venv": true, ".vscode": true, "__pycache__": true,
	"build": true, "coverage": true, "dist": true, "node_modules": true,
	"target": true, "venv": true,
}

// collectRepoCodeText scans source files up to maxDepth and returns aggregated text for analysis.
func collectRepoCodeText(repoPath string, maxDepth int) string {
	var sb strings.Builder

	var walk func(currentDir string, currentDepth int)
	walk = func(currentDir string, currentDepth int) {
		if currentDepth > maxDepth {
			return
		}
		entries, err := os.ReadDir(currentDir)
		if err != nil {
			return
		}
		for _, entry := range entries {
			name := entry.Name()
			if strings.HasPrefix(name, ".") || ignoredDirs[name] {
				continue
			}
			full := filepath.Join(currentDir, name)
			if !entry.IsDir() {
				ext := filepath.Ext(name)
				if codeExtensions[ext] {
					if info, err := entry.Info(); err == nil && info.Size() < 256*1024 {
						if data, err := os.ReadFile(full); err == nil {
							sb.Write(data)
							sb.WriteString("\n")
						}
					}
				}
			} else if currentDepth < maxDepth {
				walk(full, currentDepth+1)
			}
		}
	}

	walk(repoPath, 1)
	return sb.String()
}

// InferRelationships discovers inter-service API and dependency links.
func InferRelationships(repos []registry.RepoInfo, workspacePath string) []registry.RelationshipInfo {
	var relationships []registry.RelationshipInfo
	repoPortMap := make(map[int]string)

	for _, r := range repos {
		if r.Port != nil {
			repoPortMap[*r.Port] = r.Name
		}
	}

	for _, repo := range repos {
		if repo.LocalPath == "" {
			continue
		}
		repoDir := repo.LocalPath
		if !filepath.IsAbs(repoDir) {
			repoDir = filepath.Join(workspacePath, repoDir)
		}
		if _, err := os.Stat(repoDir); err != nil {
			continue
		}

		combinedContent := collectRepoCodeText(repoDir, 3)

		// 1. Check port connections
		for targetPort, targetName := range repoPortMap {
			if strings.EqualFold(targetName, repo.Name) {
				continue
			}
			portStr := strconv.Itoa(targetPort)
			if strings.Contains(combinedContent, portStr) || strings.Contains(combinedContent, ":"+portStr) {
				relationships = append(relationships, registry.RelationshipInfo{
					Source:      repo.Name,
					Target:      targetName,
					Type:        "api_call",
					Description: fmt.Sprintf("%s communicates with %s on port %d", repo.Name, targetName, targetPort),
				})
			}
		}

		// 2. Check frontend-to-backend conventions
		isFrontend := hasTechStack(repo.TechStack, "React", "Vue", "Angular", "Next.js") ||
			strings.Contains(strings.ToLower(repo.Name), "fe") ||
			strings.Contains(strings.ToLower(repo.Name), "frontend")

		if isFrontend {
			for _, target := range repos {
				if strings.EqualFold(target.Name, repo.Name) {
					continue
				}
				isBackend := hasTechStack(target.TechStack, "Express", "FastAPI", "Django", "Spring Boot", "NestJS", "Gin", "Fiber", "Echo") ||
					strings.Contains(strings.ToLower(target.Name), "be") ||
					strings.Contains(strings.ToLower(target.Name), "backend") ||
					strings.Contains(strings.ToLower(target.Name), "api")

				if isBackend {
					alreadyExists := false
					for _, rel := range relationships {
						if strings.EqualFold(rel.Source, repo.Name) && strings.EqualFold(rel.Target, target.Name) {
							alreadyExists = true
							break
						}
					}
					if !alreadyExists {
						relationships = append(relationships,
							registry.RelationshipInfo{
								Source:      repo.Name,
								Target:      target.Name,
								Type:        "api_call",
								Description: fmt.Sprintf("%s invokes REST/GraphQL endpoints on %s", repo.Name, target.Name),
							},
							registry.RelationshipInfo{
								Source:      repo.Name,
								Target:      target.Name,
								Type:        "depends_on",
								Description: fmt.Sprintf("%s depends on %s for authentication state and data contracts", repo.Name, target.Name),
							},
						)
					}
				}
			}
		}
	}

	return relationships
}

func hasTechStack(stack []string, targets ...string) bool {
	for _, s := range stack {
		for _, t := range targets {
			if strings.EqualFold(s, t) {
				return true
			}
		}
	}
	return false
}
