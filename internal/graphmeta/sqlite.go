package graphmeta

import (
	"database/sql"
	"fmt"
	"strings"

	_ "modernc.org/sqlite"
)

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
