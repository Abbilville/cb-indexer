package cpg

import (
	"context"
	"database/sql"
	"os"
	"path/filepath"
	"testing"
)

// 1. Test Joern availability and configuration checking.
func TestJoernAvailabilityConfiguration(t *testing.T) {
	status := CheckJoernStatus()
	if status.Engine != "joern" {
		t.Fatalf("Expected engine 'joern', got '%s'", status.Engine)
	}
	if len(status.SupportedLangs) == 0 {
		t.Fatalf("Expected supported languages to be listed")
	}
	if status.CacheDir == "" {
		t.Fatalf("Expected non-empty cache directory")
	}

	// Test environment variable overrides
	fakeBin := filepath.Join(t.TempDir(), "fake-joern-parse")
	_ = os.WriteFile(fakeBin, []byte("#!/bin/sh\necho 1.0"), 0755)
	t.Setenv("JOERN_PARSE_PATH", fakeBin)

	parseBin, _ := FindJoernExecutable()
	if parseBin != fakeBin {
		t.Fatalf("Expected JOERN_PARSE_PATH override '%s', got '%s'", fakeBin, parseBin)
	}
}

// 2. Test CPG indexing of a small sample repository.
func TestCPGIndexingSampleRepo(t *testing.T) {
	tempCache := t.TempDir()
	t.Setenv("CB_INDEXER_CPG_CACHE_DIR", tempCache)

	samplePath := filepath.Join("..", "..", "testdata", "fixtures", "sample-repo")
	ctx := context.Background()

	result := IndexSingleRepo(ctx, samplePath, "sample-service", true)
	if result.Status != "success" {
		t.Fatalf("Expected indexing to succeed, got status: %s, error: %s", result.Status, result.Error)
	}
	if result.Nodes == 0 {
		t.Fatalf("Expected extracted nodes > 0, got 0")
	}
	if result.Edges == 0 {
		t.Fatalf("Expected extracted edges > 0, got 0")
	}

	// Verify database file was created
	dbPath := GetCPGDBPath("sample-service")
	if _, err := os.Stat(dbPath); err != nil {
		t.Fatalf("Expected database file at %s: %v", dbPath, err)
	}

	nodes, edges, err := QueryCPGStats(dbPath)
	if err != nil {
		t.Fatalf("Failed to query CPG stats: %v", err)
	}
	if nodes != result.Nodes || edges != result.Edges {
		t.Fatalf("Stat mismatch: DB has (%d nodes, %d edges), result reported (%d, %d)", nodes, edges, result.Nodes, result.Edges)
	}
}

// 3. Test node and edge extraction details.
func TestNodeAndEdgeExtraction(t *testing.T) {
	samplePath := filepath.Join("..", "..", "testdata", "fixtures", "sample-repo")
	extracted, hashes, err := FallbackAnalyzeRepo(samplePath, "test-repo")
	if err != nil {
		t.Fatalf("FallbackAnalyzeRepo failed: %v", err)
	}

	if len(hashes) == 0 {
		t.Fatalf("Expected file hashes to be populated")
	}

	labels := make(map[string]int)
	for _, n := range extracted.Nodes {
		labels[n.Label]++
	}

	if labels[NodeFile] == 0 {
		t.Errorf("Expected at least one File node")
	}
	if labels[NodeTypeDecl] == 0 {
		t.Errorf("Expected at least one TypeDecl node")
	}
	if labels[NodeMethod] == 0 {
		t.Errorf("Expected at least one Method node")
	}
	if labels[NodeCall] == 0 {
		t.Errorf("Expected at least one Call node")
	}

	types := make(map[string]int)
	for _, e := range extracted.Edges {
		types[e.Type]++
	}

	if types[EdgeAST] == 0 {
		t.Errorf("Expected AST edges")
	}
	if types[EdgeCall] == 0 {
		t.Errorf("Expected Call edges")
	}
	if types[EdgeCFG] == 0 {
		t.Errorf("Expected CFG edges")
	}
}

// 4. Test GraphSON parsing with TinkerPop format.
func TestGraphSONParsing(t *testing.T) {
	tempDir := t.TempDir()
	graphsonContent := `{
		"graph": {
			"vertices": [
				{
					"id": 100,
					"label": "METHOD",
					"properties": {
						"name": [{"value": "handlePayment"}],
						"fullName": [{"value": "payment.service::handlePayment"}],
						"filename": [{"value": "payment.go"}],
						"lineNumber": [{"value": 42}]
					}
				},
				{
					"id": 101,
					"label": "CALL",
					"properties": {
						"name": [{"value": "chargeCard"}],
						"fullName": [{"value": "payment.service::chargeCard"}],
						"filename": [{"value": "payment.go"}],
						"lineNumber": [{"value": 45}]
					}
				},
				{
					"id": 999,
					"label": "METHOD",
					"properties": {
						"name": [{"value": "<operator>.assignment"}]
					}
				}
			],
			"edges": [
				{
					"id": 500,
					"label": "CALL",
					"outV": 100,
					"inV": 101
				}
			]
		}
	}`

	jsonFile := filepath.Join(tempDir, "export.json")
	if err := os.WriteFile(jsonFile, []byte(graphsonContent), 0644); err != nil {
		t.Fatalf("Failed to write json fixture: %v", err)
	}

	cpgResult, err := ParseGraphSON(tempDir, "payment-service")
	if err != nil {
		t.Fatalf("ParseGraphSON failed: %v", err)
	}

	// Should extract 2 nodes (operator compiler noise filtered out)
	if len(cpgResult.Nodes) != 2 {
		t.Fatalf("Expected 2 nodes after filtering noise, got %d", len(cpgResult.Nodes))
	}
	if len(cpgResult.Edges) != 1 {
		t.Fatalf("Expected 1 edge, got %d", len(cpgResult.Edges))
	}
	if cpgResult.Edges[0].Type != EdgeCall {
		t.Fatalf("Expected edge type CALL, got %s", cpgResult.Edges[0].Type)
	}
}

// 5. Test Graphviz DOT parsing.
func TestDOTParsing(t *testing.T) {
	tempDir := t.TempDir()
	dotContent := `digraph "test" {
"10" [label = <(METHOD,processRequest)<SUB>15</SUB>> ]
"20" [label = <(CALL,authValidate)<SUB>18</SUB>> ]
"10" -> "20" [ label = "CALL" ]
"10" -> "20" [ label = "CFG" ]
}`
	dotFile := filepath.Join(tempDir, "method.dot")
	_ = os.WriteFile(dotFile, []byte(dotContent), 0644)

	extracted, err := ParseDOTExport(tempDir, "auth-service")
	if err != nil {
		t.Fatalf("ParseDOTExport failed: %v", err)
	}

	if len(extracted.Nodes) != 2 {
		t.Fatalf("Expected 2 nodes, got %d", len(extracted.Nodes))
	}
	if len(extracted.Edges) != 2 {
		t.Fatalf("Expected 2 edges, got %d", len(extracted.Edges))
	}
}

// 6. Test SQLite persistence, transactions, and schema constraints.
func TestSQLitePersistence(t *testing.T) {
	tempDir := t.TempDir()
	dbPath := filepath.Join(tempDir, "test.db")

	meta := CPGProjectMeta{
		Name:     "sample-repo",
		RootPath: "/test/sample-repo",
	}

	nodes := []CPGNode{
		{ID: 1, Project: "sample-repo", Label: NodeFile, Name: "main.go", QualifiedName: "sample-repo::main.go", FilePath: "main.go", StartLine: 1},
		{ID: 2, Project: "sample-repo", Label: NodeMethod, Name: "main", QualifiedName: "sample-repo::main.go::main", FilePath: "main.go", StartLine: 3},
		{ID: 3, Project: "sample-repo", Label: NodeCall, Name: "println", QualifiedName: "sample-repo::call::println::4", FilePath: "main.go", StartLine: 4},
	}

	edges := []CPGEdge{
		{Project: "sample-repo", SourceID: 1, TargetID: 2, Type: EdgeAST},
		{Project: "sample-repo", SourceID: 2, TargetID: 3, Type: EdgeCall},
		{Project: "sample-repo", SourceID: 2, TargetID: 3, Type: EdgeCFG},
	}

	ctx := context.Background()
	_, _, err := SaveCPG(ctx, dbPath, meta, nodes, edges, map[string]string{"main.go": "hash123"})
	if err != nil {
		t.Fatalf("SaveCPG failed: %v", err)
	}

	totalNodes, totalEdges, err := QueryCPGStats(dbPath)
	if err != nil {
		t.Fatalf("QueryCPGStats failed: %v", err)
	}
	if totalNodes != 3 || totalEdges != 3 {
		t.Fatalf("Expected 3 nodes and 3 edges, got (%d, %d)", totalNodes, totalEdges)
	}
}

// 7. Test re-indexing idempotency and updates.
func TestReIndexing(t *testing.T) {
	tempDir := t.TempDir()
	dbPath := filepath.Join(tempDir, "idempotent.db")
	ctx := context.Background()

	meta := CPGProjectMeta{Name: "my-app", RootPath: "/app"}
	nodes1 := []CPGNode{
		{ID: 1, Project: "my-app", Label: NodeMethod, Name: "foo", QualifiedName: "my-app::foo", FilePath: "foo.go", StartLine: 10},
	}
	edges1 := []CPGEdge{}

	// First index run
	if _, _, err := SaveCPG(ctx, dbPath, meta, nodes1, edges1, nil); err != nil {
		t.Fatalf("First SaveCPG failed: %v", err)
	}

	// Re-indexing run with an extra node & edge
	nodes2 := []CPGNode{
		{ID: 1, Project: "my-app", Label: NodeMethod, Name: "foo", QualifiedName: "my-app::foo", FilePath: "foo.go", StartLine: 10},
		{ID: 2, Project: "my-app", Label: NodeCall, Name: "bar", QualifiedName: "my-app::bar", FilePath: "foo.go", StartLine: 12},
	}
	edges2 := []CPGEdge{
		{Project: "my-app", SourceID: 1, TargetID: 2, Type: EdgeCall},
	}

	if _, _, err := SaveCPG(ctx, dbPath, meta, nodes2, edges2, nil); err != nil {
		t.Fatalf("Second SaveCPG failed: %v", err)
	}

	n, e, _ := QueryCPGStats(dbPath)
	if n != 2 || e != 1 {
		t.Fatalf("Expected re-indexing to overwrite clean graph state: got (%d nodes, %d edges), wanted (2, 1)", n, e)
	}
}

// 8. Test repository isolation.
func TestRepositoryIsolation(t *testing.T) {
	tempCache := t.TempDir()
	t.Setenv("CB_INDEXER_CPG_CACHE_DIR", tempCache)
	ctx := context.Background()

	metaA := CPGProjectMeta{Name: "repo-alpha", RootPath: "/repos/alpha"}
	metaB := CPGProjectMeta{Name: "repo-beta", RootPath: "/repos/beta"}

	nodesA := []CPGNode{
		{ID: 1, Project: "repo-alpha", Label: NodeMethod, Name: "alphaFunc", QualifiedName: "alpha::alphaFunc"},
	}
	nodesB := []CPGNode{
		{ID: 1, Project: "repo-beta", Label: NodeMethod, Name: "betaFunc", QualifiedName: "beta::betaFunc"},
	}

	dbA := GetCPGDBPath("repo-alpha")
	dbB := GetCPGDBPath("repo-beta")

	_, _, _ = SaveCPG(ctx, dbA, metaA, nodesA, nil, nil)
	_, _, _ = SaveCPG(ctx, dbB, metaB, nodesB, nil, nil)

	// Verify repo-alpha has only alphaFunc
	payloadA, err := QueryCPGGraph(dbA, 100, nil, nil, "")
	if err != nil {
		t.Fatalf("QueryCPGGraph A failed: %v", err)
	}
	if payloadA.ReturnedNodes != 1 || payloadA.Nodes[0].Name != "alphaFunc" {
		t.Fatalf("Isolation violation: Repo A returned %v", payloadA.Nodes)
	}

	// Verify repo-beta has only betaFunc
	payloadB, err := QueryCPGGraph(dbB, 100, nil, nil, "")
	if err != nil {
		t.Fatalf("QueryCPGGraph B failed: %v", err)
	}
	if payloadB.ReturnedNodes != 1 || payloadB.Nodes[0].Name != "betaFunc" {
		t.Fatalf("Isolation violation: Repo B returned %v", payloadB.Nodes)
	}
}

// 9. Test malformed and unsupported source files handling.
func TestMalformedAndUnsupportedSourceHandling(t *testing.T) {
	tempRepo := t.TempDir()
	// Malformed syntax in go file
	_ = os.WriteFile(filepath.Join(tempRepo, "bad.go"), []byte("package ???\nfunc { invalid"), 0644)
	// Unsupported extensions and binaries
	_ = os.WriteFile(filepath.Join(tempRepo, "data.bin"), []byte{0x00, 0xFF, 0xFE, 0x12}, 0644)
	_ = os.WriteFile(filepath.Join(tempRepo, "doc.pdf"), []byte("%PDF-1.4..."), 0644)
	// Empty file
	_ = os.WriteFile(filepath.Join(tempRepo, "empty.go"), []byte(""), 0644)

	// Indexer should not panic or fail
	extracted, hashes, err := FallbackAnalyzeRepo(tempRepo, "malformed-repo")
	if err != nil {
		t.Fatalf("Expected analyzer to gracefully handle malformed source, got error: %v", err)
	}
	if extracted == nil {
		t.Fatalf("Expected non-nil extracted CPG")
	}
	if len(hashes) == 0 {
		t.Fatalf("Expected empty.go and bad.go to be registered")
	}
}

// 10. Test basic CPG queries: callers, callees, references, CFG, data-flow, types.
func TestCPGQueries(t *testing.T) {
	tempDir := t.TempDir()
	dbPath := filepath.Join(tempDir, "query_test.db")
	ctx := context.Background()

	meta := CPGProjectMeta{Name: "store-service", RootPath: "/store"}

	nodes := []CPGNode{
		{ID: 1, Project: "store-service", Label: NodeTypeDecl, Name: "Store", QualifiedName: "store::Store"},
		{ID: 2, Project: "store-service", Label: NodeMethod, Name: "ProcessPayment", QualifiedName: "store::ProcessPayment", StartLine: 10},
		{ID: 3, Project: "store-service", Label: NodeMethod, Name: "ChargeCard", QualifiedName: "store::ChargeCard", StartLine: 20},
		{ID: 4, Project: "store-service", Label: NodeParam, Name: "amount", QualifiedName: "store::ProcessPayment::amount", StartLine: 10},
		{ID: 5, Project: "store-service", Label: NodeCall, Name: "ChargeCard", QualifiedName: "store::call::ChargeCard", StartLine: 12},
		{ID: 6, Project: "store-service", Label: NodeTypeDecl, Name: "BaseStore", QualifiedName: "store::BaseStore"},
	}

	edges := []CPGEdge{
		{Project: "store-service", SourceID: 1, TargetID: 2, Type: EdgeAST},
		{Project: "store-service", SourceID: 2, TargetID: 4, Type: EdgeAST},
		{Project: "store-service", SourceID: 2, TargetID: 5, Type: EdgeCall},
		{Project: "store-service", SourceID: 5, TargetID: 3, Type: EdgeCall},
		{Project: "store-service", SourceID: 2, TargetID: 5, Type: EdgeCFG},
		{Project: "store-service", SourceID: 4, TargetID: 5, Type: EdgeDataFlow},
		{Project: "store-service", SourceID: 5, TargetID: 4, Type: EdgeRef},
		{Project: "store-service", SourceID: 1, TargetID: 6, Type: EdgeType},
	}

	if _, _, err := SaveCPG(ctx, dbPath, meta, nodes, edges, nil); err != nil {
		t.Fatalf("SaveCPG failed: %v", err)
	}

	// 1. Callers
	callers, err := GetCPGCallers(dbPath, "ChargeCard")
	if err != nil {
		t.Fatalf("GetCPGCallers failed: %v", err)
	}
	if len(callers) == 0 {
		t.Fatalf("Expected callers for ChargeCard, got 0")
	}

	// 2. Callees
	callees, err := GetCPGCallees(dbPath, "ProcessPayment")
	if err != nil {
		t.Fatalf("GetCPGCallees failed: %v", err)
	}
	if len(callees) == 0 {
		t.Fatalf("Expected callees for ProcessPayment, got 0")
	}

	// 3. References
	refs, err := GetCPGReferences(dbPath, "amount")
	if err != nil {
		t.Fatalf("GetCPGReferences failed: %v", err)
	}
	if len(refs) == 0 {
		t.Fatalf("Expected references for amount, got 0")
	}

	// 4. Control Flow
	cfgFlow, err := GetCPGControlFlow(dbPath, "ProcessPayment")
	if err != nil {
		t.Fatalf("GetCPGControlFlow failed: %v", err)
	}
	if len(cfgFlow.Steps) == 0 {
		t.Fatalf("Expected CFG steps, got 0")
	}

	// 5. Data Flow
	dfFlow, err := GetCPGDataFlow(dbPath, "amount", "")
	if err != nil {
		t.Fatalf("GetCPGDataFlow failed: %v", err)
	}
	if len(dfFlow.Steps) == 0 {
		t.Fatalf("Expected DataFlow steps, got 0")
	}

	// 6. Type Relations
	types, err := GetCPGTypeRelations(dbPath, "Store")
	if err != nil {
		t.Fatalf("GetCPGTypeRelations failed: %v", err)
	}
	if len(types) == 0 {
		t.Fatalf("Expected type relations for Store, got 0")
	}

	// 7. Graph Payload Query
	payload, err := QueryCPGGraph(dbPath, 100, []string{"Method", "Call"}, []string{"CALL", "CFG"}, "")
	if err != nil {
		t.Fatalf("QueryCPGGraph failed: %v", err)
	}
	if payload.Scope != "cpg" {
		t.Fatalf("Expected scope 'cpg', got '%s'", payload.Scope)
	}
	if payload.ReturnedNodes == 0 {
		t.Fatalf("Expected filtered nodes > 0, got 0")
	}
}

// 11. Test AST correlation.
func TestCPGAstCorrelation(t *testing.T) {
	tempDir := t.TempDir()
	astDbPath := filepath.Join(tempDir, "ast.db")
	cpgDbPath := filepath.Join(tempDir, "cpg.db")

	// Create fake AST db
	astDB, err := sql.Open("sqlite", astDbPath)
	if err != nil {
		t.Fatalf("Failed to open ast db: %v", err)
	}
	defer astDB.Close()

	_, _ = astDB.Exec(`
		CREATE TABLE nodes (
			id INTEGER PRIMARY KEY,
			project TEXT,
			label TEXT,
			name TEXT,
			qualified_name TEXT,
			file_path TEXT,
			start_line INTEGER,
			end_line INTEGER,
			properties TEXT
		);
		INSERT INTO nodes VALUES (10, 'my-repo', 'Function', 'handleRequest', 'my-repo::api.go::handleRequest', 'api.go', 25, 30, '{}');
	`)

	// Create fake CPG db
	cpgNodes := []CPGNode{
		{ID: 1, Project: "my-repo", Label: NodeMethod, Name: "handleRequest", QualifiedName: "my-repo::api.go::handleRequest", FilePath: "api.go", StartLine: 25},
		{ID: 2, Project: "my-repo", Label: NodeMethod, Name: "uncorrelated", QualifiedName: "my-repo::other.go::uncorrelated", FilePath: "other.go", StartLine: 1},
	}
	meta := CPGProjectMeta{Name: "my-repo", RootPath: "/repo"}
	ctx := context.Background()
	_, _, _ = SaveCPG(ctx, cpgDbPath, meta, cpgNodes, nil, nil)

	// Correlate
	matched, err := CorrelateCPGDatabase(cpgDbPath, astDbPath)
	if err != nil {
		t.Fatalf("CorrelateCPGDatabase failed: %v", err)
	}
	if matched != 1 {
		t.Fatalf("Expected 1 matched node, got %d", matched)
	}

	// Verify node 1 has ast_node_id = 10
	payload, err := QueryCPGGraph(cpgDbPath, 10, nil, nil, "handleRequest")
	if err != nil {
		t.Fatalf("QueryCPGGraph failed: %v", err)
	}
	if len(payload.Nodes) == 0 {
		t.Fatalf("Expected node in payload")
	}
	nodeProps := payload.Nodes[0].Properties
	if astID, ok := nodeProps["ast_node_id"].(float64); !ok || int(astID) != 10 {
		t.Fatalf("Expected ast_node_id = 10 in properties, got %v", nodeProps["ast_node_id"])
	}
}
