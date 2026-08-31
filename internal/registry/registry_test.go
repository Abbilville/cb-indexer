package registry

import (
	"os"
	"path/filepath"
	"testing"
)

func TestRepoInfoAndRelationships(t *testing.T) {
	port := 4000
	repo := RepoInfo{
		Name:        "auth-service",
		Owner:       "security-team",
		LocalPath:   "./services/auth",
		Description: "Handles JWT tokens",
		TechStack:   []string{"Node.js", "Express", "JWT"},
		EntryPoint:  "src/server.js",
		Port:        &port,
		Tags:        []string{"auth", "backend"},
	}

	if repo.Name != "auth-service" || *repo.Port != 4000 {
		t.Fatalf("Unexpected repo fields: %+v", repo)
	}

	rel := RelationshipInfo{
		Source:      "web-ui",
		Target:      "auth-service",
		Type:        "api_call",
		Description: "Calls /login endpoint",
		Metadata:    map[string]any{"protocol": "https"},
	}

	reg := ProjectRegistry{
		ProjectID:     "test-eco",
		Name:          "Test Ecosystem",
		Repos:         []RepoInfo{repo},
		Relationships: []RelationshipInfo{rel},
	}

	if r := reg.GetRepo("auth-service"); r == nil || *r.Port != 4000 {
		t.Fatalf("Failed to find repo: %v", r)
	}
	if in := reg.GetInboundRelationships("auth-service"); len(in) != 1 || in[0].Source != "web-ui" {
		t.Fatalf("Unexpected inbound relationships: %+v", in)
	}
	if out := reg.GetOutboundRelationships("web-ui"); len(out) != 1 || out[0].Target != "auth-service" {
		t.Fatalf("Unexpected outbound relationships: %+v", out)
	}
}

func TestRegistryPersistenceAndLoading(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "oss-reg-test-*")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(tmpDir)

	catPath := filepath.Join(tmpDir, "test-projects.yaml")
	t.Setenv("MCP_PROJECTS_CATALOG", catPath)

	tmpFile := filepath.Join(tmpDir, "registry.yaml")
	port := 43770
	reg := &ProjectRegistry{
		ProjectID:   "fintech",
		Name:        "FinTech Platform",
		Description: "Payment processing stack",
		Repos: []RepoInfo{
			{
				Name:      "payment-api",
				LocalPath: "./services/payment",
				TechStack: []string{"Go", "Gin"},
				Port:      &port,
			},
		},
	}

	savedPath, err := SaveRegistry(reg, tmpFile)
	if err != nil {
		t.Fatalf("SaveRegistry failed: %v", err)
	}
	if _, err := os.Stat(savedPath); err != nil {
		t.Fatalf("Saved file does not exist: %v", err)
	}

	loaded, err := LoadRegistry(savedPath)
	if err != nil {
		t.Fatalf("LoadRegistry failed: %v", err)
	}
	if loaded.ProjectID != "fintech" || len(loaded.Repos) != 1 || loaded.Repos[0].Name != "payment-api" {
		t.Fatalf("Loaded registry mismatch: %+v", loaded)
	}

	// Test loading from directory containing registry.yaml
	loadedFromDir, err := LoadRegistry(tmpDir)
	if err != nil {
		t.Fatalf("LoadRegistry from directory failed: %v", err)
	}
	if loadedFromDir.ProjectID != "fintech" {
		t.Fatalf("ProjectID mismatch: %s", loadedFromDir.ProjectID)
	}
}

func TestCatalogRegistration(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "oss-cat-test-*")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(tmpDir)

	catPath := filepath.Join(tmpDir, "projects.yaml")
	t.Setenv("MCP_PROJECTS_CATALOG", catPath)

	regFile := filepath.Join(tmpDir, "my-service", "registry.yaml")
	reg := &ProjectRegistry{
		ProjectID:   "my-service",
		Name:        "My Microservice",
		Description: "Testing catalog registration",
		Repos: []RepoInfo{
			{Name: "api", LocalPath: filepath.Join(tmpDir, "my-service", "api")},
		},
	}

	saved, err := SaveRegistry(reg, regFile)
	if err != nil {
		t.Fatalf("SaveRegistry failed: %v", err)
	}

	// Verify catalog contains the project
	catalog := GetProjectsCatalog()
	entry, exists := catalog["my-service"]
	if !exists {
		t.Fatalf("Project not registered in catalog: %+v", catalog)
	}
	if entry.RegistryPath != saved {
		t.Fatalf("RegistryPath mismatch: got %s, want %s", entry.RegistryPath, saved)
	}

	// Test LoadRegistry by project ID
	loaded, err := LoadRegistry("my-service")
	if err != nil {
		t.Fatalf("LoadRegistry by project ID failed: %v", err)
	}
	if loaded.ProjectID != "my-service" {
		t.Fatalf("Loaded ProjectID mismatch: %s", loaded.ProjectID)
	}

	// Test ListAvailableProjects includes it
	projects := ListAvailableProjects()
	found := false
	for _, p := range projects {
		if p.ProjectID == "my-service" {
			found = true
			break
		}
	}
	if !found {
		t.Fatalf("my-service not found in ListAvailableProjects: %+v", projects)
	}
}

