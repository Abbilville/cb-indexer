package workflows

import (
	"context"
	"fmt"
	"path/filepath"

	"cb-indexer/internal/cbmwrite"
	"cb-indexer/internal/registry"
	"cb-indexer/internal/scanner"
)

// OnboardReport contains the combined result of scanning, registry generation, and batch indexing.
type OnboardReport struct {
	Status         string                     `json:"status"`
	Message        string                     `json:"message"`
	RegistryPath   string                     `json:"registry_path"`
	Discovered     *registry.ProjectRegistry  `json:"discovered"`
	IndexingReport cbmwrite.BatchIndexReport `json:"indexing_report"`
}

// OnboardWorkspace performs atomic discovery, manifest generation, and batch indexing in a single call.
func OnboardWorkspace(ctx context.Context, workspacePath, projectID, mode, outputFile string) (*OnboardReport, error) {
	absDir, err := filepath.Abs(workspacePath)
	if err != nil {
		absDir = workspacePath
	}

	// 1. Scan workspace
	reg, err := scanner.ScanWorkspace(absDir, projectID)
	if err != nil {
		return nil, fmt.Errorf("scan failed: %w", err)
	}

	// 2. Save registry
	outPath := outputFile
	if outPath == "" {
		outPath = filepath.Join(absDir, "registry.yaml")
	}
	savedPath, err := registry.SaveRegistry(reg, outPath)
	if err != nil {
		return nil, fmt.Errorf("failed to save registry: %w", err)
	}

	// 3. Batch index
	if mode == "" {
		mode = "moderate"
	}
	indexReport := cbmwrite.BatchIndexProject(ctx, reg, mode, false)

	return &OnboardReport{
		Status:         "success",
		Message:        fmt.Sprintf("Successfully onboarded %d repositories into %s", len(reg.Repos), savedPath),
		RegistryPath:   savedPath,
		Discovered:     reg,
		IndexingReport: indexReport,
	}, nil
}
