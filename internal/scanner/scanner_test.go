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
	os.WriteFile(filepath.Join(goDir, ".env"), []byte("PORT=43770\n"), 0644)

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

func TestScannerNestedServices(t *testing.T) {
	tmpWorkspace, err := os.MkdirTemp("", "scanner-nested-*")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(tmpWorkspace)

	// Create nested structure: workspace/services/auth, workspace/services/account, workspace/apps/web
	authDir := filepath.Join(tmpWorkspace, "services", "auth-service")
	os.MkdirAll(authDir, 0755)
	os.WriteFile(filepath.Join(authDir, "go.mod"), []byte("module bank/auth\n\ngo 1.22\n"), 0644)

	accDir := filepath.Join(tmpWorkspace, "services", "account-service")
	os.MkdirAll(accDir, 0755)
	os.WriteFile(filepath.Join(accDir, "package.json"), []byte(`{"name":"account-service"}`), 0644)

	webDir := filepath.Join(tmpWorkspace, "apps", "web-portal")
	os.MkdirAll(webDir, 0755)
	os.WriteFile(filepath.Join(webDir, "package.json"), []byte(`{"name":"web-portal"}`), 0644)

	reg, err := ScanWorkspace(tmpWorkspace, "bank-nested")
	if err != nil {
		t.Fatalf("ScanWorkspace failed: %v", err)
	}

	if len(reg.Repos) != 3 {
		t.Fatalf("Expected 3 nested repos, found %d: %+v", len(reg.Repos), reg.Repos)
	}
}

func TestPortRefinementNoFalsePositive(t *testing.T) {
	tmpWorkspace, err := os.MkdirTemp("", "port-refine-*")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(tmpWorkspace)

	// Service A on port 3000
	srvA := filepath.Join(tmpWorkspace, "service-a")
	os.MkdirAll(srvA, 0755)
	os.WriteFile(filepath.Join(srvA, "package.json"), []byte(`{"name":"service-a","main":"index.js"}`), 0644)
	os.WriteFile(filepath.Join(srvA, ".env"), []byte("PORT=3000\n"), 0644)
	os.WriteFile(filepath.Join(srvA, "index.js"), []byte("const port = 3000;"), 0644)

	// Service B has a setTimeout with 3000ms delay, but NO network reference to service A
	srvB := filepath.Join(tmpWorkspace, "service-b")
	os.MkdirAll(srvB, 0755)
	os.WriteFile(filepath.Join(srvB, "package.json"), []byte(`{"name":"service-b","main":"index.js"}`), 0644)
	os.WriteFile(filepath.Join(srvB, ".env"), []byte("PORT=5000\n"), 0644)
	os.WriteFile(filepath.Join(srvB, "index.js"), []byte(`
		function wait() {
			setTimeout(doSomething, 3000);
			const maxLimit = 3000;
		}
	`), 0644)

	reg, err := ScanWorkspace(tmpWorkspace, "port-test")
	if err != nil {
		t.Fatalf("ScanWorkspace failed: %v", err)
	}

	for _, rel := range reg.Relationships {
		if rel.Source == "service-b" && rel.Target == "service-a" && rel.Type == "api_call" {
			t.Fatalf("Unexpected false positive api_call from service-b to service-a based on raw 3000 number: %+v", rel)
		}
	}
}

func TestMonorepoWorkspaceTraversal(t *testing.T) {
	tmpWorkspace, err := os.MkdirTemp("", "monorepo-test-*")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(tmpWorkspace)

	// Monorepo container folder with pnpm-workspace.yaml
	monoDir := filepath.Join(tmpWorkspace, "my-monorepo")
	os.MkdirAll(monoDir, 0755)
	os.WriteFile(filepath.Join(monoDir, "package.json"), []byte(`{"name":"root-monorepo","private":true,"workspaces":["packages/*"]}`), 0644)
	os.WriteFile(filepath.Join(monoDir, "pnpm-workspace.yaml"), []byte("packages:\n  - 'packages/*'\n"), 0644)

	// Sub-package 1
	pkg1 := filepath.Join(monoDir, "packages", "pkg-core")
	os.MkdirAll(pkg1, 0755)
	os.WriteFile(filepath.Join(pkg1, "package.json"), []byte(`{"name":"pkg-core","main":"index.js"}`), 0644)

	// Sub-package 2
	pkg2 := filepath.Join(monoDir, "packages", "pkg-ui")
	os.MkdirAll(pkg2, 0755)
	os.WriteFile(filepath.Join(pkg2, "package.json"), []byte(`{"name":"pkg-ui","main":"index.js"}`), 0644)

	reg, err := ScanWorkspace(tmpWorkspace, "mono-test")
	if err != nil {
		t.Fatalf("ScanWorkspace failed: %v", err)
	}

	names := make(map[string]bool)
	for _, r := range reg.Repos {
		names[r.Name] = true
	}

	if !names["pkg-core"] || !names["pkg-ui"] {
		t.Fatalf("Expected nested packages pkg-core and pkg-ui to be discovered, found: %+v", reg.Repos)
	}
	if names["root-monorepo"] {
		t.Fatalf("Monorepo container root-monorepo should not be registered as a leaf repo")
	}
}


