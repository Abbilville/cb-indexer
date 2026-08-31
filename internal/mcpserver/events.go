package mcpserver

import (
	"encoding/json"
	"fmt"
	"net/http"
	"sync"
	"time"
)

// EventMessage represents a real-time event sent to browser/terminal clients.
type EventMessage struct {
	Type       string `json:"type"` // "connected", "started", "progress", "completed", "error"
	ProjectID  string `json:"project_id,omitempty"`
	RepoName   string `json:"repo_name,omitempty"`
	Message    string `json:"message,omitempty"`
	Current    int    `json:"current,omitempty"`
	Total      int    `json:"total,omitempty"`
	Status     string `json:"status,omitempty"` // "indexing", "success", "failed"
	DurationMs int64  `json:"duration_ms,omitempty"`
	Timestamp  string `json:"timestamp"`
}

// EventHub manages active Server-Sent Event (SSE) clients.
type EventHub struct {
	mu      sync.RWMutex
	clients map[chan EventMessage]bool
}

// Hub is the global singleton SSE event hub.
var Hub = &EventHub{
	clients: make(map[chan EventMessage]bool),
}

// Subscribe adds a new client channel to the hub.
func (h *EventHub) Subscribe() chan EventMessage {
	h.mu.Lock()
	defer h.mu.Unlock()
	ch := make(chan EventMessage, 64)
	h.clients[ch] = true
	return ch
}

// Unsubscribe removes a client channel from the hub.
func (h *EventHub) Unsubscribe(ch chan EventMessage) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if _, ok := h.clients[ch]; ok {
		delete(h.clients, ch)
		close(ch)
	}
}

// Broadcast sends an event to all connected SSE clients.
func Broadcast(msg EventMessage) {
	if msg.Timestamp == "" {
		msg.Timestamp = time.Now().Format(time.RFC3339)
	}
	Hub.mu.RLock()
	defer Hub.mu.RUnlock()
	for ch := range Hub.clients {
		select {
		case ch <- msg:
		default:
		}
	}
}

// HandleSSE handles incoming /api/events SSE subscriptions.
func HandleSSE(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("Access-Control-Allow-Origin", "*")

	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "Streaming unsupported", http.StatusInternalServerError)
		return
	}

	ch := Hub.Subscribe()
	defer Hub.Unsubscribe(ch)

	// Send initial connected ping
	initMsg, _ := json.Marshal(EventMessage{
		Type:      "connected",
		Message:   "Connected to real-time events",
		Timestamp: time.Now().Format(time.RFC3339),
	})
	fmt.Fprintf(w, "data: %s\n\n", initMsg)
	flusher.Flush()

	ctx := r.Context()
	for {
		select {
		case <-ctx.Done():
			return
		case msg, open := <-ch:
			if !open {
				return
			}
			data, err := json.Marshal(msg)
			if err == nil {
				fmt.Fprintf(w, "data: %s\n\n", data)
				flusher.Flush()
			}
		}
	}
}
