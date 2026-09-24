package cpg

import "time"

// Standard CPG Node Labels
const (
	NodeFile     = "File"
	NodeTypeDecl = "TypeDecl"
	NodeClass    = "Class"
	NodeMethod   = "Method"
	NodeFunction = "Function"
	NodeCall     = "Call"
	NodeParam    = "Param"
	NodeVariable = "Variable"
	NodeImport   = "Import"
)

// Standard CPG Edge Types
const (
	EdgeAST      = "AST"
	EdgeCall     = "CALL"
	EdgeCFG      = "CFG"
	EdgeDataFlow = "DATA_FLOW"
	EdgeRef      = "REF"
	EdgeType     = "TYPE"
	EdgeImport   = "IMPORT"
	EdgeContains = "CONTAINS"
)

// CPGNode represents a normalized Code Property Graph node entity.
type CPGNode struct {
	ID            int64          `json:"id"`
	Project       string         `json:"project"`
	Label         string         `json:"label"`
	Name          string         `json:"name"`
	QualifiedName string         `json:"qualified_name"`
	FilePath      string         `json:"file_path,omitempty"`
	StartLine     int            `json:"start_line,omitempty"`
	EndLine       int            `json:"end_line,omitempty"`
	Properties    map[string]any `json:"properties,omitempty"`
	Val           float64        `json:"val,omitempty"`
}

// CPGEdge represents a directed relationship between CPG nodes.
type CPGEdge struct {
	ID         int64          `json:"id"`
	Project    string         `json:"project"`
	SourceID   int64          `json:"source_id"`
	TargetID   int64          `json:"target_id"`
	Type       string         `json:"type"`
	Properties map[string]any `json:"properties,omitempty"`
}

// CPGCacheItem represents a found CPG SQLite cache file.
type CPGCacheItem struct {
	Name         string    `json:"name"`
	ProjectID    string    `json:"project_id"`
	DBPath       string    `json:"db_path"`
	SizeBytes    int64     `json:"size_bytes"`
	LastModified time.Time `json:"last_modified"`
	IsIndexed    bool      `json:"is_indexed"`
	Nodes        *int      `json:"nodes,omitempty"`
	Edges        *int      `json:"edges,omitempty"`
	Source       string    `json:"source"`
}

// CPGProjectMeta holds project level metadata stored in CPG database.
type CPGProjectMeta struct {
	Name       string    `json:"name"`
	RootPath   string    `json:"root_path"`
	IndexedAt  time.Time `json:"indexed_at"`
	CPGVersion string    `json:"cpg_version"`
	NodeCount  int       `json:"node_count"`
	EdgeCount  int       `json:"edge_count"`
}

// CPGStatus reports Joern engine reachability and active CPG configuration.
type CPGStatus struct {
	Available      bool     `json:"available"`
	Engine         string   `json:"engine"`
	BinaryPath     string   `json:"binary_path,omitempty"`
	Version        string   `json:"version,omitempty"`
	SupportedLangs []string `json:"supported_languages"`
	CacheDir       string   `json:"cache_dir"`
	IndexedRepos   int      `json:"indexed_repos"`
	TotalNodes     int      `json:"total_nodes"`
	TotalEdges     int      `json:"total_edges"`
	Help           string   `json:"help,omitempty"`
}

// CPGIndexResult holds result of an indexing run.
type CPGIndexResult struct {
	Name       string `json:"name"`
	Path       string `json:"path"`
	Status     string `json:"status"` // "success", "failed", "skipped"
	Nodes      int    `json:"nodes"`
	Edges      int    `json:"edges"`
	DurationMs int64  `json:"duration_ms"`
	Output     string `json:"output,omitempty"`
	Error      string `json:"error,omitempty"`
}

// CPGCallerResult represents caller method information.
type CPGCallerResult struct {
	CallerNode CPGNode `json:"caller"`
	CallSite   CPGNode `json:"call_site"`
	Edge       CPGEdge `json:"edge"`
}

// CPGCalleeResult represents target method called.
type CPGCalleeResult struct {
	CalleeNode CPGNode `json:"callee"`
	CallSite   CPGNode `json:"call_site"`
	Edge       CPGEdge `json:"edge"`
}

// CPGReferenceResult represents a reference to a variable or parameter.
type CPGReferenceResult struct {
	TargetNode CPGNode `json:"target"`
	SourceNode CPGNode `json:"source"`
	Edge       CPGEdge `json:"edge"`
}

// CPGFlowStep represents a node step in control-flow or data-flow graph.
type CPGFlowStep struct {
	StepIndex int     `json:"step_index"`
	Node      CPGNode `json:"node"`
	EdgeType  string  `json:"edge_type"`
}

// CPGFlowResult represents an ordered path of flow steps.
type CPGFlowResult struct {
	FlowType string        `json:"flow_type"` // "CFG" or "DATA_FLOW"
	Source   CPGNode       `json:"source"`
	Sink     CPGNode       `json:"sink"`
	Steps    []CPGFlowStep `json:"steps"`
}

// CPGTypeRelationResult represents type inheritance or type association.
type CPGTypeRelationResult struct {
	TypeNode   CPGNode `json:"type_node"`
	TargetNode CPGNode `json:"target_node"`
	Relation   string  `json:"relation"`
}

// CPGCallFlowResult represents a multi-hop call chain.
type CPGCallFlowResult struct {
	Direction string    `json:"direction"` // "callers", "callees", "both"
	Depth     int       `json:"depth"`
	RootNode  CPGNode   `json:"root_node"`
	Nodes     []CPGNode `json:"nodes"`
	Edges     []CPGEdge `json:"edges"`
	Paths     [][]int64 `json:"paths"`
}

// CPGImpactResult represents impact and blast-radius analysis for a node.
type CPGImpactResult struct {
	TargetNode        CPGNode   `json:"target_node"`
	DirectCallers     []CPGNode `json:"direct_callers"`
	IndirectCallers   []CPGNode `json:"indirect_callers"`
	AffectedFiles     []string  `json:"affected_files"`
	DirectCount       int       `json:"direct_count"`
	IndirectCount     int       `json:"indirect_count"`
	AffectedFileCount int       `json:"affected_file_count"`
	Nodes             []CPGNode `json:"nodes"`
	Edges             []CPGEdge `json:"edges"`
}

// CPGPathResult represents a path between two nodes in CPG.
type CPGPathResult struct {
	Found        bool      `json:"found"`
	FromNode     CPGNode   `json:"from_node"`
	ToNode       CPGNode   `json:"to_node"`
	Relationship string    `json:"relationship,omitempty"`
	Nodes        []CPGNode `json:"nodes"`
	Edges        []CPGEdge `json:"edges"`
}
