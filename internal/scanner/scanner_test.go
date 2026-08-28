package scanner

import (
	"os"
	"path/filepath"
	"sort"
	"testing"
)

func TestScannerMultiStack(t *testing.T) {
	tmpWorkspace, err := os.MkdirTemp("", "scanner-test-*")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(tmpWorkspace)

	// 1. Node.js backend
	beDir := filepath.Join(tmpWorkspace, "backend-service")
	os.MkdirAll(beDir, 0755)
	os.WriteFile(filepath.Join(beDir, "package.json"), []byte(`{
		"name": "backend-service",
		"main": "src/server.js",
		"dependencies": {
			"express": "^4.18.2",
			"jsonwebtoken": "^9.0.0",
			"redis": "^4.6.7"
		}
	}`), 0644)
	os.WriteFile(filepath.Join(beDir, ".env"), []byte("PORT=4000\nNODE_ENV=production\n"), 0644)

	// 2. React frontend
	feDir := filepath.Join(tmpWorkspace, "frontend-app")
	os.MkdirAll(feDir, 0755)
	os.WriteFile(filepath.Join(feDir, "package.json"), []byte(`{
		"name": "frontend-app",
		"main": "src/main.tsx",
		"dependencies": {
			"react": "^18.2.0",
			"axios": "^1.4.0"
		}
	}`), 0644)
	os.WriteFile(filepath.Join(feDir, ".env"), []byte("PORT=3000\nVITE_API_URL=http://localhost:4000\n"), 0644)

	// 3. Python FastAPI
	pyDir := filepath.Join(tmpWorkspace, "ml-service")
	os.MkdirAll(pyDir, 0755)
	os.WriteFile(filepath.Join(pyDir, "requirements.txt"), []byte("fastapi==0.100.0\nuvicorn==0.22.0\n"), 0644)
	os.WriteFile(filepath.Join(pyDir, "main.py"), []byte("import uvicorn\nif __name__ == '__main__':\n    uvicorn.run(port=8000)\n"), 0644)

	// 4. Go Gin
	goDir := filepath.Join(tmpWorkspace, "gateway-service")
	os.MkdirAll(goDir, 0755)
	os.WriteFile(filepath.Join(goDir, "go.mod"), []byte("module test/gateway\n\ngo 1.20\n\nrequire github.com/gin-gonic/gin v1.9.1\n"), 0644)
	os.WriteFile(filepath.Join(goDir, "main.go"), []byte("package main\nfunc main() {}\n"), 0644)
	os.WriteFile(filepath.Join(goDir, ".env"), []byte("PORT=8080\n"), 0644)

	registry, err := ScanWorkspace(tmpWorkspace, "test-workspace")
	if err != nil {
		t.Fatalf("ScanWorkspace failed: %v", err)
	}

	if registry.ProjectID != "test-workspace" {
		t.Fatalf("Expected project ID 'test-workspace', got %s", registry.ProjectID)
	}

	if len(registry.Repos) != 4 {
		t.Fatalf("Expected 4 repos, got %d", len(registry.Repos))
	}

	var names []string
	for _, r := range registry.Repos {
		names = append(names, r.Name)
	}
	sort.Strings(names)
	expectedNames := []string{"backend-service", "frontend-app", "gateway-service", "ml-service"}
	for i, name := range names {
		if name != expectedNames[i] {
			t.Fatalf("Expected repo %s, got %s", expectedNames[i], name)
		}
	}

	be := registry.GetRepo("backend-service")
	if be == nil || be.Port == nil || *be.Port != 4000 {
		t.Fatalf("Backend port mismatch: %+v", be)
	}

	fe := registry.GetRepo("frontend-app")
	if fe == nil || fe.Port == nil || *fe.Port != 3000 {
		t.Fatalf("Frontend port mismatch: %+v", fe)
	}

	// Verify relationships inferred
	var feCalls []string
	for _, rel := range registry.Relationships {
		if rel.Source == "frontend-app" && rel.Target == "backend-service" {
			feCalls = append(feCalls, rel.Type)
		}
	}
	if len(feCalls) == 0 {
		t.Fatal("Expected relationships between frontend and backend")
	}
}
