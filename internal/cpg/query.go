package cpg

import (
	"encoding/json"
	"fmt"
	"sort"
	"strings"

	"cb-indexer/internal/graphmeta"
)

// QueryCPGGraph queries a CPG SQLite database and returns a GraphPayload for visualization.
func QueryCPGGraph(dbPath string, limit int, labels []string, edgeTypes []string, query string) (*graphmeta.GraphPayload, error) {
	if dbPath == "" {
		return nil, fmt.Errorf("empty cpg db path")
	}
	if limit <= 0 {
		limit = 250
	} else if limit > 2000 {
		limit = 2000
	}

	db, err := OpenCPGDB(dbPath, true)
	if err != nil {
		return nil, err
	}
	defer db.Close()

	// 1. Total counts
	var totalNodes, totalEdges int
	_ = db.QueryRow("SELECT COUNT(*) FROM nodes").Scan(&totalNodes)
	_ = db.QueryRow("SELECT COUNT(*) FROM edges").Scan(&totalEdges)

	// 2. Discover available labels
	var availableLabels []string
	labelRows, err := db.Query("SELECT DISTINCT label FROM nodes WHERE label != '' ORDER BY label ASC")
	if err == nil {
		defer labelRows.Close()
		for labelRows.Next() {
			var l string
			if err := labelRows.Scan(&l); err == nil && l != "" {
				availableLabels = append(availableLabels, l)
			}
		}
	}

	// 3. Discover available edge types
	var availableTypes []string
	typeRows, err := db.Query("SELECT DISTINCT type FROM edges WHERE type != '' ORDER BY type ASC")
	if err == nil {
		defer typeRows.Close()
		for typeRows.Next() {
			var t string
			if err := typeRows.Scan(&t); err == nil && t != "" {
				availableTypes = append(availableTypes, t)
			}
		}
	}

	// 4. Query nodes
	var conditions []string
	var args []any

	if query != "" {
		pattern := "%" + query + "%"
		conditions = append(conditions, "(name LIKE ? OR qualified_name LIKE ? OR file_path LIKE ?)")
		args = append(args, pattern, pattern, pattern)
	}

	if len(labels) > 0 {
		placeholders := make([]string, len(labels))
		for i, l := range labels {
			placeholders[i] = "?"
			args = append(args, l)
		}
		conditions = append(conditions, fmt.Sprintf("label IN (%s)", strings.Join(placeholders, ",")))
	}

	whereClause := ""
	if len(conditions) > 0 {
		whereClause = "WHERE " + strings.Join(conditions, " AND ")
	}

	nodeSQL := fmt.Sprintf(`
		SELECT id, project, label, name, qualified_name, file_path, start_line, end_line, properties
		FROM nodes
		%s
		ORDER BY
			CASE
				WHEN label = 'File' THEN 0
				WHEN label IN ('Class', 'TypeDecl') THEN 1
				WHEN label IN ('Method', 'Function') THEN 2
				WHEN label = 'Call' THEN 3
				WHEN label = 'Param' THEN 4
				ELSE 5
			END,
			length(name) ASC
		LIMIT ?`, whereClause)

	args = append(args, limit)

	rows, err := db.Query(nodeSQL, args...)
	if err != nil {
		return nil, fmt.Errorf("query cpg nodes error: %w", err)
	}
	defer rows.Close()

	var nodes []graphmeta.GraphNode
	nodeSet := make(map[int]bool)
	var projectName string

	for rows.Next() {
		var n graphmeta.GraphNode
		var propStr string
		if err := rows.Scan(&n.ID, &n.Project, &n.Label, &n.Name, &n.QualifiedName, &n.FilePath, &n.StartLine, &n.EndLine, &propStr); err != nil {
			continue
		}
		if projectName == "" && n.Project != "" {
			projectName = n.Project
		}
		if propStr != "" && propStr != "{}" {
			var props map[string]any
			if err := json.Unmarshal([]byte(propStr), &props); err == nil {
				n.Properties = props
			}
		}
		n.Val = NodeWeight(n.Label)
		nodes = append(nodes, n)
		nodeSet[n.ID] = true
	}

	// 5. Query edges connecting the returned nodes
	var links []graphmeta.GraphEdge
	if len(nodes) > 0 {
		var edgeConditions []string
		var edgeArgs []any

		if len(edgeTypes) > 0 {
			placeholders := make([]string, len(edgeTypes))
			for i, t := range edgeTypes {
				placeholders[i] = "?"
				edgeArgs = append(edgeArgs, t)
			}
			edgeConditions = append(edgeConditions, fmt.Sprintf("type IN (%s)", strings.Join(placeholders, ",")))
		}

		edgeWhere := ""
		if len(edgeConditions) > 0 {
			edgeWhere = "WHERE " + strings.Join(edgeConditions, " AND ")
		}

		edgeSQL := fmt.Sprintf(`
			SELECT id, project, source_id, target_id, type, properties
			FROM edges
			%s
			LIMIT 5000`, edgeWhere)

		edgeRows, err := db.Query(edgeSQL, edgeArgs...)
		if err == nil {
			defer edgeRows.Close()
			for edgeRows.Next() {
				var e graphmeta.GraphEdge
				var propStr string
				if err := edgeRows.Scan(&e.ID, &e.Project, &e.Source, &e.Target, &e.Type, &propStr); err != nil {
					continue
				}
				// Keep only edges whose source and target are both in the nodes set
				if nodeSet[e.Source] && nodeSet[e.Target] {
					if propStr != "" && propStr != "{}" {
						var props map[string]any
						if err := json.Unmarshal([]byte(propStr), &props); err == nil {
							e.Properties = props
						}
					}
					links = append(links, e)
				}
			}
		}
	}

	if projectName == "" {
		projectName = "CPG"
	}

	return &graphmeta.GraphPayload{
		Project:         projectName,
		Scope:           "cpg",
		TotalNodes:      totalNodes,
		TotalEdges:      totalEdges,
		ReturnedNodes:   len(nodes),
		ReturnedEdges:   len(links),
		AvailableLabels: availableLabels,
		AvailableTypes:  availableTypes,
		Nodes:           nodes,
		Links:           links,
	}, nil
}

// QueryMultiCPGGraph queries multiple CPG SQLite databases and merges nodes and links.
func QueryMultiCPGGraph(items []CPGCacheItem, totalLimit int, labels []string, edgeTypes []string, query string) (*graphmeta.GraphPayload, error) {
	if len(items) == 0 {
		return &graphmeta.GraphPayload{
			Project: "CPG Multi-Repo",
			Scope:   "cpg",
			Nodes:   []graphmeta.GraphNode{},
			Links:   []graphmeta.GraphEdge{},
		}, nil
	}

	if totalLimit <= 0 {
		totalLimit = 500
	} else if totalLimit > 3000 {
		totalLimit = 3000
	}

	perDbLimit := totalLimit / len(items)
	if perDbLimit < 50 {
		perDbLimit = 50
	}

	var allNodes []graphmeta.GraphNode
	var allLinks []graphmeta.GraphEdge
	labelSet := make(map[string]bool)
	typeSet := make(map[string]bool)
	totalNodes := 0
	totalEdges := 0

	for _, item := range items {
		payload, err := QueryCPGGraph(item.DBPath, perDbLimit, labels, edgeTypes, query)
		if err != nil {
			continue
		}
		totalNodes += payload.TotalNodes
		totalEdges += payload.TotalEdges

		for _, l := range payload.AvailableLabels {
			labelSet[l] = true
		}
		for _, t := range payload.AvailableTypes {
			typeSet[t] = true
		}
		allNodes = append(allNodes, payload.Nodes...)
		allLinks = append(allLinks, payload.Links...)
	}

	var avLabels []string
	for l := range labelSet {
		avLabels = append(avLabels, l)
	}
	sort.Strings(avLabels)

	var avTypes []string
	for t := range typeSet {
		avTypes = append(avTypes, t)
	}
	sort.Strings(avTypes)

	return &graphmeta.GraphPayload{
		Project:         "CPG Multi-Repo",
		Scope:           "cpg",
		TotalNodes:      totalNodes,
		TotalEdges:      totalEdges,
		ReturnedNodes:   len(allNodes),
		ReturnedEdges:   len(allLinks),
		AvailableLabels: avLabels,
		AvailableTypes:  avTypes,
		Nodes:           allNodes,
		Links:           allLinks,
	}, nil
}

// GetCPGCallers finds caller nodes that invoke the specified method.
func GetCPGCallers(dbPath string, targetMethod string) ([]CPGCallerResult, error) {
	db, err := OpenCPGDB(dbPath, true)
	if err != nil {
		return nil, err
	}
	defer db.Close()

	// Find caller through incoming CALL edges
	query := `
		SELECT
			c.id, c.project, c.label, c.name, c.qualified_name, c.file_path, c.start_line, c.end_line, c.properties,
			m.id, m.project, m.label, m.name, m.qualified_name, m.file_path, m.start_line, m.end_line, m.properties,
			e.id, e.project, e.source_id, e.target_id, e.type, e.properties
		FROM edges e
		JOIN nodes c ON e.target_id = c.id
		JOIN nodes m ON e.source_id = m.id
		WHERE e.type = 'CALL' AND (c.name = ? OR c.qualified_name LIKE ?)
		LIMIT 50
	`
	rows, err := db.Query(query, targetMethod, "%"+targetMethod+"%")
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var results []CPGCallerResult
	for rows.Next() {
		var callSite, caller CPGNode
		var edge CPGEdge
		var callProp, callerProp, edgeProp string

		if err := rows.Scan(
			&callSite.ID, &callSite.Project, &callSite.Label, &callSite.Name, &callSite.QualifiedName,
			&callSite.FilePath, &callSite.StartLine, &callSite.EndLine, &callProp,
			&caller.ID, &caller.Project, &caller.Label, &caller.Name, &caller.QualifiedName,
			&caller.FilePath, &caller.StartLine, &caller.EndLine, &callerProp,
			&edge.ID, &edge.Project, &edge.SourceID, &edge.TargetID, &edge.Type, &edgeProp,
		); err != nil {
			continue
		}
		_ = json.Unmarshal([]byte(callProp), &callSite.Properties)
		_ = json.Unmarshal([]byte(callerProp), &caller.Properties)
		_ = json.Unmarshal([]byte(edgeProp), &edge.Properties)

		results = append(results, CPGCallerResult{
			CallerNode: caller,
			CallSite:   callSite,
			Edge:       edge,
		})
	}
	return results, nil
}

// GetCPGCallees finds callee nodes invoked by the specified method.
func GetCPGCallees(dbPath string, sourceMethod string) ([]CPGCalleeResult, error) {
	db, err := OpenCPGDB(dbPath, true)
	if err != nil {
		return nil, err
	}
	defer db.Close()

	query := `
		SELECT
			m.id, m.project, m.label, m.name, m.qualified_name, m.file_path, m.start_line, m.end_line, m.properties,
			c.id, c.project, c.label, c.name, c.qualified_name, c.file_path, c.start_line, c.end_line, c.properties,
			e.id, e.project, e.source_id, e.target_id, e.type, e.properties
		FROM edges e
		JOIN nodes m ON e.source_id = m.id
		JOIN nodes c ON e.target_id = c.id
		WHERE e.type = 'CALL' AND (m.name = ? OR m.qualified_name LIKE ?)
		LIMIT 50
	`
	rows, err := db.Query(query, sourceMethod, "%"+sourceMethod+"%")
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var results []CPGCalleeResult
	for rows.Next() {
		var caller, callee CPGNode
		var edge CPGEdge
		var callerProp, calleeProp, edgeProp string

		if err := rows.Scan(
			&caller.ID, &caller.Project, &caller.Label, &caller.Name, &caller.QualifiedName,
			&caller.FilePath, &caller.StartLine, &caller.EndLine, &callerProp,
			&callee.ID, &callee.Project, &callee.Label, &callee.Name, &callee.QualifiedName,
			&callee.FilePath, &callee.StartLine, &callee.EndLine, &calleeProp,
			&edge.ID, &edge.Project, &edge.SourceID, &edge.TargetID, &edge.Type, &edgeProp,
		); err != nil {
			continue
		}
		_ = json.Unmarshal([]byte(callerProp), &caller.Properties)
		_ = json.Unmarshal([]byte(calleeProp), &callee.Properties)
		_ = json.Unmarshal([]byte(edgeProp), &edge.Properties)

		results = append(results, CPGCalleeResult{
			CalleeNode: callee,
			CallSite:   caller,
			Edge:       edge,
		})
	}
	return results, nil
}

// GetCPGReferences finds reference links to a variable or parameter.
func GetCPGReferences(dbPath string, symbol string) ([]CPGReferenceResult, error) {
	db, err := OpenCPGDB(dbPath, true)
	if err != nil {
		return nil, err
	}
	defer db.Close()

	query := `
		SELECT
			t.id, t.project, t.label, t.name, t.qualified_name, t.file_path, t.start_line, t.end_line, t.properties,
			s.id, s.project, s.label, s.name, s.qualified_name, s.file_path, s.start_line, s.end_line, s.properties,
			e.id, e.project, e.source_id, e.target_id, e.type, e.properties
		FROM edges e
		JOIN nodes t ON e.target_id = t.id
		JOIN nodes s ON e.source_id = s.id
		WHERE e.type = 'REF' AND (t.name = ? OR t.qualified_name LIKE ?)
		LIMIT 50
	`
	rows, err := db.Query(query, symbol, "%"+symbol+"%")
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var results []CPGReferenceResult
	for rows.Next() {
		var target, source CPGNode
		var edge CPGEdge
		var tgtProp, srcProp, edgeProp string

		if err := rows.Scan(
			&target.ID, &target.Project, &target.Label, &target.Name, &target.QualifiedName,
			&target.FilePath, &target.StartLine, &target.EndLine, &tgtProp,
			&source.ID, &source.Project, &source.Label, &source.Name, &source.QualifiedName,
			&source.FilePath, &source.StartLine, &source.EndLine, &srcProp,
			&edge.ID, &edge.Project, &edge.SourceID, &edge.TargetID, &edge.Type, &edgeProp,
		); err != nil {
			continue
		}
		_ = json.Unmarshal([]byte(tgtProp), &target.Properties)
		_ = json.Unmarshal([]byte(srcProp), &source.Properties)
		_ = json.Unmarshal([]byte(edgeProp), &edge.Properties)

		results = append(results, CPGReferenceResult{
			TargetNode: target,
			SourceNode: source,
			Edge:       edge,
		})
	}
	return results, nil
}

// GetCPGControlFlow traces control-flow steps for a method.
func GetCPGControlFlow(dbPath string, method string) (*CPGFlowResult, error) {
	db, err := OpenCPGDB(dbPath, true)
	if err != nil {
		return nil, err
	}
	defer db.Close()

	var rootMethod CPGNode
	var rootProp string
	err = db.QueryRow(`
		SELECT id, project, label, name, qualified_name, file_path, start_line, end_line, properties
		FROM nodes WHERE (name = ? OR qualified_name LIKE ?) AND label IN ('Method', 'Function')
		LIMIT 1
	`, method, "%"+method+"%").Scan(
		&rootMethod.ID, &rootMethod.Project, &rootMethod.Label, &rootMethod.Name, &rootMethod.QualifiedName,
		&rootMethod.FilePath, &rootMethod.StartLine, &rootMethod.EndLine, &rootProp,
	)
	if err != nil {
		return nil, fmt.Errorf("method not found: %s", method)
	}
	_ = json.Unmarshal([]byte(rootProp), &rootMethod.Properties)

	// Traverse CFG edges originating from or passing through this method's children
	rows, err := db.Query(`
		SELECT n.id, n.project, n.label, n.name, n.qualified_name, n.file_path, n.start_line, n.end_line, n.properties, e.type
		FROM edges e
		JOIN nodes n ON e.target_id = n.id
		WHERE e.type = 'CFG' AND e.source_id IN (
			SELECT target_id FROM edges WHERE source_id = ? AND type = 'AST'
			UNION SELECT ?
		)
		ORDER BY n.start_line ASC
		LIMIT 25
	`, rootMethod.ID, rootMethod.ID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var steps []CPGFlowStep
	stepIdx := 1
	for rows.Next() {
		var stepNode CPGNode
		var propStr, edgeType string
		if err := rows.Scan(
			&stepNode.ID, &stepNode.Project, &stepNode.Label, &stepNode.Name, &stepNode.QualifiedName,
			&stepNode.FilePath, &stepNode.StartLine, &stepNode.EndLine, &propStr, &edgeType,
		); err == nil {
			_ = json.Unmarshal([]byte(propStr), &stepNode.Properties)
			steps = append(steps, CPGFlowStep{
				StepIndex: stepIdx,
				Node:      stepNode,
				EdgeType:  edgeType,
			})
			stepIdx++
		}
	}

	sink := rootMethod
	if len(steps) > 0 {
		sink = steps[len(steps)-1].Node
	}

	return &CPGFlowResult{
		FlowType: "CFG",
		Source:   rootMethod,
		Sink:     sink,
		Steps:    steps,
	}, nil
}

// GetCPGDataFlow traces data flow paths between variables, parameters, and calls.
func GetCPGDataFlow(dbPath string, sourceSymbol, sinkSymbol string) (*CPGFlowResult, error) {
	db, err := OpenCPGDB(dbPath, true)
	if err != nil {
		return nil, err
	}
	defer db.Close()

	var srcNode CPGNode
	var srcProp string
	err = db.QueryRow(`
		SELECT id, project, label, name, qualified_name, file_path, start_line, end_line, properties
		FROM nodes WHERE (name = ? OR qualified_name LIKE ?)
		LIMIT 1
	`, sourceSymbol, "%"+sourceSymbol+"%").Scan(
		&srcNode.ID, &srcNode.Project, &srcNode.Label, &srcNode.Name, &srcNode.QualifiedName,
		&srcNode.FilePath, &srcNode.StartLine, &srcNode.EndLine, &srcProp,
	)
	if err != nil {
		return nil, fmt.Errorf("source symbol not found: %s", sourceSymbol)
	}
	_ = json.Unmarshal([]byte(srcProp), &srcNode.Properties)

	rows, err := db.Query(`
		SELECT n.id, n.project, n.label, n.name, n.qualified_name, n.file_path, n.start_line, n.end_line, n.properties, e.type
		FROM edges e
		JOIN nodes n ON e.target_id = n.id
		WHERE e.type = 'DATA_FLOW' AND e.source_id = ?
		LIMIT 25
	`, srcNode.ID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var steps []CPGFlowStep
	stepIdx := 1
	for rows.Next() {
		var stepNode CPGNode
		var propStr, edgeType string
		if err := rows.Scan(
			&stepNode.ID, &stepNode.Project, &stepNode.Label, &stepNode.Name, &stepNode.QualifiedName,
			&stepNode.FilePath, &stepNode.StartLine, &stepNode.EndLine, &propStr, &edgeType,
		); err == nil {
			_ = json.Unmarshal([]byte(propStr), &stepNode.Properties)
			steps = append(steps, CPGFlowStep{
				StepIndex: stepIdx,
				Node:      stepNode,
				EdgeType:  edgeType,
			})
			stepIdx++
		}
	}

	sink := srcNode
	if len(steps) > 0 {
		sink = steps[len(steps)-1].Node
	}

	return &CPGFlowResult{
		FlowType: "DATA_FLOW",
		Source:   srcNode,
		Sink:     sink,
		Steps:    steps,
	}, nil
}

// GetCPGTypeRelations finds type relationships (inheritance, evaluation) for a type.
func GetCPGTypeRelations(dbPath string, typeName string) ([]CPGTypeRelationResult, error) {
	db, err := OpenCPGDB(dbPath, true)
	if err != nil {
		return nil, err
	}
	defer db.Close()

	query := `
		SELECT
			t.id, t.project, t.label, t.name, t.qualified_name, t.file_path, t.start_line, t.end_line, t.properties,
			tgt.id, tgt.project, tgt.label, tgt.name, tgt.qualified_name, tgt.file_path, tgt.start_line, tgt.end_line, tgt.properties,
			e.type
		FROM edges e
		JOIN nodes t ON e.source_id = t.id
		JOIN nodes tgt ON e.target_id = tgt.id
		WHERE e.type IN ('TYPE', 'INHERITS_FROM', 'EVAL_TYPE') AND (t.name = ? OR t.qualified_name LIKE ?)
		LIMIT 50
	`
	rows, err := db.Query(query, typeName, "%"+typeName+"%")
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var results []CPGTypeRelationResult
	for rows.Next() {
		var typeNode, tgtNode CPGNode
		var tProp, tgtProp, rel string
		if err := rows.Scan(
			&typeNode.ID, &typeNode.Project, &typeNode.Label, &typeNode.Name, &typeNode.QualifiedName,
			&typeNode.FilePath, &typeNode.StartLine, &typeNode.EndLine, &tProp,
			&tgtNode.ID, &tgtNode.Project, &tgtNode.Label, &tgtNode.Name, &tgtNode.QualifiedName,
			&tgtNode.FilePath, &tgtNode.StartLine, &tgtNode.EndLine, &tgtProp,
			&rel,
		); err == nil {
			_ = json.Unmarshal([]byte(tProp), &typeNode.Properties)
			_ = json.Unmarshal([]byte(tgtProp), &tgtNode.Properties)
			results = append(results, CPGTypeRelationResult{
				TypeNode:   typeNode,
				TargetNode: tgtNode,
				Relation:   rel,
			})
		}
	}
	return results, nil
}
