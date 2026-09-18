package website

import "embed"

//go:generate npm run build

// FS holds the embedded Next.js dashboard production assets.
//
//go:embed all:out
var FS embed.FS
