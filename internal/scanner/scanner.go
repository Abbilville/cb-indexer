package scanner

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"cb-indexer/internal/registry"
)

var nodeLibMap = map[string]string{
	"react":                 "React",
	"react-dom":             "React",
	"express":               "Express",
	"@nestjs/core":          "NestJS",
	"next":                  "Next.js",
	"vue":                   "Vue",
	"nuxt":                  "Nuxt",
	"@angular/core":         "Angular",
	"sequelize":             "Sequelize (PostgreSQL/MySQL)",
	"prisma":                "Prisma",
	"@prisma/client":        "Prisma",
	"typeorm":               "TypeORM",
	"mongoose":              "Mongoose (MongoDB)",
	"redis":                 "Redis",
	"ioredis":               "Redis",
	"firebase-admin":        "Firebase Admin",
	"firebase":              "Firebase",
	"@aws-sdk/client-s3":    "AWS SDK v3 (S3)",
	"aws-sdk":               "AWS SDK",
	"jsonwebtoken":          "JWT",
	"axios":                 "Axios",
	"@tanstack/react-query": "React Query (TanStack)",
	"react-query":           "React Query",
	"@reduxjs/toolkit":      "Redux Toolkit",
	"redux":                 "Redux",
	"@mui/material":         "MUI (Material UI)",
	"tailwindcss":           "Tailwind CSS",
	"formik":                "Formik",
	"yup":                   "Yup",
	"apexcharts":            "ApexCharts",
	"chart.js":              "Chart.js",
	"winston":               "Winston",
	"socket.io":             "Socket.IO",
	"socket.io-client":      "Socket.IO Client",
}

var pythonLibMap = map[string]string{
	"fastapi":      "FastAPI",
	"flask":        "Flask",
	"django":       "Django",
	"sqlalchemy":   "SQLAlchemy",
	"tortoise-orm": "Tortoise ORM",
	"redis":        "Redis",
	"celery":       "Celery",
	"pydantic":     "Pydantic",
	"alembic":      "Alembic",
	"httpx":        "HTTPX",
	"requests":     "Requests",
	"boto3":        "AWS SDK (Boto3)",
	"jwt":          "PyJWT",
	"langchain":    "LangChain",
}

// CleanGitURL converts git SSH or HTTPS URLs into standard https URLs without .git suffix.
func CleanGitURL(raw string) string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return ""
	}
	raw = strings.TrimPrefix(raw, "git+")
	// Handle git@github.com:owner/repo.git
	if strings.HasPrefix(raw, "git@") {
		parts := strings.SplitN(raw, ":", 2)
		if len(parts) == 2 {
			host := strings.TrimPrefix(parts[0], "git@")
			path := strings.TrimSuffix(parts[1], ".git")
			return fmt.Sprintf("https://%s/%s", host, path)
		}
	}
	// Handle ssh://git@github.com/owner/repo.git
	if strings.HasPrefix(raw, "ssh://git@") {
		raw = "https://" + strings.TrimPrefix(raw, "ssh://git@")
	}
	clean := strings.TrimSuffix(raw, ".git")
	if strings.HasPrefix(clean, "http://") || strings.HasPrefix(clean, "https://") {
		return clean
	}
	// Handle github:owner/repo shorthand
	if strings.HasPrefix(clean, "github:") {
		return "https://github.com/" + strings.TrimPrefix(clean, "github:")
	}
	return clean
}

// GetGitRemoteURL inspects dir for a git remote origin URL by reading .git/config.
func GetGitRemoteURL(dir string) string {
	if dir == "" {
		return ""
	}

	gitPath := filepath.Join(dir, ".git")
	stat, err := os.Stat(gitPath)
	if err != nil {
		return ""
	}

	gitConfigPath := filepath.Join(gitPath, "config")
	// Handle git worktree or submodule where .git is a file containing "gitdir: ..."
	if !stat.IsDir() {
		data, err := os.ReadFile(gitPath)
		if err == nil {
			line := strings.TrimSpace(string(data))
			if strings.HasPrefix(line, "gitdir:") {
				realDir := strings.TrimSpace(strings.TrimPrefix(line, "gitdir:"))
				if !filepath.IsAbs(realDir) {
					realDir = filepath.Join(dir, realDir)
				}
				gitConfigPath = filepath.Join(realDir, "config")
			}
		}
	}

	content, err := os.ReadFile(gitConfigPath)
	if err != nil {
		return ""
	}

	lines := strings.Split(string(content), "\n")
	inOrigin := false
	for _, line := range lines {
		trimmed := strings.TrimSpace(line)
		if strings.HasPrefix(trimmed, "[remote ") {
			inOrigin = strings.Contains(trimmed, "\"origin\"") || strings.Contains(trimmed, "origin")
			continue
		}
		if inOrigin && strings.HasPrefix(trimmed, "url =") {
			raw := strings.TrimSpace(strings.TrimPrefix(trimmed, "url ="))
			return CleanGitURL(raw)
		}
	}

	// Fallback: search for any remote url if origin section header differed
	for _, line := range lines {
		trimmed := strings.TrimSpace(line)
		if strings.HasPrefix(trimmed, "url =") {
			raw := strings.TrimSpace(strings.TrimPrefix(trimmed, "url ="))
			return CleanGitURL(raw)
		}
	}

	return ""
}

type scannedRepoData struct {
	Name        string
	TechStack   []string
	EntryPoint  string
	Description string
	GitURL      string
}

func scanPackageJSON(repoDir string) *scannedRepoData {
	pkgFile := filepath.Join(repoDir, "package.json")
	data, err := os.ReadFile(pkgFile)
	if err != nil {
		return nil
	}

	var pkg struct {
		Name            string            `json:"name"`
		Main            string            `json:"main"`
		Description     string            `json:"description"`
		Dependencies    map[string]string `json:"dependencies"`
		DevDependencies map[string]string `json:"devDependencies"`
		Repository      any               `json:"repository"`
	}
	if err := json.Unmarshal(data, &pkg); err != nil {
		return nil
	}

	pkgGitURL := ""
	if repoStr, ok := pkg.Repository.(string); ok {
		pkgGitURL = CleanGitURL(repoStr)
	} else if repoMap, ok := pkg.Repository.(map[string]any); ok {
		if urlVal, ok := repoMap["url"].(string); ok {
			pkgGitURL = CleanGitURL(urlVal)
		}
	}

	name := pkg.Name
	if name == "" {
		name = filepath.Base(repoDir)
	}

	techStack := []string{"Node.js"}
	allDeps := make(map[string]bool)
	for k := range pkg.Dependencies {
		allDeps[k] = true
	}
	for k := range pkg.DevDependencies {
		allDeps[k] = true
	}

	for depKey, label := range nodeLibMap {
		if allDeps[depKey] {
			techStack = append(techStack, label)
		}
	}

	entryPoint := pkg.Main
	if entryPoint == "" {
		candidates := []string{
			"app.js", "server.js", "src/index.js", "src/index.ts", "src/index.tsx",
			"src/main.js", "src/main.ts", "src/main.tsx", "src/server.js", "src/server.ts",
			"src/app.js", "src/app.ts", "src/App.tsx", "index.js", "index.ts", "index.tsx",
		}
		for _, cand := range candidates {
			if _, err := os.Stat(filepath.Join(repoDir, cand)); err == nil {
				entryPoint = cand
				break
			}
		}
	}

	return &scannedRepoData{
		Name:        name,
		TechStack:   techStack,
		EntryPoint:  entryPoint,
		Description: pkg.Description,
		GitURL:      pkgGitURL,
	}
}

func scanPythonDir(repoDir string) *scannedRepoData {
	reqFile := filepath.Join(repoDir, "requirements.txt")
	pyproject := filepath.Join(repoDir, "pyproject.toml")
	setupPy := filepath.Join(repoDir, "setup.py")

	hasPy := false
	var content strings.Builder
	for _, f := range []string{reqFile, pyproject, setupPy} {
		if data, err := os.ReadFile(f); err == nil {
			hasPy = true
			content.WriteString(strings.ToLower(string(data)))
			content.WriteString("\n")
		}
	}
	if !hasPy {
		return nil
	}

	techStack := []string{"Python"}
	text := content.String()
	for depKey, label := range pythonLibMap {
		if strings.Contains(text, depKey) {
			techStack = append(techStack, label)
		}
	}

	entryPoint := ""
	candidates := []string{
		"main.py", "app.py", "src/main.py", "app/main.py", "app/api.py", "src/app/main.py", "manage.py", "wsgi.py",
	}
	for _, cand := range candidates {
		if _, err := os.Stat(filepath.Join(repoDir, cand)); err == nil {
			entryPoint = cand
			break
		}
	}

	return &scannedRepoData{
		Name:       filepath.Base(repoDir),
		TechStack:  techStack,
		EntryPoint: entryPoint,
	}
}

func scanJavaDir(repoDir string) *scannedRepoData {
	pom := filepath.Join(repoDir, "pom.xml")
	gradle := filepath.Join(repoDir, "build.gradle")
	gradleKts := filepath.Join(repoDir, "build.gradle.kts")

	var content strings.Builder
	hasJava := false
	techStack := []string{"Java"}

	if data, err := os.ReadFile(pom); err == nil {
		hasJava = true
		techStack = append(techStack, "Maven")
		content.WriteString(strings.ToLower(string(data)))
	}
	if data, err := os.ReadFile(gradle); err == nil {
		hasJava = true
		techStack = append(techStack, "Gradle")
		content.WriteString(strings.ToLower(string(data)))
	}
	if data, err := os.ReadFile(gradleKts); err == nil {
		hasJava = true
		techStack = append(techStack, "Gradle")
		content.WriteString(strings.ToLower(string(data)))
	}

	if !hasJava {
		return nil
	}

	if strings.Contains(content.String(), "spring-boot") {
		techStack = append(techStack, "Spring Boot")
	}

	return &scannedRepoData{
		Name:       filepath.Base(repoDir),
		TechStack:  techStack,
		EntryPoint: "src/main/java",
	}
}

func scanGoDir(repoDir string) *scannedRepoData {
	goMod := filepath.Join(repoDir, "go.mod")
	data, err := os.ReadFile(goMod)
	if err != nil {
		return nil
	}

	techStack := []string{"Go"}
	content := strings.ToLower(string(data))
	if strings.Contains(content, "gin-gonic/gin") {
		techStack = append(techStack, "Gin")
	}
	if strings.Contains(content, "gofiber/fiber") {
		techStack = append(techStack, "Fiber")
	}
	if strings.Contains(content, "labstack/echo") {
		techStack = append(techStack, "Echo")
	}

	return &scannedRepoData{
		Name:       filepath.Base(repoDir),
		TechStack:  techStack,
		EntryPoint: "main.go",
	}
}

func scanRustDir(repoDir string) *scannedRepoData {
	cargo := filepath.Join(repoDir, "Cargo.toml")
	if _, err := os.Stat(cargo); err == nil {
		return &scannedRepoData{
			Name:       filepath.Base(repoDir),
			TechStack:  []string{"Rust"},
			EntryPoint: "src/main.rs",
		}
	}
	return nil
}

func scanPhpDir(repoDir string) *scannedRepoData {
	composer := filepath.Join(repoDir, "composer.json")
	if _, err := os.Stat(composer); err == nil {
		return &scannedRepoData{
			Name:       filepath.Base(repoDir),
			TechStack:  []string{"PHP"},
			EntryPoint: "index.php",
		}
	}
	return nil
}

func scanDotNetDir(repoDir string) *scannedRepoData {
	entries, err := os.ReadDir(repoDir)
	if err != nil {
		return nil
	}
	for _, e := range entries {
		if !e.IsDir() && (strings.HasSuffix(e.Name(), ".csproj") || strings.HasSuffix(e.Name(), ".fsproj") || strings.HasSuffix(e.Name(), ".sln")) {
			return &scannedRepoData{
				Name:       filepath.Base(repoDir),
				TechStack:  []string{".NET", "C#"},
				EntryPoint: "Program.cs",
			}
		}
	}
	return nil
}

func scanDockerDir(repoDir string) *scannedRepoData {
	dockerfile := filepath.Join(repoDir, "Dockerfile")
	compose := filepath.Join(repoDir, "docker-compose.yml")
	if _, err := os.Stat(dockerfile); err == nil {
		return &scannedRepoData{
			Name:       filepath.Base(repoDir),
			TechStack:  []string{"Docker"},
			EntryPoint: "Dockerfile",
		}
	}
	if _, err := os.Stat(compose); err == nil {
		return &scannedRepoData{
			Name:       filepath.Base(repoDir),
			TechStack:  []string{"Docker Compose"},
			EntryPoint: "docker-compose.yml",
		}
	}
	return nil
}

func scanGitDir(repoDir string) *scannedRepoData {
	gitDir := filepath.Join(repoDir, ".git")
	if stat, err := os.Stat(gitDir); err == nil && stat.IsDir() {
		return &scannedRepoData{
			Name:       filepath.Base(repoDir),
			TechStack:  []string{"Git Repo"},
			EntryPoint: "",
		}
	}
	return nil
}

var repoMatchers = []func(string) *scannedRepoData{
	scanPackageJSON,
	scanGoDir,
	scanJavaDir,
	scanPythonDir,
	scanRustDir,
	scanDotNetDir,
	scanPhpDir,
	scanDockerDir,
	scanGitDir,
}

// matchRepo attempts to match any supported technology stack in target directory.
func matchRepo(dir string) *scannedRepoData {
	for _, fn := range repoMatchers {
		if m := fn(dir); m != nil {
			return m
		}
	}
	return nil
}

// isMonorepoWorkspace checks if a directory defines a monorepo workspace container (pnpm, lerna, npm workspaces, go.work).
func isMonorepoWorkspace(dir string) bool {
	for _, f := range []string{"pnpm-workspace.yaml", "pnpm-workspace.yml", "lerna.json", "go.work"} {
		if _, err := os.Stat(filepath.Join(dir, f)); err == nil {
			return true
		}
	}
	pkgPath := filepath.Join(dir, "package.json")
	if data, err := os.ReadFile(pkgPath); err == nil {
		var raw map[string]any
		if err := json.Unmarshal(data, &raw); err == nil {
			if _, ok := raw["workspaces"]; ok {
				return true
			}
		}
	}
	return false
}

// ScanWorkspace inspects targetDir recursively for repositories, frameworks, ports, and inter-service relationships.
func ScanWorkspace(targetDir string, projectID string) (*registry.ProjectRegistry, error) {
	absDir, err := filepath.Abs(targetDir)
	if err != nil {
		absDir = targetDir
	}

	stat, err := os.Stat(absDir)
	if err != nil || !stat.IsDir() {
		return nil, fmt.Errorf("workspace directory not found: %s", absDir)
	}

	rootGitURL := GetGitRemoteURL(absDir)

	var repos []registry.RepoInfo
	visited := make(map[string]bool)

	var scanDir func(dir string, depth int)
	scanDir = func(dir string, depth int) {
		if depth > 4 || visited[dir] {
			return
		}
		visited[dir] = true

		// Check if this subdirectory is a microservice / repository
		if dir != absDir {
			isWorkspace := isMonorepoWorkspace(dir)
			if match := matchRepo(dir); match != nil {
				port := InferPort(dir)

				serviceGitURL := GetGitRemoteURL(dir)
				gitURL := ""
				gitOrigin := ""
				if serviceGitURL != "" && serviceGitURL != rootGitURL {
					gitURL = serviceGitURL
					gitOrigin = "service"
				} else if rootGitURL != "" {
					gitOrigin = "root"
					relPath, err := filepath.Rel(absDir, dir)
					if err == nil && relPath != "." && relPath != "" {
						gitURL = fmt.Sprintf("%s/tree/main/%s", rootGitURL, strings.ReplaceAll(relPath, "\\", "/"))
					} else {
						gitURL = rootGitURL
					}
				} else if match.GitURL != "" {
					gitURL = match.GitURL
					gitOrigin = "service"
				}

				if !isWorkspace {
					repos = append(repos, registry.RepoInfo{
						Name:        match.Name,
						LocalPath:   strings.ReplaceAll(dir, "\\", "/"),
						Description: match.Description,
						TechStack:   match.TechStack,
						EntryPoint:  match.EntryPoint,
						Port:        port,
						GitURL:      gitURL,
						GitOrigin:   gitOrigin,
					})
					return // Found a leaf service, do not descend deeper inside its code tree
				}
				// Monorepo container: continue traversing subdirectories to discover nested packages
			}
		}

		entries, err := os.ReadDir(dir)
		if err != nil {
			return
		}

		for _, entry := range entries {
			if !entry.IsDir() || ignoredDirs[entry.Name()] || strings.HasPrefix(entry.Name(), ".") {
				continue
			}
			subDir := filepath.Join(dir, entry.Name())
			scanDir(subDir, depth+1)
		}
	}

	scanDir(absDir, 0)

	// If no nested services were found, check if root itself is a single repo
	if len(repos) == 0 {
		if selfMatch := matchRepo(absDir); selfMatch != nil {
			port := InferPort(absDir)
			gitURL := rootGitURL
			gitOrigin := ""
			if gitURL != "" {
				gitOrigin = "root"
			} else if selfMatch.GitURL != "" {
				gitURL = selfMatch.GitURL
				gitOrigin = "service"
			}
			repos = append(repos, registry.RepoInfo{
				Name:        selfMatch.Name,
				LocalPath:   strings.ReplaceAll(absDir, "\\", "/"),
				Description: selfMatch.Description,
				TechStack:   selfMatch.TechStack,
				EntryPoint:  selfMatch.EntryPoint,
				Port:        port,
				GitURL:      gitURL,
				GitOrigin:   gitOrigin,
			})
		}
	}

	relationships := InferRelationships(repos, absDir)

	pID := projectID
	if pID == "" {
		pID = filepath.Base(absDir)
	}

	return &registry.ProjectRegistry{
		ProjectID:     pID,
		Name:          fmt.Sprintf("%s Ecosystem", pID),
		Description:   fmt.Sprintf("Auto-scanned project at %s", absDir),
		GitURL:        rootGitURL,
		Repos:         repos,
		Relationships: relationships,
		SourcePath:    filepath.Join(absDir, "registry.yaml"),
	}, nil
}
