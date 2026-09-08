package gitwatcher

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sync"
	"time"

	"cb-indexer/internal/registry"
)

// IndexRunLog represents a recorded indexing run in the inspectable log file.
type IndexRunLog struct {
	Timestamp   time.Time `json:"timestamp"`
	DurationMs  int64     `json:"duration_ms"`
	ProjectID   string    `json:"project_id"`
	TotalRepos  int       `json:"total_repos"`
	ReposPulled []string  `json:"repos_pulled,omitempty"`
	Indexed     []string  `json:"indexed,omitempty"`
	Errors      []string  `json:"errors,omitempty"`
	Success     bool      `json:"success"`
}

var logMutex sync.Mutex

// GetLogFilePath returns the path to the indexer log file.
func GetLogFilePath() string {
	configDir := registry.GetUserConfigDir()
	logDir := filepath.Join(configDir, "logs")
	if err := os.MkdirAll(logDir, 0755); err != nil {
		// Fallback to local .cb-indexer/
		_ = os.MkdirAll(".cb-indexer", 0755)
		return filepath.Join(".cb-indexer", "indexer.log")
	}
	return filepath.Join(logDir, "indexer.log")
}

// LogIndexRun appends a structured run record to the indexer log file.
func LogIndexRun(entry IndexRunLog) {
	logMutex.Lock()
	defer logMutex.Unlock()

	logFile := GetLogFilePath()
	f, err := os.OpenFile(logFile, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0644)
	if err != nil {
		return
	}
	defer f.Close()

	data, err := json.Marshal(entry)
	if err == nil {
		_, _ = f.Write(append(data, '\n'))
	}
}

// GetRecentLogs retrieves the last N log entries.
func GetRecentLogs(limit int) []IndexRunLog {
	logMutex.Lock()
	defer logMutex.Unlock()

	logFile := GetLogFilePath()
	data, err := os.ReadFile(logFile)
	if err != nil {
		return nil
	}

	var logs []IndexRunLog
	lines := splitLines(string(data))
	for i := len(lines) - 1; i >= 0 && len(logs) < limit; i-- {
		line := lines[i]
		if line == "" {
			continue
		}
		var entry IndexRunLog
		if err := json.Unmarshal([]byte(line), &entry); err == nil {
			logs = append(logs, entry)
		}
	}
	return logs
}

func splitLines(s string) []string {
	var lines []string
	start := 0
	for i := 0; i < len(s); i++ {
		if s[i] == '\n' {
			line := s[start:i]
			if len(line) > 0 && line[len(line)-1] == '\r' {
				line = line[:len(line)-1]
			}
			lines = append(lines, line)
			start = i + 1
		}
	}
	if start < len(s) {
		lines = append(lines, s[start:])
	}
	return lines
}
