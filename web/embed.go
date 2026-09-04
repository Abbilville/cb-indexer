package web

import "embed"

// FS holds the embedded dashboard assets.
//
//go:embed index.html styles.css app.js
var FS embed.FS
