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
			if (strings.HasPrefix(name, ".") && !strings.HasPrefix(name, ".env")) || ignoredDirs[name] {
				continue
			}
			full := filepath.Join(currentDir, name)
			if !entry.IsDir() {
				ext := filepath.Ext(name)
				isEnv := strings.HasPrefix(name, ".env")
				if codeExtensions[ext] || isEnv {
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

		combinedContent := collectRepoCodeText(repoDir, 4)
		combinedContentLower := strings.ToLower(combinedContent)

		// Helper to avoid duplicate edges
		addEdge := func(src, tgt, rType, desc string) {
			if strings.EqualFold(src, tgt) {
				return
			}
			for _, rel := range relationships {
				if strings.EqualFold(rel.Source, src) && strings.EqualFold(rel.Target, tgt) && strings.EqualFold(rel.Type, rType) {
					return
				}
			}
			relationships = append(relationships, registry.RelationshipInfo{
				Source:      src,
				Target:      tgt,
				Type:        rType,
				Description: desc,
			})
		}

		// 1. Check port connections (requires network or config port context)
		for targetPort, targetName := range repoPortMap {
			if strings.EqualFold(targetName, repo.Name) {
				continue
			}
			if hasPortReference(combinedContent, targetPort) {
				addEdge(repo.Name, targetName, "api_call", fmt.Sprintf("%s communicates with %s on port %d", repo.Name, targetName, targetPort))
			}
		}

		// 2. Check service name / routing mentions in configs and code
		isGateway := strings.Contains(strings.ToLower(repo.Name), "gateway") || strings.Contains(strings.ToLower(repo.Name), "proxy")
		isDiscovery := strings.Contains(strings.ToLower(repo.Name), "discovery") || strings.Contains(strings.ToLower(repo.Name), "eureka") || strings.Contains(strings.ToLower(repo.Name), "consul")

		for _, target := range repos {
			if strings.EqualFold(target.Name, repo.Name) {
				continue
			}
			tNameLower := strings.ToLower(target.Name)
			tBaseLower := strings.TrimSuffix(tNameLower, "-service")
			tBaseLower = strings.TrimSuffix(tBaseLower, "-app")
			tBaseLower = strings.TrimSuffix(tBaseLower, "-api")

			targetIsDiscovery := strings.Contains(tNameLower, "discovery") || strings.Contains(tNameLower, "eureka")

			// Check if target name is referenced
			if strings.Contains(combinedContentLower, tNameLower) || (len(tBaseLower) >= 4 && strings.Contains(combinedContentLower, tBaseLower)) {
				if targetIsDiscovery {
					addEdge(repo.Name, target.Name, "registers_with", fmt.Sprintf("%s registers with service registry %s", repo.Name, target.Name))
				} else if isGateway {
					addEdge(repo.Name, target.Name, "routes_to", fmt.Sprintf("API Gateway routes traffic to %s", target.Name))
				} else {
					addEdge(repo.Name, target.Name, "api_call", fmt.Sprintf("%s invokes service %s", repo.Name, target.Name))
				}
			}

			// Spring Cloud Discovery default convention: microservices register with discovery-service
			if targetIsDiscovery && !isGateway && !isDiscovery {
				if strings.Contains(combinedContentLower, "eureka") || strings.Contains(combinedContentLower, "discovery") || strings.Contains(combinedContentLower, "cloud") {
					addEdge(repo.Name, target.Name, "registers_with", fmt.Sprintf("%s registers with service registry %s", repo.Name, target.Name))
				}
			}

			// API Gateway convention: routes to backend microservices
			if isGateway && !targetIsDiscovery {
				addEdge(repo.Name, target.Name, "routes_to", fmt.Sprintf("API Gateway routes incoming client traffic to %s", target.Name))
			}
		}

		// 3. Check frontend-to-backend conventions
		isFrontend := hasTechStack(repo.TechStack, "React", "Vue", "Angular", "Next.js") ||
			strings.Contains(strings.ToLower(repo.Name), "fe") ||
			strings.Contains(strings.ToLower(repo.Name), "frontend")

		if isFrontend {
			var gatewayRepo *registry.RepoInfo
			for i := range repos {
				rNameLower := strings.ToLower(repos[i].Name)
				if strings.Contains(rNameLower, "gateway") || strings.Contains(rNameLower, "proxy") {
					gatewayRepo = &repos[i]
					break
				}
			}

			if gatewayRepo != nil && !strings.EqualFold(gatewayRepo.Name, repo.Name) {
				// With Gateway: Route frontend client requests through Gateway
				addEdge(repo.Name, gatewayRepo.Name, "api_call", fmt.Sprintf("%s routes requests through API Gateway %s", repo.Name, gatewayRepo.Name))
				addEdge(repo.Name, gatewayRepo.Name, "depends_on", fmt.Sprintf("%s depends on %s contracts", repo.Name, gatewayRepo.Name))

				// Direct connection if frontend explicitly references a backend service or its port
				for _, target := range repos {
					if strings.EqualFold(target.Name, repo.Name) || strings.EqualFold(target.Name, gatewayRepo.Name) {
						continue
					}
					hasDirectRef := (target.Port != nil && hasPortReference(combinedContent, *target.Port)) ||
						strings.Contains(combinedContentLower, strings.ToLower(target.Name))
					if hasDirectRef {
						addEdge(repo.Name, target.Name, "api_call", fmt.Sprintf("%s invokes REST/GraphQL endpoints on %s", repo.Name, target.Name))
						addEdge(repo.Name, target.Name, "depends_on", fmt.Sprintf("%s depends on %s contracts", repo.Name, target.Name))
					}
				}
			} else {
				// No Gateway: Connect directly to backend microservices
				for _, target := range repos {
					if strings.EqualFold(target.Name, repo.Name) {
						continue
					}
					isBackend := hasTechStack(target.TechStack, "Express", "FastAPI", "Django", "Spring Boot", "NestJS", "Gin", "Fiber", "Echo") ||
						strings.Contains(strings.ToLower(target.Name), "be") ||
						strings.Contains(strings.ToLower(target.Name), "backend") ||
						strings.Contains(strings.ToLower(target.Name), "api")

					if isBackend {
						addEdge(repo.Name, target.Name, "api_call", fmt.Sprintf("%s invokes REST/GraphQL endpoints on %s", repo.Name, target.Name))
						addEdge(repo.Name, target.Name, "depends_on", fmt.Sprintf("%s depends on %s contracts", repo.Name, target.Name))
					}
				}
			}
		}
	}

	return relationships
}

// hasPortReference checks if a port appears in a network, URL, or configuration context.
func hasPortReference(content string, port int) bool {
	portStr := strconv.Itoa(port)
	if strings.Contains(content, ":"+portStr) ||
		strings.Contains(content, "localhost:"+portStr) ||
		strings.Contains(content, "127.0.0.1:"+portStr) ||
		strings.Contains(content, "0.0.0.0:"+portStr) ||
		strings.Contains(content, "PORT="+portStr) ||
		strings.Contains(content, "PORT = "+portStr) ||
		strings.Contains(content, "PORT: "+portStr) ||
		strings.Contains(content, "port="+portStr) ||
		strings.Contains(content, "port = "+portStr) ||
		strings.Contains(content, "port: "+portStr) {
		return true
	}
	return false
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
