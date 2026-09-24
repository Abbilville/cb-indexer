package cpg

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	_ "modernc.org/sqlite"
)

// NodeWeight calculates visual radius/importance for a CPG node label.
func NodeWeight(label string) float64 {
	switch strings.ToLower(label) {
	case "project":
		return 3.5
	case "file":
		return 2.5
	case "class", "typedecl":
		return 2.2
	case "method", "function":
		return 1.8
	case "call":
		return 1.3
	case "variable":
		return 1.1
	case "param":
		return 1.0
	case "import":
		return 1.2
	default:
		return 1.0
	}
}

// GetCPGCacheDir returns the directory where CPG SQLite databases are stored.
func GetCPGCacheDir() string {
	if custom := os.Getenv("CB_INDEXER_CPG_CACHE_DIR"); custom != "" {
		_ = os.MkdirAll(custom, 0755)
		return filepath.Clean(custom)
	}

	var dir string
	if runtime.GOOS == "windows" {
		if localApp := os.Getenv("LOCALAPPDATA"); localApp != "" {
			dir = filepath.Join(localApp, "cb-indexer", "cpg")
		}
	}
	if dir == "" {
		home, err := os.UserHomeDir()
		if err == nil {
			dir = filepath.Join(home, ".cache", "cb-indexer", "cpg")
		} else {
			dir = filepath.Join(".", ".cache", "cb-indexer", "cpg")
		}
	}

	_ = os.MkdirAll(dir, 0755)
	return filepath.Clean(dir)
}

// GetCPGDBPath returns the full SQLite database path for a given project/repo.
func GetCPGDBPath(projectName string) string {
	cleanName := strings.TrimSpace(projectName)
	cleanName = strings.ReplaceAll(cleanName, "/", "-")
	cleanName = strings.ReplaceAll(cleanName, "\\", "-")
	if !strings.HasSuffix(cleanName, ".db") {
		cleanName += ".db"
	}
	return filepath.Join(GetCPGCacheDir(), cleanName)
}

// InitCPGDatabase creates tables and indexes for CPG storage.
func InitCPGDatabase(db *sql.DB) error {
	schema := `
	CREATE TABLE IF NOT EXISTS projects (
		name TEXT PRIMARY KEY,
		root_path TEXT NOT NULL,
		indexed_at TEXT NOT NULL,
		cpg_version TEXT DEFAULT '',
		node_count INTEGER DEFAULT 0,
		edge_count INTEGER DEFAULT 0
	);

	CREATE TABLE IF NOT EXISTS file_hashes (
		file_path TEXT PRIMARY KEY,
		hash TEXT NOT NULL,
		updated_at TEXT NOT NULL
	);

	CREATE TABLE IF NOT EXISTS nodes (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		project TEXT NOT NULL,
		label TEXT NOT NULL,
		name TEXT NOT NULL,
		qualified_name TEXT NOT NULL,
		file_path TEXT DEFAULT '',
		start_line INTEGER DEFAULT 0,
		end_line INTEGER DEFAULT 0,
		properties TEXT DEFAULT '{}',
		UNIQUE(project, qualified_name)
	);

	CREATE TABLE IF NOT EXISTS edges (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		project TEXT NOT NULL,
		source_id INTEGER NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
		target_id INTEGER NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
		type TEXT NOT NULL,
		properties TEXT DEFAULT '{}',
		UNIQUE(project, source_id, target_id, type)
	);

	CREATE INDEX IF NOT EXISTS idx_cpg_nodes_proj_label ON nodes(project, label);
	CREATE INDEX IF NOT EXISTS idx_cpg_nodes_file ON nodes(file_path);
	CREATE INDEX IF NOT EXISTS idx_cpg_nodes_name ON nodes(name);
	CREATE INDEX IF NOT EXISTS idx_cpg_nodes_qname ON nodes(qualified_name);
	CREATE INDEX IF NOT EXISTS idx_cpg_edges_source ON edges(source_id);
	CREATE INDEX IF NOT EXISTS idx_cpg_edges_target ON edges(target_id);
	CREATE INDEX IF NOT EXISTS idx_cpg_edges_type ON edges(type);
	CREATE INDEX IF NOT EXISTS idx_cpg_edges_project ON edges(project);
	`
	_, err := db.Exec(schema)
	return err
}

// OpenCPGDB opens a connection to a CPG SQLite database.
func OpenCPGDB(dbPath string, readOnly bool) (*sql.DB, error) {
	if dbPath == "" {
		return nil, fmt.Errorf("empty database path")
	}
	normPath := strings.ReplaceAll(dbPath, "\\", "/")
	mode := "rwc"
	if readOnly {
		mode = "ro"
	}
	dsn := fmt.Sprintf("file:%s?mode=%s&_journal_mode=WAL&_busy_timeout=10000", normPath, mode)
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, err
	}
	if !readOnly {
		if err := InitCPGDatabase(db); err != nil {
			db.Close()
			return nil, fmt.Errorf("failed to init cpg schema: %w", err)
		}
	}
	return db, nil
}

// SaveCPG persists extracted nodes and edges into SQLite cache.
func SaveCPG(ctx context.Context, dbPath string, meta CPGProjectMeta, nodes []CPGNode, edges []CPGEdge, fileHashes map[string]string) (int, int, error) {
	dir := filepath.Dir(dbPath)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return 0, 0, fmt.Errorf("failed to create db directory: %w", err)
	}

	db, err := OpenCPGDB(dbPath, false)
	if err != nil {
		return 0, 0, fmt.Errorf("failed to open cpg db: %w", err)
	}
	defer db.Close()

	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return 0, 0, fmt.Errorf("failed to begin tx: %w", err)
	}
	defer tx.Rollback()

	// 1. Clear previous nodes and edges for this project
	if _, err := tx.ExecContext(ctx, "DELETE FROM edges WHERE project = ?", meta.Name); err != nil {
		return 0, 0, fmt.Errorf("failed to clear old edges: %w", err)
	}
	if _, err := tx.ExecContext(ctx, "DELETE FROM nodes WHERE project = ?", meta.Name); err != nil {
		return 0, 0, fmt.Errorf("failed to clear old nodes: %w", err)
	}

	// 2. Insert nodes
	nodeStmt, err := tx.PrepareContext(ctx, `
		INSERT INTO nodes (project, label, name, qualified_name, file_path, start_line, end_line, properties)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(project, qualified_name) DO UPDATE SET
			label = excluded.label,
			name = excluded.name,
			file_path = excluded.file_path,
			start_line = excluded.start_line,
			end_line = excluded.end_line,
			properties = excluded.properties
		RETURNING id
	`)
	if err != nil {
		return 0, 0, fmt.Errorf("failed to prepare node stmt: %w", err)
	}
	defer nodeStmt.Close()

	// Map raw / extracted node ID to inserted SQLite node ID
	rawToSqliteID := make(map[int64]int64, len(nodes))
	qNameToSqliteID := make(map[string]int64, len(nodes))

	insertedNodes := 0
	for _, n := range nodes {
		propBytes, _ := json.Marshal(n.Properties)
		var insertedID int64
		err := nodeStmt.QueryRowContext(ctx,
			meta.Name,
			n.Label,
			n.Name,
			n.QualifiedName,
			n.FilePath,
			n.StartLine,
			n.EndLine,
			string(propBytes),
		).Scan(&insertedID)
		if err != nil {
			continue
		}
		rawToSqliteID[n.ID] = insertedID
		qNameToSqliteID[n.QualifiedName] = insertedID
		insertedNodes++
	}

	// 3. Insert edges
	edgeStmt, err := tx.PrepareContext(ctx, `
		INSERT INTO edges (project, source_id, target_id, type, properties)
		VALUES (?, ?, ?, ?, ?)
		ON CONFLICT(project, source_id, target_id, type) DO UPDATE SET
			properties = excluded.properties
	`)
	if err != nil {
		return 0, 0, fmt.Errorf("failed to prepare edge stmt: %w", err)
	}
	defer edgeStmt.Close()

	insertedEdges := 0
	for _, e := range edges {
		srcID, okSrc := rawToSqliteID[e.SourceID]
		tgtID, okTgt := rawToSqliteID[e.TargetID]
		if !okSrc || !okTgt || srcID == 0 || tgtID == 0 {
			continue
		}
		propBytes, _ := json.Marshal(e.Properties)
		_, err := edgeStmt.ExecContext(ctx,
			meta.Name,
			srcID,
			tgtID,
			e.Type,
			string(propBytes),
		)
		if err == nil {
			insertedEdges++
		}
	}

	// 4. Update project metadata using exact counts in database
	_ = tx.QueryRowContext(ctx, "SELECT COUNT(*) FROM nodes WHERE project = ?", meta.Name).Scan(&insertedNodes)
	_ = tx.QueryRowContext(ctx, "SELECT COUNT(*) FROM edges WHERE project = ?", meta.Name).Scan(&insertedEdges)
	meta.NodeCount = insertedNodes
	meta.EdgeCount = insertedEdges
	if meta.IndexedAt.IsZero() {
		meta.IndexedAt = time.Now()
	}

	projStmt := `
		INSERT INTO projects (name, root_path, indexed_at, cpg_version, node_count, edge_count)
		VALUES (?, ?, ?, ?, ?, ?)
		ON CONFLICT(name) DO UPDATE SET
			root_path = excluded.root_path,
			indexed_at = excluded.indexed_at,
			cpg_version = excluded.cpg_version,
			node_count = excluded.node_count,
			edge_count = excluded.edge_count
	`
	if _, err := tx.ExecContext(ctx, projStmt,
		meta.Name,
		meta.RootPath,
		meta.IndexedAt.Format(time.RFC3339),
		meta.CPGVersion,
		meta.NodeCount,
		meta.EdgeCount,
	); err != nil {
		return 0, 0, fmt.Errorf("failed to save project metadata: %w", err)
	}

	// 5. Update file hashes
	if len(fileHashes) > 0 {
		hashStmt, err := tx.PrepareContext(ctx, `
			INSERT INTO file_hashes (file_path, hash, updated_at)
			VALUES (?, ?, ?)
			ON CONFLICT(file_path) DO UPDATE SET
				hash = excluded.hash,
				updated_at = excluded.updated_at
		`)
		if err == nil {
			defer hashStmt.Close()
			nowStr := time.Now().Format(time.RFC3339)
			for fp, h := range fileHashes {
				_, _ = hashStmt.ExecContext(ctx, fp, h, nowStr)
			}
		}
	}

	if err := tx.Commit(); err != nil {
		return 0, 0, err
	}
	return insertedNodes, insertedEdges, nil
}
// FindCPGDB locates the CPG SQLite database path for a given project or repo name.
func FindCPGDB(repoOrProject string) (string, error) {
	if repoOrProject == "" {
		return "", fmt.Errorf("empty project name")
	}

	cacheDir := GetCPGCacheDir()
	candidate := filepath.Join(cacheDir, repoOrProject+".db")
	if info, err := os.Stat(candidate); err == nil && !info.IsDir() {
		return candidate, nil
	}

	// Check if already full path or matches slug
	slug := strings.ReplaceAll(repoOrProject, "/", "-")
	slug = strings.ReplaceAll(slug, "\\", "-")
	candidateSlug := filepath.Join(cacheDir, slug+".db")
	if info, err := os.Stat(candidateSlug); err == nil && !info.IsDir() {
		return candidateSlug, nil
	}

	// Check case-insensitive
	entries, err := os.ReadDir(cacheDir)
	if err == nil {
		for _, e := range entries {
			if !e.IsDir() && strings.HasSuffix(e.Name(), ".db") {
				nameWithoutExt := strings.TrimSuffix(e.Name(), ".db")
				if strings.EqualFold(nameWithoutExt, repoOrProject) || strings.EqualFold(nameWithoutExt, slug) {
					return filepath.Join(cacheDir, e.Name()), nil
				}
			}
		}
	}

	return "", fmt.Errorf("cpg database not found for '%s'", repoOrProject)
}

// ScanGlobalCPGCache lists all indexed CPG databases in the cache directory.
func ScanGlobalCPGCache() []CPGCacheItem {
	var results []CPGCacheItem
	cacheDir := GetCPGCacheDir()
	entries, err := os.ReadDir(cacheDir)
	if err != nil {
		return results
	}

	for _, entry := range entries {
		if !entry.IsDir() && strings.HasSuffix(entry.Name(), ".db") && !strings.HasPrefix(entry.Name(), "_") {
			dbPath := filepath.Join(cacheDir, entry.Name())
			projectName := strings.TrimSuffix(entry.Name(), ".db")
			info, err := entry.Info()
			if err != nil {
				continue
			}

			nodes, edges, err := QueryCPGStats(dbPath)
			var nodesPtr *int
			var edgesPtr *int
			if err == nil {
				nodesPtr = &nodes
				edgesPtr = &edges
			}

			results = append(results, CPGCacheItem{
				Name:         projectName,
				ProjectID:    projectName,
				DBPath:       strings.ReplaceAll(dbPath, "\\", "/"),
				SizeBytes:    info.Size(),
				LastModified: info.ModTime(),
				IsIndexed:    true,
				Nodes:        nodesPtr,
				Edges:        edgesPtr,
				Source:       "cpg_cache",
			})
		}
	}
	return results
}

// FindAllCPGDBs locates CPG database paths matching a project or repo list.
func FindAllCPGDBs(projectID string, repoNames []string) []CPGCacheItem {
	all := ScanGlobalCPGCache()
	if len(repoNames) == 0 && projectID == "" {
		return all
	}

	repoSet := make(map[string]bool, len(repoNames))
	for _, r := range repoNames {
		repoSet[strings.ToLower(r)] = true
	}

	var matched []CPGCacheItem
	for _, item := range all {
		lowName := strings.ToLower(item.Name)
		if repoSet[lowName] || strings.EqualFold(item.ProjectID, projectID) {
			matched = append(matched, item)
		}
	}
	return matched
}

// QueryCPGStats returns total node and edge counts from a CPG SQLite database.
func QueryCPGStats(dbPath string) (nodes int, edges int, err error) {
	if dbPath == "" {
		return 0, 0, fmt.Errorf("empty db path")
	}

	db, err := OpenCPGDB(dbPath, true)
	if err != nil {
		return 0, 0, err
	}
	defer db.Close()

	_ = db.QueryRow("SELECT COUNT(*) FROM nodes").Scan(&nodes)
	_ = db.QueryRow("SELECT COUNT(*) FROM edges").Scan(&edges)
	return nodes, edges, nil
}

// DeleteCPGDatabase removes the SQLite file and write-ahead logs for a project.
func DeleteCPGDatabase(projectName string) error {
	dbPath, err := FindCPGDB(projectName)
	if err != nil {
		return nil // already gone
	}
	_ = os.Remove(dbPath)
	_ = os.Remove(dbPath + "-wal")
	_ = os.Remove(dbPath + "-shm")
	return nil
}
