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

// GetCPGCallFlow traces multi-hop call hierarchies (callers, callees, or both).
func GetCPGCallFlow(dbPath string, symbol string, direction string, maxDepth int) (*CPGCallFlowResult, error) {
	db, err := OpenCPGDB(dbPath, true)
	if err != nil {
		return nil, err
	}
	defer db.Close()

	var root CPGNode
	var propStr string
	err = db.QueryRow(`
		SELECT id, project, label, name, qualified_name, file_path, start_line, end_line, properties
		FROM nodes
		WHERE (name = ? OR qualified_name LIKE ?) AND label IN ('Method', 'Function', 'Call')
		ORDER BY CASE WHEN name = ? THEN 0 ELSE 1 END
		LIMIT 1
	`, symbol, "%"+symbol+"%", symbol).Scan(
		&root.ID, &root.Project, &root.Label, &root.Name, &root.QualifiedName,
		&root.FilePath, &root.StartLine, &root.EndLine, &propStr,
	)
	if err != nil {
		// Fallback to any node matching the symbol
		err = db.QueryRow(`
			SELECT id, project, label, name, qualified_name, file_path, start_line, end_line, properties
			FROM nodes WHERE (name = ? OR qualified_name LIKE ?) LIMIT 1
		`, symbol, "%"+symbol+"%").Scan(
			&root.ID, &root.Project, &root.Label, &root.Name, &root.QualifiedName,
			&root.FilePath, &root.StartLine, &root.EndLine, &propStr,
		)
		if err != nil {
			return nil, fmt.Errorf("symbol not found in CPG: %s", symbol)
		}
	}
	_ = json.Unmarshal([]byte(propStr), &root.Properties)
	root.Val = NodeWeight(root.Label)

	dir := strings.ToLower(strings.TrimSpace(direction))
	if dir != "callers" && dir != "callees" && dir != "both" {
		dir = "both"
	}

	if maxDepth <= 0 {
		maxDepth = 3
	} else if maxDepth > 6 {
		maxDepth = 6
	}

	nodesMap := make(map[int64]CPGNode)
	nodesMap[root.ID] = root
	edgesMap := make(map[string]CPGEdge)

	currentLevel := []int64{root.ID}
	visited := make(map[int64]bool)
	visited[root.ID] = true

	for depth := 1; depth <= maxDepth && len(currentLevel) > 0; depth++ {
		var nextLevel []int64

		for _, currID := range currentLevel {
			// 1. Callers (incoming CALL edges)
			if dir == "callers" || dir == "both" {
				rows, err := db.Query(`
					SELECT n.id, n.project, n.label, n.name, n.qualified_name, n.file_path, n.start_line, n.end_line, n.properties,
					       e.id, e.project, e.source_id, e.target_id, e.type, e.properties
					FROM edges e
					JOIN nodes n ON e.source_id = n.id
					WHERE e.target_id = ? AND e.type = 'CALL'
					LIMIT 30
				`, currID)
				if err == nil {
					for rows.Next() {
						var n CPGNode
						var e CPGEdge
						var nProp, eProp string
						if err := rows.Scan(&n.ID, &n.Project, &n.Label, &n.Name, &n.QualifiedName, &n.FilePath, &n.StartLine, &n.EndLine, &nProp,
							&e.ID, &e.Project, &e.SourceID, &e.TargetID, &e.Type, &eProp); err == nil {
							_ = json.Unmarshal([]byte(nProp), &n.Properties)
							_ = json.Unmarshal([]byte(eProp), &e.Properties)
							n.Val = NodeWeight(n.Label)
							nodesMap[n.ID] = n
							edgeKey := fmt.Sprintf("%d-%d-%s", e.SourceID, e.TargetID, e.Type)
							edgesMap[edgeKey] = e
							if !visited[n.ID] {
								visited[n.ID] = true
								nextLevel = append(nextLevel, n.ID)
							}
						}
					}
					rows.Close()
				}
			}

			// 2. Callees (outgoing CALL edges)
			if dir == "callees" || dir == "both" {
				rows, err := db.Query(`
					SELECT n.id, n.project, n.label, n.name, n.qualified_name, n.file_path, n.start_line, n.end_line, n.properties,
					       e.id, e.project, e.source_id, e.target_id, e.type, e.properties
					FROM edges e
					JOIN nodes n ON e.target_id = n.id
					WHERE e.source_id = ? AND e.type = 'CALL'
					LIMIT 30
				`, currID)
				if err == nil {
					for rows.Next() {
						var n CPGNode
						var e CPGEdge
						var nProp, eProp string
						if err := rows.Scan(&n.ID, &n.Project, &n.Label, &n.Name, &n.QualifiedName, &n.FilePath, &n.StartLine, &n.EndLine, &nProp,
							&e.ID, &e.Project, &e.SourceID, &e.TargetID, &e.Type, &eProp); err == nil {
							_ = json.Unmarshal([]byte(nProp), &n.Properties)
							_ = json.Unmarshal([]byte(eProp), &e.Properties)
							n.Val = NodeWeight(n.Label)
							nodesMap[n.ID] = n
							edgeKey := fmt.Sprintf("%d-%d-%s", e.SourceID, e.TargetID, e.Type)
							edgesMap[edgeKey] = e
							if !visited[n.ID] {
								visited[n.ID] = true
								nextLevel = append(nextLevel, n.ID)
							}
						}
					}
					rows.Close()
				}
			}
		}
		currentLevel = nextLevel
	}

	var nodesList []CPGNode
	for _, n := range nodesMap {
		nodesList = append(nodesList, n)
	}
	var edgesList []CPGEdge
	for _, e := range edgesMap {
		edgesList = append(edgesList, e)
	}

	return &CPGCallFlowResult{
		Direction: dir,
		Depth:     maxDepth,
		RootNode:  root,
		Nodes:     nodesList,
		Edges:     edgesList,
	}, nil
}

// GetCPGImpact evaluates the blast radius and dependent callers of a node.
func GetCPGImpact(dbPath string, symbol string) (*CPGImpactResult, error) {
	db, err := OpenCPGDB(dbPath, true)
	if err != nil {
		return nil, err
	}
	defer db.Close()

	var target CPGNode
	var propStr string
	err = db.QueryRow(`
		SELECT id, project, label, name, qualified_name, file_path, start_line, end_line, properties
		FROM nodes
		WHERE (name = ? OR qualified_name LIKE ?)
		ORDER BY CASE WHEN name = ? THEN 0 ELSE 1 END
		LIMIT 1
	`, symbol, "%"+symbol+"%", symbol).Scan(
		&target.ID, &target.Project, &target.Label, &target.Name, &target.QualifiedName,
		&target.FilePath, &target.StartLine, &target.EndLine, &propStr,
	)
	if err != nil {
		return nil, fmt.Errorf("symbol not found for impact analysis: %s", symbol)
	}
	_ = json.Unmarshal([]byte(propStr), &target.Properties)
	target.Val = NodeWeight(target.Label)

	directMap := make(map[int64]CPGNode)
	indirectMap := make(map[int64]CPGNode)
	allNodesMap := make(map[int64]CPGNode)
	allNodesMap[target.ID] = target
	edgesMap := make(map[string]CPGEdge)
	filesMap := make(map[string]bool)
	if target.FilePath != "" {
		filesMap[target.FilePath] = true
	}

	// 1. Direct callers
	directRows, err := db.Query(`
		SELECT n.id, n.project, n.label, n.name, n.qualified_name, n.file_path, n.start_line, n.end_line, n.properties,
		       e.id, e.project, e.source_id, e.target_id, e.type, e.properties
		FROM edges e
		JOIN nodes n ON e.source_id = n.id
		WHERE e.target_id = ? AND e.type IN ('CALL', 'REF', 'TYPE')
	`, target.ID)
	if err == nil {
		for directRows.Next() {
			var n CPGNode
			var e CPGEdge
			var nProp, eProp string
			if err := directRows.Scan(&n.ID, &n.Project, &n.Label, &n.Name, &n.QualifiedName, &n.FilePath, &n.StartLine, &n.EndLine, &nProp,
				&e.ID, &e.Project, &e.SourceID, &e.TargetID, &e.Type, &eProp); err == nil {
				_ = json.Unmarshal([]byte(nProp), &n.Properties)
				_ = json.Unmarshal([]byte(eProp), &e.Properties)
				n.Val = NodeWeight(n.Label)
				directMap[n.ID] = n
				allNodesMap[n.ID] = n
				if n.FilePath != "" {
					filesMap[n.FilePath] = true
				}
				edgesMap[fmt.Sprintf("%d-%d-%s", e.SourceID, e.TargetID, e.Type)] = e
			}
		}
		directRows.Close()
	}

	// 2. Transitive indirect callers (depth 2 and 3)
	frontier := make([]int64, 0, len(directMap))
	visited := make(map[int64]bool)
	visited[target.ID] = true
	for id := range directMap {
		visited[id] = true
		frontier = append(frontier, id)
	}

	for hop := 0; hop < 2 && len(frontier) > 0; hop++ {
		var nextFrontier []int64
		for _, fID := range frontier {
			rows, err := db.Query(`
				SELECT n.id, n.project, n.label, n.name, n.qualified_name, n.file_path, n.start_line, n.end_line, n.properties,
				       e.id, e.project, e.source_id, e.target_id, e.type, e.properties
				FROM edges e
				JOIN nodes n ON e.source_id = n.id
				WHERE e.target_id = ? AND e.type IN ('CALL', 'REF')
				LIMIT 20
			`, fID)
			if err != nil {
				continue
			}
			for rows.Next() {
				var n CPGNode
				var e CPGEdge
				var nProp, eProp string
				if err := rows.Scan(&n.ID, &n.Project, &n.Label, &n.Name, &n.QualifiedName, &n.FilePath, &n.StartLine, &n.EndLine, &nProp,
					&e.ID, &e.Project, &e.SourceID, &e.TargetID, &e.Type, &eProp); err == nil {
					_ = json.Unmarshal([]byte(nProp), &n.Properties)
					_ = json.Unmarshal([]byte(eProp), &e.Properties)
					n.Val = NodeWeight(n.Label)
					if !visited[n.ID] {
						visited[n.ID] = true
						indirectMap[n.ID] = n
						allNodesMap[n.ID] = n
						if n.FilePath != "" {
							filesMap[n.FilePath] = true
						}
						nextFrontier = append(nextFrontier, n.ID)
					}
					edgesMap[fmt.Sprintf("%d-%d-%s", e.SourceID, e.TargetID, e.Type)] = e
				}
			}
			rows.Close()
		}
		frontier = nextFrontier
	}

	var directList, indirectList, allNodes []CPGNode
	for _, n := range directMap {
		directList = append(directList, n)
	}
	for _, n := range indirectMap {
		indirectList = append(indirectList, n)
	}
	for _, n := range allNodesMap {
		allNodes = append(allNodes, n)
	}
	var allEdges []CPGEdge
	for _, e := range edgesMap {
		allEdges = append(allEdges, e)
	}
	var affectedFiles []string
	for fp := range filesMap {
		affectedFiles = append(affectedFiles, fp)
	}
	sort.Strings(affectedFiles)

	return &CPGImpactResult{
		TargetNode:        target,
		DirectCallers:     directList,
		IndirectCallers:   indirectList,
		AffectedFiles:     affectedFiles,
		DirectCount:       len(directList),
		IndirectCount:     len(indirectList),
		AffectedFileCount: len(affectedFiles),
		Nodes:             allNodes,
		Edges:             allEdges,
	}, nil
}

// FindCPGPath searches for the shortest path between two nodes in CPG.
func FindCPGPath(dbPath string, fromSymbol, toSymbol, relType string) (*CPGPathResult, error) {
	db, err := OpenCPGDB(dbPath, true)
	if err != nil {
		return nil, err
	}
	defer db.Close()

	var fromNode, toNode CPGNode
	var fromProp, toProp string

	err = db.QueryRow(`
		SELECT id, project, label, name, qualified_name, file_path, start_line, end_line, properties
		FROM nodes WHERE name = ? OR qualified_name LIKE ?
		ORDER BY CASE WHEN name = ? THEN 0 ELSE 1 END LIMIT 1
	`, fromSymbol, "%"+fromSymbol+"%", fromSymbol).Scan(
		&fromNode.ID, &fromNode.Project, &fromNode.Label, &fromNode.Name, &fromNode.QualifiedName,
		&fromNode.FilePath, &fromNode.StartLine, &fromNode.EndLine, &fromProp,
	)
	if err != nil {
		return nil, fmt.Errorf("starting node '%s' not found", fromSymbol)
	}
	_ = json.Unmarshal([]byte(fromProp), &fromNode.Properties)

	err = db.QueryRow(`
		SELECT id, project, label, name, qualified_name, file_path, start_line, end_line, properties
		FROM nodes WHERE name = ? OR qualified_name LIKE ?
		ORDER BY CASE WHEN name = ? THEN 0 ELSE 1 END LIMIT 1
	`, toSymbol, "%"+toSymbol+"%", toSymbol).Scan(
		&toNode.ID, &toNode.Project, &toNode.Label, &toNode.Name, &toNode.QualifiedName,
		&toNode.FilePath, &toNode.StartLine, &toNode.EndLine, &toProp,
	)
	if err != nil {
		return nil, fmt.Errorf("destination node '%s' not found", toSymbol)
	}
	_ = json.Unmarshal([]byte(toProp), &toNode.Properties)

	// BFS queue
	type queueItem struct {
		nodeID int64
		path   []int64
		edges  []CPGEdge
	}

	queue := []queueItem{{nodeID: fromNode.ID, path: []int64{fromNode.ID}}}
	visited := make(map[int64]bool)
	visited[fromNode.ID] = true

	var foundPath []int64
	var foundEdges []CPGEdge

	typeFilter := ""
	var typeArgs []any
	if relType != "" && strings.ToUpper(relType) != "ALL" {
		typeFilter = " AND e.type = ?"
		typeArgs = append(typeArgs, strings.ToUpper(relType))
	}

	for len(queue) > 0 {
		curr := queue[0]
		queue = queue[1:]

		if curr.nodeID == toNode.ID {
			foundPath = curr.path
			foundEdges = curr.edges
			break
		}

		if len(curr.path) >= 8 {
			continue
		}

		querySQL := fmt.Sprintf(`
			SELECT e.id, e.project, e.source_id, e.target_id, e.type, e.properties
			FROM edges e
			WHERE e.source_id = ?%s
			LIMIT 50
		`, typeFilter)

		args := append([]any{curr.nodeID}, typeArgs...)
		rows, err := db.Query(querySQL, args...)
		if err != nil {
			continue
		}

		for rows.Next() {
			var e CPGEdge
			var propStr string
			if err := rows.Scan(&e.ID, &e.Project, &e.SourceID, &e.TargetID, &e.Type, &propStr); err == nil {
				_ = json.Unmarshal([]byte(propStr), &e.Properties)
				if !visited[e.TargetID] {
					visited[e.TargetID] = true
					newPath := append([]int64{}, curr.path...)
					newPath = append(newPath, e.TargetID)
					newEdges := append([]CPGEdge{}, curr.edges...)
					newEdges = append(newEdges, e)
					queue = append(queue, queueItem{nodeID: e.TargetID, path: newPath, edges: newEdges})
				}
			}
		}
		rows.Close()
	}

	if len(foundPath) == 0 {
		return &CPGPathResult{
			Found:        false,
			FromNode:     fromNode,
			ToNode:       toNode,
			Relationship: relType,
		}, nil
	}

	// Hydrate path nodes
	var pathNodes []CPGNode
	for _, id := range foundPath {
		var n CPGNode
		var pStr string
		if err := db.QueryRow(`
			SELECT id, project, label, name, qualified_name, file_path, start_line, end_line, properties
			FROM nodes WHERE id = ?
		`, id).Scan(&n.ID, &n.Project, &n.Label, &n.Name, &n.QualifiedName, &n.FilePath, &n.StartLine, &n.EndLine, &pStr); err == nil {
			_ = json.Unmarshal([]byte(pStr), &n.Properties)
			n.Val = NodeWeight(n.Label)
			pathNodes = append(pathNodes, n)
		}
	}

	return &CPGPathResult{
		Found:        true,
		FromNode:     fromNode,
		ToNode:       toNode,
		Relationship: relType,
		Nodes:        pathNodes,
		Edges:        foundEdges,
	}, nil
}

// GetCPGTaintFlow traces data flows between a source and a sink symbol.
func GetCPGTaintFlow(dbPath string, sourceSymbol, sinkSymbol string) (*CPGFlowResult, error) {
	// Leverage existing GetCPGDataFlow with source and sink
	return GetCPGDataFlow(dbPath, sourceSymbol, sinkSymbol)
}

// GetCPGNeighborhood fetches a node and its neighbors up to a given depth.
func GetCPGNeighborhood(dbPath string, nodeID int64, depth int, includeInbound, includeOutbound bool) (*graphmeta.GraphPayload, error) {
	db, err := OpenCPGDB(dbPath, true)
	if err != nil {
		return nil, err
	}
	defer db.Close()

	if depth <= 0 {
		depth = 1
	} else if depth > 3 {
		depth = 3
	}

	nodesMap := make(map[int64]graphmeta.GraphNode)
	edgesMap := make(map[string]graphmeta.GraphEdge)

	// Get root node
	var root graphmeta.GraphNode
	var propStr string
	if err := db.QueryRow(`
		SELECT id, project, label, name, qualified_name, file_path, start_line, end_line, properties
		FROM nodes WHERE id = ?
	`, nodeID).Scan(&root.ID, &root.Project, &root.Label, &root.Name, &root.QualifiedName,
		&root.FilePath, &root.StartLine, &root.EndLine, &propStr); err != nil {
		return nil, fmt.Errorf("node %d not found: %w", nodeID, err)
	}
	_ = json.Unmarshal([]byte(propStr), &root.Properties)
	root.Val = NodeWeight(root.Label)
	nodesMap[int64(root.ID)] = root

	currentLevel := []int64{int64(root.ID)}
	visited := make(map[int64]bool)
	visited[int64(root.ID)] = true

	for d := 1; d <= depth && len(currentLevel) > 0; d++ {
		var nextLevel []int64

		for _, currID := range currentLevel {
			// Outbound
			if includeOutbound {
				rows, err := db.Query(`
					SELECT n.id, n.project, n.label, n.name, n.qualified_name, n.file_path, n.start_line, n.end_line, n.properties,
					       e.id, e.project, e.source_id, e.target_id, e.type, e.properties
					FROM edges e
					JOIN nodes n ON e.target_id = n.id
					WHERE e.source_id = ?
					LIMIT 50
				`, currID)
				if err == nil {
					for rows.Next() {
						var n graphmeta.GraphNode
						var e graphmeta.GraphEdge
						var nP, eP string
						if err := rows.Scan(&n.ID, &n.Project, &n.Label, &n.Name, &n.QualifiedName, &n.FilePath, &n.StartLine, &n.EndLine, &nP,
							&e.ID, &e.Project, &e.Source, &e.Target, &e.Type, &eP); err == nil {
							_ = json.Unmarshal([]byte(nP), &n.Properties)
							_ = json.Unmarshal([]byte(eP), &e.Properties)
							n.Val = NodeWeight(n.Label)
							nodesMap[int64(n.ID)] = n
							edgesMap[fmt.Sprintf("%d-%d-%s", e.Source, e.Target, e.Type)] = e
							if !visited[int64(n.ID)] {
								visited[int64(n.ID)] = true
								nextLevel = append(nextLevel, int64(n.ID))
							}
						}
					}
					rows.Close()
				}
			}

			// Inbound
			if includeInbound {
				rows, err := db.Query(`
					SELECT n.id, n.project, n.label, n.name, n.qualified_name, n.file_path, n.start_line, n.end_line, n.properties,
					       e.id, e.project, e.source_id, e.target_id, e.type, e.properties
					FROM edges e
					JOIN nodes n ON e.source_id = n.id
					WHERE e.target_id = ?
					LIMIT 50
				`, currID)
				if err == nil {
					for rows.Next() {
						var n graphmeta.GraphNode
						var e graphmeta.GraphEdge
						var nP, eP string
						if err := rows.Scan(&n.ID, &n.Project, &n.Label, &n.Name, &n.QualifiedName, &n.FilePath, &n.StartLine, &n.EndLine, &nP,
							&e.ID, &e.Project, &e.Source, &e.Target, &e.Type, &eP); err == nil {
							_ = json.Unmarshal([]byte(nP), &n.Properties)
							_ = json.Unmarshal([]byte(eP), &e.Properties)
							n.Val = NodeWeight(n.Label)
							nodesMap[int64(n.ID)] = n
							edgesMap[fmt.Sprintf("%d-%d-%s", e.Source, e.Target, e.Type)] = e
							if !visited[int64(n.ID)] {
								visited[int64(n.ID)] = true
								nextLevel = append(nextLevel, int64(n.ID))
							}
						}
					}
					rows.Close()
				}
			}
		}
		currentLevel = nextLevel
	}

	var nodesList []graphmeta.GraphNode
	for _, n := range nodesMap {
		nodesList = append(nodesList, n)
	}
	var linksList []graphmeta.GraphEdge
	for _, e := range edgesMap {
		linksList = append(linksList, e)
	}

	return &graphmeta.GraphPayload{
		Project:       root.Project,
		Scope:         "cpg",
		TotalNodes:    len(nodesList),
		TotalEdges:    len(linksList),
		ReturnedNodes: len(nodesList),
		ReturnedEdges: len(linksList),
		Nodes:         nodesList,
		Links:         linksList,
	}, nil
}
