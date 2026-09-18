package graphmeta

import (
	"bufio"
	"database/sql"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"

	_ "modernc.org/sqlite"
)

// SymbolRecord represents an AST symbol indexed in a codebase-memory SQLite graph.
type SymbolRecord struct {
	ID            int            `json:"id"`
	Project       string         `json:"project"`
	Label         string         `json:"label"`
	Name          string         `json:"name"`
	QualifiedName string         `json:"qualified_name"`
	FilePath      string         `json:"file_path"`
	StartLine     int            `json:"start_line"`
	EndLine       int            `json:"end_line"`
	Properties    map[string]any `json:"properties,omitempty"`
}

// CodeSnippetResult represents source code slice around a requested symbol or line range.
type CodeSnippetResult struct {
	Project    string `json:"project"`
	FilePath   string `json:"file_path"`
	StartLine  int    `json:"start_line"`
	EndLine    int    `json:"end_line"`
	TotalLines int    `json:"total_lines"`
	Snippet    string `json:"snippet"`
}

// QueryCbmStats reads total node and edge counts from an indexed CBM SQLite database.
func QueryCbmStats(dbPath string) (nodes int, edges int, err error) {
	if dbPath == "" {
		return 0, 0, fmt.Errorf("empty db path")
	}

	// Open read-only SQLite database connection
	dsn := fmt.Sprintf("file:%s?mode=ro", strings.ReplaceAll(dbPath, "\\", "/"))
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return 0, 0, err
	}
	defer db.Close()

	_ = db.QueryRow("SELECT COUNT(*) FROM nodes").Scan(&nodes)
	_ = db.QueryRow("SELECT COUNT(*) FROM edges").Scan(&edges)

	return nodes, edges, nil
}

// SearchSymbolsInDB searches a single SQLite database for matching symbol nodes.
func SearchSymbolsInDB(dbPath, query, labelFilter string, limit int) ([]SymbolRecord, error) {
	if dbPath == "" {
		return nil, fmt.Errorf("empty db path")
	}
	if limit <= 0 {
		limit = 20
	}

	dsn := fmt.Sprintf("file:%s?mode=ro", strings.ReplaceAll(dbPath, "\\", "/"))
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, err
	}
	defer db.Close()

	var conditions []string
	var args []any

	if query != "" {
		pattern := "%" + query + "%"
		conditions = append(conditions, "(name LIKE ? OR qualified_name LIKE ? OR file_path LIKE ?)")
		args = append(args, pattern, pattern, pattern)
	}

	if labelFilter != "" {
		conditions = append(conditions, "label = ?")
		args = append(args, labelFilter)
	} else {
		// Exclude noisy container nodes by default
		conditions = append(conditions, "label NOT IN ('Branch', 'Folder', 'Project', 'File', 'EnvVar')")
	}

	whereClause := ""
	if len(conditions) > 0 {
		whereClause = "WHERE " + strings.Join(conditions, " AND ")
	}

	sqlQuery := fmt.Sprintf(`
		SELECT id, project, label, name, qualified_name, file_path, start_line, end_line, properties
		FROM nodes
		%s
		ORDER BY
			CASE
				WHEN name = ? THEN 0
				WHEN name LIKE ? THEN 1
				ELSE 2
			END,
			length(name) ASC
		LIMIT ?`, whereClause)

	args = append(args, query, query+"%", limit)

	rows, err := db.Query(sqlQuery, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var symbols []SymbolRecord
	for rows.Next() {
		var s SymbolRecord
		var propStr string
		if err := rows.Scan(&s.ID, &s.Project, &s.Label, &s.Name, &s.QualifiedName, &s.FilePath, &s.StartLine, &s.EndLine, &propStr); err != nil {
			continue
		}
		if propStr != "" && propStr != "{}" {
			var props map[string]any
			if err := json.Unmarshal([]byte(propStr), &props); err == nil {
				s.Properties = props
			}
		}
		symbols = append(symbols, s)
	}

	return symbols, nil
}

// SearchGlobalSymbols searches across all cached codebase-memory SQLite graphs.
func SearchGlobalSymbols(query, repoFilter, labelFilter string, limit int) ([]SymbolRecord, error) {
	if limit <= 0 {
		limit = 25
	}

	cached := ScanGlobalCbmCache()
	var matchedDBs []CbmCacheItem

	repoLower := strings.ToLower(repoFilter)
	for _, c := range cached {
		if repoFilter == "" || strings.Contains(strings.ToLower(c.Name), repoLower) || strings.Contains(strings.ToLower(c.ProjectID), repoLower) {
			matchedDBs = append(matchedDBs, c)
		}
	}

	var allSymbols []SymbolRecord
	perDbLimit := limit
	if len(matchedDBs) > 1 {
		perDbLimit = limit / len(matchedDBs)
		if perDbLimit < 5 {
			perDbLimit = 5
		}
	}

	for _, item := range matchedDBs {
		syms, err := SearchSymbolsInDB(item.DBPath, query, labelFilter, perDbLimit)
		if err == nil {
			allSymbols = append(allSymbols, syms...)
		}
		if len(allSymbols) >= limit {
			allSymbols = allSymbols[:limit]
			break
		}
	}

	return allSymbols, nil
}

// GetCodeSnippet reads lines around the specified range from a repository file on disk.
func GetCodeSnippet(absRepoPath, filePath string, startLine, endLine, padding int) (*CodeSnippetResult, error) {
	if absRepoPath == "" || filePath == "" {
		return nil, fmt.Errorf("absRepoPath and filePath are required")
	}

	fullPath := filepath.Join(absRepoPath, filePath)
	file, err := os.Open(fullPath)
	if err != nil {
		return nil, fmt.Errorf("failed to open file %s: %w", fullPath, err)
	}
	defer file.Close()

	if padding < 0 {
		padding = 3
	}

	fromLine := startLine - padding
	if fromLine < 1 {
		fromLine = 1
	}
	toLine := endLine + padding
	if toLine < fromLine {
		toLine = fromLine + 20
	}

	scanner := bufio.NewScanner(file)
	currentLine := 0
	var lines []string

	for scanner.Scan() {
		currentLine++
		if currentLine >= fromLine && currentLine <= toLine {
			lines = append(lines, fmt.Sprintf("%4d | %s", currentLine, scanner.Text()))
		}
		if currentLine > toLine+50 {
			break
		}
	}

	if err := scanner.Err(); err != nil {
		return nil, fmt.Errorf("reading file error: %w", err)
	}

	return &CodeSnippetResult{
		FilePath:   filePath,
		StartLine:  fromLine,
		EndLine:    min(toLine, currentLine),
		TotalLines: currentLine,
		Snippet:    strings.Join(lines, "\n"),
	}, nil
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}

// GraphNode represents an entity in the 2D/3D graph visualization.
type GraphNode struct {
	ID            int            `json:"id"`
	Project       string         `json:"project"`
	Label         string         `json:"label"`
	Name          string         `json:"name"`
	QualifiedName string         `json:"qualified_name"`
	FilePath      string         `json:"file_path,omitempty"`
	StartLine     int            `json:"start_line,omitempty"`
	EndLine       int            `json:"end_line,omitempty"`
	Properties    map[string]any `json:"properties,omitempty"`
	Val           float64        `json:"val,omitempty"`
	Color         string         `json:"color,omitempty"`
}

// GraphEdge represents a relationship link between nodes.
type GraphEdge struct {
	ID         int            `json:"id"`
	Project    string         `json:"project"`
	Source     int            `json:"source"`
	Target     int            `json:"target"`
	Type       string         `json:"type"`
	Properties map[string]any `json:"properties,omitempty"`
}

// GraphPayload represents the complete graph payload for 2D/3D visualization.
type GraphPayload struct {
	Project         string      `json:"project"`
	Scope           string      `json:"scope"` // "ast" or "topology"
	TotalNodes      int         `json:"total_nodes"`
	TotalEdges      int         `json:"total_edges"`
	ReturnedNodes   int         `json:"returned_nodes"`
	ReturnedEdges   int         `json:"returned_edges"`
	AvailableLabels []string    `json:"available_labels"`
	AvailableTypes  []string    `json:"available_types"`
	Nodes           []GraphNode `json:"nodes"`
	Links           []GraphEdge `json:"links"`
}

// NodeWeight calculates visual radius/importance for a node label.
func NodeWeight(label string) float64 {
	switch strings.ToLower(label) {
	case "project":
		return 16
	case "module", "folder", "branch":
		return 11
	case "class", "interface", "enum":
		return 8
	case "route", "gateway":
		return 7
	case "file":
		return 6
	case "function", "method":
		return 5
	case "variable", "field", "decorator":
		return 3
	default:
		return 4
	}
}

// FindCbmDB locates the SQLite database path for a given project or repo name.
func FindCbmDB(repoOrProject string) (string, error) {
	if repoOrProject == "" {
		return "", fmt.Errorf("empty project or repo name")
	}

	target := strings.ToLower(repoOrProject)
	slug := strings.ToLower(DeriveCbmSlug(repoOrProject))
	cached := ScanGlobalCbmCache()

	// 1. Exact match by Name or ProjectID
	for _, item := range cached {
		nameLower := strings.ToLower(item.Name)
		pidLower := strings.ToLower(item.ProjectID)
		if nameLower == target || pidLower == target || nameLower == slug || pidLower == slug {
			return item.DBPath, nil
		}
	}

	// 2. Substring match
	for _, item := range cached {
		nameLower := strings.ToLower(item.Name)
		if strings.Contains(nameLower, target) || strings.Contains(target, nameLower) {
			return item.DBPath, nil
		}
	}

	if len(cached) > 0 {
		// Fallback to first available cache item
		return cached[0].DBPath, nil
	}

	return "", fmt.Errorf("no codebase-memory database found for %q", repoOrProject)
}

// FindAllCbmDBs locates all SQLite database paths matching a project or repo list, or all cached DBs if empty.
func FindAllCbmDBs(repoOrProject string, repoNames []string) []CbmCacheItem {
	cached := ScanGlobalCbmCache()
	if len(cached) == 0 {
		return nil
	}

	var matched []CbmCacheItem
	seen := make(map[string]bool)

	// If explicit repository names provided (e.g. from ProjectRegistry)
	if len(repoNames) > 0 {
		nameMap := make(map[string]bool)
		for _, n := range repoNames {
			nameMap[strings.ToLower(n)] = true
			nameMap[strings.ToLower(DeriveCbmSlug(n))] = true
		}
		for _, item := range cached {
			nLower := strings.ToLower(item.Name)
			pLower := strings.ToLower(item.ProjectID)
			if (nameMap[nLower] || nameMap[pLower]) && !seen[item.DBPath] {
				matched = append(matched, item)
				seen[item.DBPath] = true
			}
		}
		if len(matched) > 0 {
			return matched
		}
	}

	// Filter by project keyword if provided
	if repoOrProject != "" && repoOrProject != "all" {
		target := strings.ToLower(repoOrProject)
		for _, item := range cached {
			nLower := strings.ToLower(item.Name)
			pLower := strings.ToLower(item.ProjectID)
			if (strings.Contains(nLower, target) || strings.Contains(target, nLower) ||
				strings.Contains(pLower, target) || strings.Contains(target, pLower)) && !seen[item.DBPath] {
				matched = append(matched, item)
				seen[item.DBPath] = true
			}
		}
		if len(matched) > 0 {
			return matched
		}
	}

	// Return all cached graphs (capped at 16 to prevent browser overload)
	for _, item := range cached {
		if !seen[item.DBPath] {
			matched = append(matched, item)
			seen[item.DBPath] = true
			if len(matched) >= 16 {
				break
			}
		}
	}
	return matched
}

// QueryMultiGraphData queries multiple codebase-memory SQLite databases and merges nodes and links.
func QueryMultiGraphData(items []CbmCacheItem, totalLimit int, labels []string, edgeTypes []string, query string) (*GraphPayload, error) {
	if len(items) == 0 {
		return nil, fmt.Errorf("no database items provided")
	}

	if totalLimit <= 0 {
		totalLimit = 400
	}

	perDbLimit := totalLimit / len(items)
	if perDbLimit < 35 {
		perDbLimit = 35
	}

	var allNodes []GraphNode
	var allLinks []GraphEdge
	var totalNodesCount, totalEdgesCount int

	labelSet := make(map[string]bool)
	typeSet := make(map[string]bool)

	for idx, item := range items {
		payload, err := QueryGraphData(item.DBPath, perDbLimit, labels, edgeTypes, query)
		if err != nil {
			continue
		}

		totalNodesCount += payload.TotalNodes
		totalEdgesCount += payload.TotalEdges

		for _, l := range payload.AvailableLabels {
			labelSet[l] = true
		}
		for _, t := range payload.AvailableTypes {
			typeSet[t] = true
		}

		// Offset IDs to avoid collision across different databases
		idBase := (idx + 1) * 100000

		for _, node := range payload.Nodes {
			node.ID = idBase + node.ID
			if node.Project == "" {
				node.Project = item.Name
			}
			allNodes = append(allNodes, node)
		}

		for _, link := range payload.Links {
			link.ID = idBase + link.ID
			link.Source = idBase + link.Source
			link.Target = idBase + link.Target
			if link.Project == "" {
				link.Project = item.Name
			}
			allLinks = append(allLinks, link)
		}
	}

	var availableLabels []string
	for l := range labelSet {
		availableLabels = append(availableLabels, l)
	}
	sort.Strings(availableLabels)

	var availableTypes []string
	for t := range typeSet {
		availableTypes = append(availableTypes, t)
	}
	sort.Strings(availableTypes)

	projectName := "All Global Graphs"
	if len(items) == 1 {
		projectName = items[0].Name
	}

	return &GraphPayload{
		Project:         projectName,
		Scope:           "ast",
		TotalNodes:      totalNodesCount,
		TotalEdges:      totalEdgesCount,
		ReturnedNodes:   len(allNodes),
		ReturnedEdges:   len(allLinks),
		AvailableLabels: availableLabels,
		AvailableTypes:  availableTypes,
		Nodes:           allNodes,
		Links:           allLinks,
	}, nil
}

// QueryGraphData queries a codebase-memory SQLite database and returns nodes & links for 2D/3D visualization.
func QueryGraphData(dbPath string, limit int, labels []string, edgeTypes []string, query string) (*GraphPayload, error) {
	if dbPath == "" {
		return nil, fmt.Errorf("empty db path")
	}
	if limit <= 0 {
		limit = 250
	} else if limit > 1500 {
		limit = 1500
	}

	dsn := fmt.Sprintf("file:%s?mode=ro", strings.ReplaceAll(dbPath, "\\", "/"))
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, err
	}
	defer db.Close()

	// 1. Get total counts
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
				WHEN label = 'Project' THEN 0
				WHEN label IN ('Module', 'Branch', 'Folder') THEN 1
				WHEN label IN ('Class', 'Interface') THEN 2
				WHEN label IN ('Route', 'Function', 'Method') THEN 3
				ELSE 4
			END,
			length(name) ASC
		LIMIT ?`, whereClause)

	args = append(args, limit)

	rows, err := db.Query(nodeSQL, args...)
	if err != nil {
		return nil, fmt.Errorf("query nodes error: %w", err)
	}
	defer rows.Close()

	var nodes []GraphNode
	nodeSet := make(map[int]bool)
	var projectName string

	for rows.Next() {
		var n GraphNode
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
	var links []GraphEdge
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
				var e GraphEdge
				var propStr string
				if err := edgeRows.Scan(&e.ID, &e.Project, &e.Source, &e.Target, &e.Type, &propStr); err != nil {
					continue
				}
				// Only keep edges where both endpoints are in our node set
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

	return &GraphPayload{
		Project:         projectName,
		Scope:           "ast",
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

// BuildTopologyGraph converts ProjectStatusReport repos & relationships into a GraphPayload.
func BuildTopologyGraph(report *ProjectStatusReport) *GraphPayload {
	if report == nil {
		return &GraphPayload{
			Scope: "topology",
			Nodes: []GraphNode{},
			Links: []GraphEdge{},
		}
	}

	var nodes []GraphNode
	nameToID := make(map[string]int)

	for i, repo := range report.Repos {
		nodeID := i + 1
		nameToID[repo.Name] = nodeID

		label := "Service"
		val := 10.0
		nameLower := strings.ToLower(repo.Name)
		if strings.Contains(nameLower, "gateway") || strings.Contains(nameLower, "front") {
			label = "Gateway"
			val = 13.0
		}

		props := map[string]any{
			"is_indexed": repo.IsIndexed,
			"local_path": repo.LocalPath,
		}
		if repo.Port != nil {
			props["port"] = *repo.Port
		}
		if repo.TechStack != nil {
			props["tech_stack"] = repo.TechStack
		}
		if repo.IndexNodes != nil {
			props["index_nodes"] = *repo.IndexNodes
		}
		if repo.IndexEdges != nil {
			props["index_edges"] = *repo.IndexEdges
		}

		nodes = append(nodes, GraphNode{
			ID:            nodeID,
			Project:       report.ProjectID,
			Label:         label,
			Name:          repo.Name,
			QualifiedName: repo.Name,
			FilePath:      repo.LocalPath,
			Properties:    props,
			Val:           val,
		})
	}

	var links []GraphEdge
	edgeID := 1
	typeSet := make(map[string]bool)

	for _, rel := range report.Relationships {
		srcID, okSrc := nameToID[rel.Source]
		dstID, okDst := nameToID[rel.Target]
		if okSrc && okDst {
			relType := rel.Type
			if relType == "" {
				relType = "API_CALL"
			}
			typeSet[relType] = true

			props := map[string]any{
				"description": rel.Description,
			}
			if rel.Metadata != nil {
				for k, v := range rel.Metadata {
					props[k] = v
				}
			}
			links = append(links, GraphEdge{
				ID:         edgeID,
				Project:    report.ProjectID,
				Source:     srcID,
				Target:     dstID,
				Type:       relType,
				Properties: props,
			})
			edgeID++
		}
	}

	var availableTypes []string
	for t := range typeSet {
		availableTypes = append(availableTypes, t)
	}
	if len(availableTypes) == 0 {
		availableTypes = []string{"GATEWAY_ROUTE", "API_CALL", "SERVICE_REGISTRY"}
	}

	return &GraphPayload{
		Project:         report.ProjectID,
		Scope:           "topology",
		TotalNodes:      len(nodes),
		TotalEdges:      len(links),
		ReturnedNodes:   len(nodes),
		ReturnedEdges:   len(links),
		AvailableLabels: []string{"Service", "Gateway"},
		AvailableTypes:  availableTypes,
		Nodes:           nodes,
		Links:           links,
	}
}

