package graphmeta

import (
	"bufio"
	"database/sql"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
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
