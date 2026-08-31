package scanner

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"oss-indexer/internal/registry"
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

type scannedRepoData struct {
	Name        string
	TechStack   []string
	EntryPoint  string
	Description string
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
	}
	if err := json.Unmarshal(data, &pkg); err != nil {
		return nil
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
			if match := matchRepo(dir); match != nil {
				port := InferPort(dir)
				repos = append(repos, registry.RepoInfo{
					Name:        match.Name,
					LocalPath:   strings.ReplaceAll(dir, "\\", "/"),
					Description: match.Description,
					TechStack:   match.TechStack,
					EntryPoint:  match.EntryPoint,
					Port:        port,
				})
				return // Found a service, do not descend deeper inside its code tree
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
			repos = append(repos, registry.RepoInfo{
				Name:        selfMatch.Name,
				LocalPath:   strings.ReplaceAll(absDir, "\\", "/"),
				Description: selfMatch.Description,
				TechStack:   selfMatch.TechStack,
				EntryPoint:  selfMatch.EntryPoint,
				Port:        port,
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
		Repos:         repos,
		Relationships: relationships,
		SourcePath:    filepath.Join(absDir, "registry.yaml"),
	}, nil
}
