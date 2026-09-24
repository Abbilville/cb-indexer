package mcpserver

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

func TestAuthMiddleware(t *testing.T) {
	mux := http.NewServeMux()
	RegisterRESTEndpoints(mux, "secret-token-123")

	req := httptest.NewRequest(http.MethodGet, "/api/projects", nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("Expected 401 Unauthorized without token, got %d", w.Code)
	}

	// Bearer token
	reqBearer := httptest.NewRequest(http.MethodGet, "/api/projects", nil)
	reqBearer.Header.Set("Authorization", "Bearer secret-token-123")
	wBearer := httptest.NewRecorder()
	mux.ServeHTTP(wBearer, reqBearer)
	if wBearer.Code != http.StatusOK {
		t.Fatalf("Expected 200 OK with Bearer token, got %d", wBearer.Code)
	}

	// X-API-Key
	reqAPIKey := httptest.NewRequest(http.MethodGet, "/api/projects", nil)
	reqAPIKey.Header.Set("X-API-Key", "secret-token-123")
	wAPIKey := httptest.NewRecorder()
	mux.ServeHTTP(wAPIKey, reqAPIKey)
	if wAPIKey.Code != http.StatusOK {
		t.Fatalf("Expected 200 OK with X-API-Key, got %d", wAPIKey.Code)
	}

	// Query param ?token=
	reqQuery := httptest.NewRequest(http.MethodGet, "/api/projects?token=secret-token-123", nil)
	wQuery := httptest.NewRecorder()
	mux.ServeHTTP(wQuery, reqQuery)
	if wQuery.Code != http.StatusOK {
		t.Fatalf("Expected 200 OK with ?token=, got %d", wQuery.Code)
	}

	// Test /api/auth/verify with wrong token
	reqBad := httptest.NewRequest(http.MethodGet, "/api/auth/verify", nil)
	reqBad.Header.Set("Authorization", "Bearer wrong-token")
	wBad := httptest.NewRecorder()
	mux.ServeHTTP(wBad, reqBad)
	if wBad.Code != http.StatusUnauthorized {
		t.Fatalf("Expected 401 Unauthorized for bad token, got %d", wBad.Code)
	}

	// Test /api/auth/verify with correct token
	reqGood := httptest.NewRequest(http.MethodGet, "/api/auth/verify", nil)
	reqGood.Header.Set("Authorization", "Bearer secret-token-123")
	wGood := httptest.NewRecorder()
	mux.ServeHTTP(wGood, reqGood)
	if wGood.Code != http.StatusOK {
		t.Fatalf("Expected 200 OK for valid token, got %d", wGood.Code)
	}
}

func TestAPIScanEndpoint_PathCompatibility(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "mcp-scan-test-*")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(tmpDir)

	subService := filepath.Join(tmpDir, "order-service")
	_ = os.MkdirAll(subService, 0755)
	_ = os.WriteFile(filepath.Join(subService, "package.json"), []byte(`{"name":"order-service"}`), 0644)

	mux := http.NewServeMux()
	RegisterRESTEndpoints(mux, "")

	// Frontend sends `path` instead of `workspace_path`
	bodyData, _ := json.Marshal(map[string]string{
		"path":       tmpDir,
		"project_id": "test-order-project",
	})
	req := httptest.NewRequest(http.MethodPost, "/api/scan", bytes.NewReader(bodyData))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	mux.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("Expected 200 OK for /api/scan, got %d: %s", w.Code, w.Body.String())
	}

	var res struct {
		Status     string `json:"status"`
		ProjectID  string `json:"project_id"`
		TotalRepos int    `json:"total_repos"`
		ReposCount int    `json:"repos_count"`
		Message    string `json:"message"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &res); err != nil {
		t.Fatalf("Failed to parse JSON response: %v", err)
	}

	if res.Status != "success" {
		t.Fatalf("Expected status success, got %s", res.Status)
	}
	if res.ProjectID != "test-order-project" {
		t.Fatalf("Expected project_id test-order-project, got %s", res.ProjectID)
	}
	if res.TotalRepos != 1 || res.ReposCount != 1 {
		t.Fatalf("Expected total_repos=1 and repos_count=1, got total=%d, count=%d", res.TotalRepos, res.ReposCount)
	}
	if res.Message == "" {
		t.Fatalf("Expected non-empty message in response")
	}
}

func TestAPITriggerEndpoint_RepoCompatibility(t *testing.T) {
	mux := http.NewServeMux()
	RegisterRESTEndpoints(mux, "")

	// Frontend sends `repo` instead of `repo_name`
	bodyData, _ := json.Marshal(map[string]any{
		"project": "non-existent-project",
		"repo":    "user-service",
	})
	req := httptest.NewRequest(http.MethodPost, "/api/trigger", bytes.NewReader(bodyData))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	mux.ServeHTTP(w, req)
	// Project is non-existent, so it should return 400 Bad Request ("Failed to load project registry")
	// rather than 500 or crashing
	if w.Code != http.StatusBadRequest {
		t.Fatalf("Expected 400 Bad Request for non-existent project, got %d: %s", w.Code, w.Body.String())
	}
}

func TestAPIProjectRemoveEndpoint(t *testing.T) {
	mux := http.NewServeMux()
	RegisterRESTEndpoints(mux, "")

	bodyData, _ := json.Marshal(map[string]any{
		"project_id":   "dummy-proj-to-remove",
		"purge_graphs": false,
	})
	req := httptest.NewRequest(http.MethodPost, "/api/project/remove", bytes.NewReader(bodyData))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	mux.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("Expected 200 OK for project removal, got %d: %s", w.Code, w.Body.String())
	}

	var res struct {
		Status    string `json:"status"`
		ProjectID string `json:"project_id"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &res); err != nil {
		t.Fatalf("Failed to parse JSON response: %v", err)
	}
	if res.Status != "success" || res.ProjectID != "dummy-proj-to-remove" {
		t.Fatalf("Unexpected response payload: %+v", res)
	}
}

func TestAPIBrowseDirsEndpoint(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "browse-dirs-test-*")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(tmpDir)

	_ = os.MkdirAll(filepath.Join(tmpDir, "folder-a"), 0755)
	_ = os.MkdirAll(filepath.Join(tmpDir, "folder-b"), 0755)
	_ = os.WriteFile(filepath.Join(tmpDir, "some-file.txt"), []byte("hello"), 0644)

	mux := http.NewServeMux()
	RegisterRESTEndpoints(mux, "")

	req := httptest.NewRequest(http.MethodGet, "/api/browse-dirs?path="+tmpDir, nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("Expected 200 OK, got %d: %s", w.Code, w.Body.String())
	}

	var res struct {
		Current string   `json:"current"`
		Parent  string   `json:"parent"`
		Dirs    []string `json:"dirs"`
		Drives  []string `json:"drives"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &res); err != nil {
		t.Fatalf("Failed to decode JSON: %v", err)
	}

	if len(res.Dirs) != 2 {
		t.Fatalf("Expected 2 subdirectories, got %d: %+v", len(res.Dirs), res.Dirs)
	}
}
