package cpg

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"strings"
)

type astNodeSummary struct {
	ID        int
	Label     string
	Name      string
	FilePath  string
	StartLine int
}

// CorrelateCPGDatabase matches CPG nodes against AST nodes in the corresponding CBM SQLite database.
// It annotates CPG nodes with `ast_node_id` and `ast_correlated` metadata.
func CorrelateCPGDatabase(cpgDbPath string, astDbPath string) (int, error) {
	if cpgDbPath == "" || astDbPath == "" {
		return 0, fmt.Errorf("cpg and ast db paths must be provided")
	}

	astDB, err := sql.Open("sqlite", fmt.Sprintf("file:%s?mode=ro", strings.ReplaceAll(astDbPath, "\\", "/")))
	if err != nil {
		return 0, fmt.Errorf("failed to open ast db: %w", err)
	}
	defer astDB.Close()

	// Load AST nodes for matching
	rows, err := astDB.Query("SELECT id, label, name, file_path, start_line FROM nodes WHERE label NOT IN ('Branch', 'Project', 'Folder')")
	if err != nil {
		return 0, fmt.Errorf("failed to query ast nodes: %w", err)
	}
	defer rows.Close()

	exactMap := make(map[string]astNodeSummary) // key: file:name:line
	fileSymbolMap := make(map[string]astNodeSummary) // key: file:name

	for rows.Next() {
		var n astNodeSummary
		if err := rows.Scan(&n.ID, &n.Label, &n.Name, &n.FilePath, &n.StartLine); err == nil {
			exactKey := fmt.Sprintf("%s:%s:%d", strings.ToLower(n.FilePath), strings.ToLower(n.Name), n.StartLine)
			exactMap[exactKey] = n

			fuzzyKey := fmt.Sprintf("%s:%s", strings.ToLower(n.FilePath), strings.ToLower(n.Name))
			if _, exists := fileSymbolMap[fuzzyKey]; !exists {
				fileSymbolMap[fuzzyKey] = n
			}
		}
	}

	cpgDB, err := OpenCPGDB(cpgDbPath, false)
	if err != nil {
		return 0, fmt.Errorf("failed to open cpg db: %w", err)
	}
	defer cpgDB.Close()

	cpgRows, err := cpgDB.Query("SELECT id, name, file_path, start_line, properties FROM nodes")
	if err != nil {
		return 0, fmt.Errorf("failed to query cpg nodes: %w", err)
	}
	defer cpgRows.Close()

	type updateItem struct {
		id    int64
		props map[string]any
	}
	var updates []updateItem
	matchedCount := 0

	for cpgRows.Next() {
		var id int64
		var name, filePath, propStr string
		var startLine int
		if err := cpgRows.Scan(&id, &name, &filePath, &startLine, &propStr); err != nil {
			continue
		}

		var props map[string]any
		if propStr != "" && propStr != "{}" {
			_ = json.Unmarshal([]byte(propStr), &props)
		}
		if props == nil {
			props = make(map[string]any)
		}
		exactKey := fmt.Sprintf("%s:%s:%d", strings.ToLower(filePath), strings.ToLower(name), startLine)
		fuzzyKey := fmt.Sprintf("%s:%s", strings.ToLower(filePath), strings.ToLower(name))

		var matched *astNodeSummary
		if m, ok := exactMap[exactKey]; ok {
			matched = &m
		} else if m, ok := fileSymbolMap[fuzzyKey]; ok {
			matched = &m
		}

		if matched != nil {
			props["ast_node_id"] = matched.ID
			props["ast_label"] = matched.Label
			props["ast_correlated"] = true
			matchedCount++
		} else {
			props["ast_correlated"] = false
		}

		updates = append(updates, updateItem{id: id, props: props})
	}

	// Update CPG nodes with correlation properties
	tx, err := cpgDB.Begin()
	if err != nil {
		return 0, err
	}
	defer tx.Rollback()

	stmt, err := tx.Prepare("UPDATE nodes SET properties = ? WHERE id = ?")
	if err != nil {
		return 0, err
	}
	defer stmt.Close()

	for _, u := range updates {
		pBytes, _ := json.Marshal(u.props)
		_, _ = stmt.Exec(string(pBytes), u.id)
	}

	if err := tx.Commit(); err != nil {
		return 0, err
	}

	return matchedCount, nil
}
