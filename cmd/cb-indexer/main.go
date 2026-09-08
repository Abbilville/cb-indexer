package main

import (
	"context"
	"flag"
	"fmt"
	"os"
	"os/signal"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"time"

	"cb-indexer/internal/cbmwrite"
	"cb-indexer/internal/gitwatcher"
	"cb-indexer/internal/graphmeta"
	"cb-indexer/internal/mcpserver"
	"cb-indexer/internal/registry"
	"cb-indexer/internal/scanner"
	"cb-indexer/internal/workflows"
)

// loadDotEnv parses key-value pairs from a local .env file into the process environment
// if the variable is not already defined in the OS environment.

func getAuthTokenEnv() string {
	if t := os.Getenv("CB_INDEXER_AUTH_TOKEN"); t != "" {
		return t
	}
	return os.Getenv("OSS_INDEXER_AUTH_TOKEN")
}

func loadDotEnv() {
	candidates := []string{".env"}
	if exe, err := os.Executable(); err == nil {
		candidates = append(candidates, filepath.Join(filepath.Dir(exe), ".env"))
	}

	for _, path := range candidates {
		data, err := os.ReadFile(path)
		if err != nil {
			continue
		}
		for _, rawLine := range strings.Split(string(data), "\n") {
			line := strings.TrimSpace(rawLine)
			if line == "" || strings.HasPrefix(line, "#") {
				continue
			}
			parts := strings.SplitN(line, "=", 2)
			if len(parts) == 2 {
				key := strings.TrimSpace(parts[0])
				val := strings.TrimSpace(parts[1])
				// Strip surrounding single or double quotes
				if len(val) >= 2 && ((val[0] == '"' && val[len(val)-1] == '"') || (val[0] == '\'' && val[len(val)-1] == '\'')) {
					val = val[1 : len(val)-1]
				}
				if os.Getenv(key) == "" {
					_ = os.Setenv(key, val)
				}
			}
		}
		return
	}
}

func printHelp() {
	fmt.Println(`cb-indexer — Repository Architecture Hub & Ingestion Daemon

Usage:
  cb-indexer [command] [options]

Commands:
  daemon      Start background indexing daemon & HTTP MCP server
  scan        Scan workspace directory and generate registry.yaml
  index       Batch index repositories into codebase-memory-mcp
  onboard     Atomic scan + registry write + batch index
  remove      Decommission project and purge knowledge graphs
  status      Show indexing status, daemon health, and logs
  run         Run MCP server (HTTP or stdio)

Run 'cb-indexer [command] -h' for more details on each command.`)
}

func main() {
	loadDotEnv()

	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()

	if len(os.Args) < 2 {
		// Default to running MCP HTTP server
		srv := mcpserver.NewServer()
		port := 43770
		if pEnv := os.Getenv("PORT"); pEnv != "" {
			if p, err := strconv.Atoi(pEnv); err == nil {
				port = p
			}
		}
		authToken := getAuthTokenEnv()
		if err := mcpserver.ServeHTTP(ctx, srv, port, authToken); err != nil {
			fmt.Fprintf(os.Stderr, "Server error: %v\n", err)
			os.Exit(1)
		}
		return
	}

	command := os.Args[1]

	switch command {
	case "daemon":
		defaultPort := 43770
		if pEnv := os.Getenv("PORT"); pEnv != "" {
			if p, err := strconv.Atoi(pEnv); err == nil {
				defaultPort = p
			}
		}
		fs := flag.NewFlagSet("daemon", flag.ExitOnError)
		port := fs.Int("port", defaultPort, "HTTP MCP server port")
		intervalStr := fs.String("interval", "15m", "Polling interval (e.g. 15m, 1h)")
		pull := fs.Bool("pull", true, "Automatically git pull before indexing")
		project := fs.String("project", "", "Target project ID from catalog")
		regPath := fs.String("registry", "", "Path to custom registry.yaml")
		mode := fs.String("mode", "moderate", "Indexing mode: moderate, full, fast")
		authToken := fs.String("auth-token", getAuthTokenEnv(), "Secret token for HTTP auth")
		fs.Parse(os.Args[2:])

		interval, err := time.ParseDuration(*intervalStr)
		if err != nil {
			interval = 15 * time.Minute
		}

		target := *regPath
		if target == "" {
			target = *project
		}

		srv := mcpserver.NewServer()
		go func() {
			if err := mcpserver.ServeHTTP(ctx, srv, *port, *authToken); err != nil {
				fmt.Fprintf(os.Stderr, "[ERROR] HTTP server: %v\n", err)
			}
		}()

		fmt.Printf("[cb-indexer] Daemon started (interval: %v, auto-pull: %v, mode: %s)\n", interval, *pull, *mode)
		if err := gitwatcher.RunDaemon(ctx, interval, *pull, target, *mode); err != nil && err != context.Canceled {
			fmt.Fprintf(os.Stderr, "[ERROR] Daemon loop: %v\n", err)
			os.Exit(1)
		}

	case "scan":
		fs := flag.NewFlagSet("scan", flag.ExitOnError)
		output := fs.String("o", "", "Path to output registry.yaml")
		projectID := fs.String("p", "", "Custom project ID")
		fs.Parse(os.Args[2:])

		targetPath := "."
		if fs.NArg() > 0 {
			targetPath = fs.Arg(0)
		}

		reg, err := scanner.ScanWorkspace(targetPath, *projectID)
		if err != nil {
			fmt.Fprintf(os.Stderr, "[ERROR] Scan failed: %v\n", err)
			os.Exit(1)
		}

		outPath := *output
		if outPath == "" {
			outPath = filepath.Join(targetPath, "registry.yaml")
		}
		saved, err := registry.SaveRegistry(reg, outPath)
		if err != nil {
			fmt.Fprintf(os.Stderr, "[ERROR] Failed to save registry: %v\n", err)
			os.Exit(1)
		}

		fmt.Printf("[INFO] Discovered %d repositories, %d relationships.\n", len(reg.Repos), len(reg.Relationships))
		for _, r := range reg.Repos {
			portStr := ""
			if r.Port != nil {
				portStr = fmt.Sprintf(" (port %d)", *r.Port)
			}
			fmt.Printf("  * %s%s [%s]\n", r.Name, portStr, filepath.Clean(r.LocalPath))
		}
		fmt.Printf("[INFO] Saved registry to: %s\n", saved)

	case "index":
		fs := flag.NewFlagSet("index", flag.ExitOnError)
		regPath := fs.String("r", "", "Path to custom registry.yaml")
		project := fs.String("p", "", "Project ID from catalog")
		mode := fs.String("m", "moderate", "Indexing mode: moderate, full, fast")
		pull := fs.Bool("pull", false, "Git pull repos before indexing")
		persistence := fs.Bool("persistence", false, "Write .codebase-memory/ artifacts in repos")
		fs.Parse(os.Args[2:])

		target := *regPath
		if target == "" {
			target = *project
		}

		reg, err := registry.LoadRegistry(target)
		if err != nil {
			fmt.Fprintf(os.Stderr, "[ERROR] %v\n", err)
			os.Exit(1)
		}

		if *pull {
			fmt.Println("[INFO] Pulling updates for repositories...")
			for _, r := range reg.Repos {
				_, _ = gitwatcher.GitPull(ctx, r.LocalPath)
			}
		}

		fmt.Printf("[INFO] Starting batch indexing for %s (%d repos, mode: %s)...\n", reg.Name, len(reg.Repos), *mode)
		report := cbmwrite.BatchIndexProject(ctx, reg, *mode, *persistence)
		fmt.Println("\n================ INDEXING REPORT ================")
		fmt.Printf("Project:     %s (%s)\n", report.ProjectName, report.ProjectID)
		fmt.Printf("Total Repos: %d\n", report.TotalRepos)
		fmt.Printf("Successful:  %d\n", report.Successful)
		fmt.Printf("Failed:      %d\n", report.Failed)
		fmt.Println("-------------------------------------------------")
		for _, r := range report.Results {
			icon := "✓"
			if r.Status != "success" {
				icon = "✗"
			}
			fmt.Printf(" %s %-25s [%s]\n", icon, r.Name, r.Status)
			if r.Error != "" {
				fmt.Printf("   Error: %s\n", r.Error)
			}
		}
		fmt.Println("=================================================")

	case "onboard":
		fs := flag.NewFlagSet("onboard", flag.ExitOnError)
		projectID := fs.String("p", "", "Custom project ID")
		mode := fs.String("m", "moderate", "Indexing mode: moderate, full, fast")
		output := fs.String("o", "", "Output registry.yaml path")
		fs.Parse(os.Args[2:])

		targetDir := "."
		if fs.NArg() > 0 {
			targetDir = fs.Arg(0)
		}

		fmt.Printf("[INFO] Onboarding workspace: %s\n", targetDir)
		report, err := workflows.OnboardWorkspace(ctx, targetDir, *projectID, *mode, *output)
		if err != nil {
			fmt.Fprintf(os.Stderr, "[ERROR] %v\n", err)
			os.Exit(1)
		}

		fmt.Printf("[INFO] %s\n", report.Message)
		fmt.Printf("Registry: %s\n", report.RegistryPath)
		fmt.Printf("Indexed:  %d/%d repositories\n", report.IndexingReport.Successful, report.IndexingReport.TotalRepos)

	case "remove":
		fs := flag.NewFlagSet("remove", flag.ExitOnError)
		purgeGraphs := fs.Bool("purge-graphs", true, "Purge CBM graph databases")
		keepManifest := fs.Bool("keep-manifest", false, "Keep registry.yaml manifest")
		fs.Parse(os.Args[2:])

		if fs.NArg() == 0 {
			fmt.Println("Usage: cb-indexer remove <project_id_or_registry_path>")
			os.Exit(1)
		}
		target := fs.Arg(0)

		reg, _ := registry.LoadRegistry(target)
		pID := target
		if reg != nil {
			pID = reg.ProjectID
		}

		if *purgeGraphs {
			fmt.Printf("[INFO] Purging knowledge graphs for: %s...\n", pID)
			if reg != nil {
				pReport := cbmwrite.PurgeProjectGraphs(ctx, reg)
				fmt.Printf("[INFO] Purged %d/%d graphs.\n", pReport.Purged, pReport.TotalRepos)
			} else {
				res := cbmwrite.DeleteIndexedGraph(ctx, pID)
				fmt.Printf("[INFO] Purge result: %s\n", res.Status)
			}
		}

		if registry.UnregisterProjectFromCatalog(pID) {
			fmt.Printf("[INFO] Unregistered '%s' from projects catalog.\n", pID)
		}

		if !*keepManifest && reg != nil && reg.SourcePath != "" {
			_ = os.Remove(reg.SourcePath)
			fmt.Printf("[INFO] Deleted manifest: %s\n", reg.SourcePath)
		}
		fmt.Printf("[INFO] Project '%s' removed.\n", pID)

	case "status":
		report := gitwatcher.CheckIndexStatus("")
		fmt.Printf("\n=== cb-indexer Operational Status ===\n")
		fmt.Printf("Active Projects: %d\n", report.ActiveProjects)
		if report.LastRun != nil {
			fmt.Printf("Last Run:        %s\n", report.LastRun.Format(time.RFC3339))
		}
		fmt.Printf("\nRecent Run Logs (%d):\n", len(report.RecentLogs))
		for _, l := range report.RecentLogs {
			fmt.Printf("  * [%s] Project: %s (Duration: %dms, Indexed: %d, Errors: %d)\n",
				l.Timestamp.Format("15:04:05"), l.ProjectID, l.DurationMs, len(l.Indexed), len(l.Errors))
		}

		// Show registered project statuses
		available := registry.ListAvailableProjects()
		fmt.Printf("\n=== Registered Project Indexes (%d) ===\n", len(available))
		for _, p := range available {
			if p.RegistryPath != "" {
				if reg, err := registry.LoadRegistry(p.RegistryPath); err == nil {
					pStatus := graphmeta.CheckProjectStatus(reg)
					fmt.Printf("  * %-20s - %d/%d repos indexed [%s]\n", pStatus.ProjectName, pStatus.IndexedRepos, pStatus.TotalRepos, p.RegistryPath)
				}
			}
		}
		fmt.Println()

	case "run":
		defaultPort := 43770
		if pEnv := os.Getenv("PORT"); pEnv != "" {
			if p, err := strconv.Atoi(pEnv); err == nil {
				defaultPort = p
			}
		}
		fs := flag.NewFlagSet("run", flag.ExitOnError)
		port := fs.Int("port", defaultPort, "HTTP port")
		useStdio := fs.Bool("stdio", false, "Use Stdio transport instead of HTTP")
		authToken := fs.String("auth-token", getAuthTokenEnv(), "Secret token for HTTP auth")
		fs.Parse(os.Args[2:])

		srv := mcpserver.NewServer()
		if *useStdio {
			if err := mcpserver.ServeStdio(ctx, srv); err != nil {
				fmt.Fprintf(os.Stderr, "Stdio server error: %v\n", err)
				os.Exit(1)
			}
		} else {
			if err := mcpserver.ServeHTTP(ctx, srv, *port, *authToken); err != nil {
				fmt.Fprintf(os.Stderr, "HTTP server error: %v\n", err)
				os.Exit(1)
			}
		}

	case "help", "-h", "--help":
		printHelp()

	default:
		fmt.Fprintf(os.Stderr, "Unknown command '%s'\n\n", command)
		printHelp()
		os.Exit(1)
	}
}
