package cpg

import (
	"bufio"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
)

// RawGraphSONVertex represents a vertex in TinkerPop GraphSON format.
type RawGraphSONVertex struct {
	ID         any            `json:"id"`
	Label      string         `json:"label"`
	Properties map[string]any `json:"properties"`
}

// RawGraphSONEdge represents an edge in TinkerPop GraphSON format.
type RawGraphSONEdge struct {
	ID         any            `json:"id"`
	Label      string         `json:"label"`
	OutV       any            `json:"outV"`
	InV        any            `json:"inV"`
	Properties map[string]any `json:"properties"`
}

// RawGraphSONGraph represents top-level GraphSON wrapper.
type RawGraphSONGraph struct {
	Graph *struct {
		Vertices []RawGraphSONVertex `json:"vertices"`
		Edges    []RawGraphSONEdge   `json:"edges"`
	} `json:"graph"`
	Vertices []RawGraphSONVertex `json:"vertices"`
	Edges    []RawGraphSONEdge   `json:"edges"`
}

// ExtractedCPG holds extracted and normalized CPG nodes and edges.
type ExtractedCPG struct {
	Nodes []CPGNode
	Edges []CPGEdge
}

// NormalizeNodeLabel maps Joern vertex labels to standardized CPG labels.
func NormalizeNodeLabel(rawLabel string) string {
	upper := strings.ToUpper(strings.TrimSpace(rawLabel))
	switch upper {
	case "METHOD":
		return NodeMethod
	case "TYPE_DECL":
		return NodeTypeDecl
	case "FILE":
		return NodeFile
	case "CALL":
		return NodeCall
	case "METHOD_PARAMETER_IN", "PARAM", "PARAMETER":
		return NodeParam
	case "LOCAL", "IDENTIFIER":
		return NodeVariable
	case "IMPORT", "NAMESPACE_BLOCK":
		return NodeImport
	default:
		return rawLabel
	}
}

// NormalizeEdgeType maps Joern edge labels to standardized CPG edge types.
func NormalizeEdgeType(rawType string) string {
	upper := strings.ToUpper(strings.TrimSpace(rawType))
	switch upper {
	case "AST":
		return EdgeAST
	case "CALL":
		return EdgeCall
	case "CFG":
		return EdgeCFG
	case "REACHING_DEF", "DDG", "PDG", "DATA_FLOW", "CDG":
		return EdgeDataFlow
	case "REF":
		return EdgeRef
	case "EVAL_TYPE", "INHERITS_FROM", "BINDS", "TYPEDECL":
		return EdgeType
	case "IMPORT", "IMPORTS":
		return EdgeImport
	case "CONTAINS":
		return EdgeContains
	default:
		return rawType
	}
}

// parseID extracts int64 from various JSON representations (number, string, or typed object).
func parseID(val any) int64 {
	switch v := val.(type) {
	case float64:
		return int64(v)
	case int64:
		return v
	case int:
		return int64(v)
	case string:
		if id, err := strconv.ParseInt(v, 10, 64); err == nil {
			return id
		}
	case map[string]any:
		// TinkerPop GraphSON 3.0 typed object: {"@type": "g:Int64", "@value": 123}
		if rawVal, ok := v["@value"]; ok {
			return parseID(rawVal)
		}
	}
	return 0
}

// extractPropertyValue unpacks TinkerPop GraphSON property values.
func extractPropertyValue(val any) any {
	if val == nil {
		return nil
	}
	switch v := val.(type) {
	case []any:
		if len(v) > 0 {
			if propObj, ok := v[0].(map[string]any); ok {
				if actualVal, hasVal := propObj["value"]; hasVal {
					return actualVal
				}
			}
			return extractPropertyValue(v[0])
		}
		return nil
	case map[string]any:
		if actualVal, hasVal := v["value"]; hasVal {
			return actualVal
		}
		if rawVal, hasVal := v["@value"]; hasVal {
			return rawVal
		}
		return v
	default:
		return v
	}
}

// ParseGraphSON parses a GraphSON file or directory into ExtractedCPG.
func ParseGraphSON(path string, projectName string) (*ExtractedCPG, error) {
	info, err := os.Stat(path)
	if err != nil {
		return nil, err
	}

	var files []string
	if info.IsDir() {
		entries, err := os.ReadDir(path)
		if err != nil {
			return nil, err
		}
		for _, e := range entries {
			if !e.IsDir() && strings.HasSuffix(e.Name(), ".json") {
				files = append(files, filepath.Join(path, e.Name()))
			}
		}
	} else {
		files = append(files, path)
	}

	result := &ExtractedCPG{}
	seenNodes := make(map[int64]bool)

	for _, fPath := range files {
		data, err := os.ReadFile(fPath)
		if err != nil {
			continue
		}

		var top RawGraphSONGraph
		if err := json.Unmarshal(data, &top); err != nil {
			// Try line-by-line GraphSON
			scanner := bufio.NewScanner(strings.NewReader(string(data)))
			for scanner.Scan() {
				line := strings.TrimSpace(scanner.Text())
				if line == "" {
					continue
				}
				var v RawGraphSONVertex
				if json.Unmarshal([]byte(line), &v) == nil && v.Label != "" {
					top.Vertices = append(top.Vertices, v)
					continue
				}
				var e RawGraphSONEdge
				if json.Unmarshal([]byte(line), &e) == nil && e.Label != "" {
					top.Edges = append(top.Edges, e)
				}
			}
		}

		vertices := top.Vertices
		edges := top.Edges
		if top.Graph != nil {
			if len(top.Graph.Vertices) > 0 {
				vertices = top.Graph.Vertices
			}
			if len(top.Graph.Edges) > 0 {
				edges = top.Graph.Edges
			}
		}

		// Ingest vertices
		for _, v := range vertices {
			id := parseID(v.ID)
			if id == 0 || seenNodes[id] {
				continue
			}

			normLabel := NormalizeNodeLabel(v.Label)
			// Filter compiler internal nodes
			if isCompilerNoise(normLabel, v.Properties) {
				continue
			}

			node := convertVertexToNode(id, normLabel, projectName, v.Properties)
			result.Nodes = append(result.Nodes, node)
			seenNodes[id] = true
		}

		// Ingest edges
		for _, e := range edges {
			edgeID := parseID(e.ID)
			srcID := parseID(e.OutV)
			tgtID := parseID(e.InV)
			if srcID == 0 || tgtID == 0 || !seenNodes[srcID] || !seenNodes[tgtID] {
				continue
			}

			normType := NormalizeEdgeType(e.Label)
			edgeProps := make(map[string]any)
			for k, val := range e.Properties {
				edgeProps[k] = extractPropertyValue(val)
			}

			result.Edges = append(result.Edges, CPGEdge{
				ID:         edgeID,
				Project:    projectName,
				SourceID:   srcID,
				TargetID:   tgtID,
				Type:       normType,
				Properties: edgeProps,
			})
		}
	}

	return result, nil
}

// isCompilerNoise checks if a node is an internal Joern/compiler artifact.
func isCompilerNoise(label string, props map[string]any) bool {
	name := fmt.Sprintf("%v", extractPropertyValue(props["name"]))
	fullName := fmt.Sprintf("%v", extractPropertyValue(props["fullName"]))
	code := fmt.Sprintf("%v", extractPropertyValue(props["code"]))

	// Filter operator pseudo-methods: <operator>.assignment, <operator>.fieldAccess, etc.
	if strings.HasPrefix(name, "<operator>") || strings.HasPrefix(fullName, "<operator>") {
		return true
	}
	// Filter primitive type declarations: int, void, char
	if label == NodeTypeDecl && (fullName == "int" || fullName == "void" || fullName == "ANY") {
		return true
	}
	// Filter compiler synthetic methods
	if strings.Contains(name, "<init>") && code == "" {
		return true
	}
	return false
}

// convertVertexToNode maps raw vertex properties to CPGNode.
func convertVertexToNode(id int64, label, project string, props map[string]any) CPGNode {
	name := fmt.Sprintf("%v", extractPropertyValue(props["name"]))
	if name == "" || name == "<nil>" {
		name = fmt.Sprintf("%v", extractPropertyValue(props["code"]))
	}
	if name == "" || name == "<nil>" {
		name = fmt.Sprintf("%s_%d", label, id)
	}

	qName := fmt.Sprintf("%v", extractPropertyValue(props["fullName"]))
	if qName == "" || qName == "<nil>" {
		qName = fmt.Sprintf("%s::%s", project, name)
	}

	filePath := fmt.Sprintf("%v", extractPropertyValue(props["filename"]))
	if filePath == "" || filePath == "<nil>" {
		filePath = fmt.Sprintf("%v", extractPropertyValue(props["file"]))
	}
	if filePath == "<nil>" {
		filePath = ""
	}

	startLine := 0
	if sl := extractPropertyValue(props["lineNumber"]); sl != nil {
		if slInt, ok := sl.(float64); ok {
			startLine = int(slInt)
		} else if slStr, ok := sl.(string); ok {
			startLine, _ = strconv.Atoi(slStr)
		}
	}

	endLine := startLine
	if el := extractPropertyValue(props["lineNumberEnd"]); el != nil {
		if elInt, ok := el.(float64); ok {
			endLine = int(elInt)
		} else if elStr, ok := el.(string); ok {
			endLine, _ = strconv.Atoi(elStr)
		}
	}

	flatProps := make(map[string]any)
	for k, v := range props {
		unpacked := extractPropertyValue(v)
		if unpacked != nil && unpacked != "<nil>" {
			flatProps[k] = unpacked
		}
	}

	return CPGNode{
		ID:            id,
		Project:       project,
		Label:         label,
		Name:          name,
		QualifiedName: qName,
		FilePath:      filePath,
		StartLine:     startLine,
		EndLine:       endLine,
		Properties:    flatProps,
		Val:           NodeWeight(label),
	}
}

// ParseDOTExport parses Graphviz DOT files produced by joern-export.
func ParseDOTExport(exportDir string, projectName string) (*ExtractedCPG, error) {
	entries, err := os.ReadDir(exportDir)
	if err != nil {
		return nil, err
	}

	result := &ExtractedCPG{}
	seenNodes := make(map[int64]bool)

	// Regex for DOT node: "123" [label = <(METHOD,myFunc)<SUB>1</SUB>> ]
	nodeRegex := regexp.MustCompile(`"(\d+)"\s*\[\s*label\s*=\s*<(?:\([^,]+,)?([^)>]+)`)
	// Regex for DOT edge: "123" -> "456"  [ label = "CFG" ]
	edgeRegex := regexp.MustCompile(`"(\d+)"\s*->\s*"(\d+)"\s*\[\s*label\s*=\s*"([^"]+)"`)

	for _, e := range entries {
		if e.IsDir() || !strings.HasSuffix(e.Name(), ".dot") {
			continue
		}
		dotPath := filepath.Join(exportDir, e.Name())
		f, err := os.Open(dotPath)
		if err != nil {
			continue
		}

		scanner := bufio.NewScanner(f)
		for scanner.Scan() {
			line := strings.TrimSpace(scanner.Text())
			if nodeMatch := nodeRegex.FindStringSubmatch(line); len(nodeMatch) >= 3 {
				id, _ := strconv.ParseInt(nodeMatch[1], 10, 64)
				name := strings.TrimSpace(nodeMatch[2])
				if id > 0 && !seenNodes[id] {
					label := NodeMethod
					if strings.Contains(line, "TYPE_DECL") {
						label = NodeTypeDecl
					} else if strings.Contains(line, "CALL") {
						label = NodeCall
					}
					result.Nodes = append(result.Nodes, CPGNode{
						ID:            id,
						Project:       projectName,
						Label:         label,
						Name:          name,
						QualifiedName: fmt.Sprintf("%s::%s", projectName, name),
						Val:           NodeWeight(label),
					})
					seenNodes[id] = true
				}
			} else if edgeMatch := edgeRegex.FindStringSubmatch(line); len(edgeMatch) >= 4 {
				srcID, _ := strconv.ParseInt(edgeMatch[1], 10, 64)
				tgtID, _ := strconv.ParseInt(edgeMatch[2], 10, 64)
				edgeType := NormalizeEdgeType(edgeMatch[3])
				if srcID > 0 && tgtID > 0 && seenNodes[srcID] && seenNodes[tgtID] {
					result.Edges = append(result.Edges, CPGEdge{
						Project:  projectName,
						SourceID: srcID,
						TargetID: tgtID,
						Type:     edgeType,
					})
				}
			}
		}
		_ = f.Close()
	}

	return result, nil
}
