package scanner

import (
	"os"
	"path/filepath"
	"regexp"
	"strconv"
)

var portEnvRegex = regexp.MustCompile(`(?i)(?:PORT|APP_PORT|SERVER_PORT)\s*=\s*(\d{2,5})`)
var portCodeRegexes = []*regexp.Regexp{
	regexp.MustCompile(`(?i)(?:port|listen)\s*[:=(]\s*(?:process\.env\.PORT\s*\|\|\s*)?(\d{2,5})`),
	regexp.MustCompile(`(?i)(?:Run|Listen|ListenAndServe)\s*\(\s*["']:?(\d{2,5})["']`),
	regexp.MustCompile(`(?i)EXPOSE\s+(\d{2,5})`),
	regexp.MustCompile(`["']?(\d{2,5}):(\d{2,5})["']?`),
	regexp.MustCompile(`(?i)(?:server\.port|port)\s*[:=]\s*(\d{2,5})`),
}

var filesToScanForPort = []string{
	"app.js", "server.js", "index.js", "src/index.js", "src/server.js",
	"app.ts", "server.ts", "index.ts", "src/index.ts", "src/server.ts", "src/main.ts",
	"vite.config.ts", "vite.config.js",
	"Dockerfile", "docker-compose.yml", "docker-compose.yaml",
	"main.py", "app/main.py",
	"main.go", "cmd/main.go", "src/main.go",
	"application.properties", "application.yml", "application.yaml",
	"src/main/resources/application.properties", "src/main/resources/application.yml", "src/main/resources/application.yaml",
}

// InferPort inspects environment files and source code to identify listening ports.
func InferPort(repoDir string) *int {
	// 1. Check .env files
	envFiles := []string{".env", ".env.local", ".env.development", ".env.example"}
	for _, ef := range envFiles {
		fullPath := filepath.Join(repoDir, ef)
		if data, err := os.ReadFile(fullPath); err == nil {
			if match := portEnvRegex.FindSubmatch(data); len(match) > 1 {
				if p, err := strconv.Atoi(string(match[1])); err == nil && p > 0 && p < 65536 {
					return &p
				}
			}
		}
	}

	// 2. Scan entry points and configs
	for _, file := range filesToScanForPort {
		fullPath := filepath.Join(repoDir, file)
		if data, err := os.ReadFile(fullPath); err == nil {
			for _, re := range portCodeRegexes {
				if match := re.FindSubmatch(data); len(match) > 1 {
					if p, err := strconv.Atoi(string(match[1])); err == nil && p > 80 && p < 65536 {
						return &p
					}
				}
			}
		}
	}

	return nil
}
