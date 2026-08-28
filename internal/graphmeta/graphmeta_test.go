package graphmeta

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func TestLocalArtifactParser(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "cbm-artifact-test-*")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(tmpDir)

	cbmDir := filepath.Join(tmpDir, ".codebase-memory")
	if err := os.MkdirAll(cbmDir, 0755); err != nil {
		t.Fatal(err)
	}

	nodes := 500
	edges := 1200
	raw := rawArtifactJson{
		SchemaVersion: 2,
		Commit:        "abcdef123456",
		IndexedAt:     "2026-08-25T12:00:00Z",
		Project:       "sample-service",
		Nodes:         &nodes,
		Edges:         &edges,
	}

	data, _ := json.Marshal(raw)
	if err := os.WriteFile(filepath.Join(cbmDir, "artifact.json"), data, 0644); err != nil {
		t.Fatal(err)
	}

	info := ReadLocalRepoArtifact(tmpDir)
	if info == nil {
		t.Fatal("Expected non-nil artifact info")
	}
	if info.Name != "sample-service" || *info.Nodes != 500 || *info.Edges != 1200 {
		t.Fatalf("Unexpected artifact parsed: %+v", info)
	}

	// Test non-indexed dir
	emptyDir, _ := os.MkdirTemp("", "empty-test-*")
	defer os.RemoveAll(emptyDir)
	if nilInfo := ReadLocalRepoArtifact(emptyDir); nilInfo != nil {
		t.Fatalf("Expected nil for unindexed directory, got %+v", nilInfo)
	}
}

func TestDeriveCbmSlug(t *testing.T) {
	slug := DeriveCbmSlug("C:\\Telkom\\test\\bank\\account-service")
	expected := "C-Telkom-test-bank-account-service"
	if slug != expected {
		t.Fatalf("Expected %s, got %s", expected, slug)
	}
}
