<div align="center">

# 📦 cb-indexer

**Autonomous Microservice Topology Control Plane, Interactive Whiteboard Architecture Canvas & Real-Time AST Knowledge Graph Daemon**

[![Release](https://img.shields.io/github/v/release/Abbilville/cb-indexer?style=for-the-badge&color=2563eb&logo=github)](https://github.com/Abbilville/cb-indexer/releases)
[![Go Version](https://img.shields.io/badge/Go-%3E%3D1.25-00ADD8?style=for-the-badge&logo=go)](https://golang.org/)
[![MCP Protocol](https://img.shields.io/badge/MCP-2024--11--05-ea580c?style=for-the-badge&logo=anthropic)](https://modelcontextprotocol.io/)
[![Docker](https://img.shields.io/badge/Docker-Build%20from%20Source-2496ED?style=for-the-badge&logo=docker)](#-docker--container-deployment)
[![License](https://img.shields.io/badge/License-MIT-10b981?style=for-the-badge)](LICENSE)

<p align="center">
  <a href="#-quick-start">Quick Start</a> •
  <a href="#-connecting-ai-agents-via-mcp">MCP Setup</a> •
  <a href="#-mcp-tools-reference--ai-prompt-examples">MCP Tools</a> •
  <a href="#-web-dashboard-guide">Dashboard Guide</a> •
  <a href="#-authentication--security">Security & Auth</a> •
  <a href="#-cli-reference">CLI Reference</a> •
  <a href="#-private-repositories--git-sync">Git Sync</a> •
  <a href="#-docker--container-deployment">Docker</a>
</p>

</div>

---

<p align="center">
  <img src="docs/assets/dashboard1.png" alt="cb-indexer Dashboard & Whiteboard Architecture Map" width="100%" style="border-radius: 8px; border: 1px solid #1e293b; box-shadow: 0 8px 24px rgba(0,0,0,0.5);" />
</p>
<p align="center">
  <img src="docs/assets/dashboard2.png" alt="cb-indexer Dashboard & Whiteboard Architecture Map" width="100%" style="border-radius: 8px; border: 1px solid #1e293b; box-shadow: 0 8px 24px rgba(0,0,0,0.5);" />
</p>

---

## 🌟 What is cb-indexer?

Modern software projects often consist of multiple microservices, frontend applications, and shared libraries spread across polyrepos or monorepos.

When developers work with **AI coding assistants** (like Cursor, Claude Desktop, Antigravity IDE, or Cline), AI agents typically only see the current opened directory. They lack the high-level picture:
- *Which service communicates with which?*
- *What runtime port does the authentication service run on?*
- *Which services route through the API Gateway or register with Eureka / Consul?*
- *Are the AST code memory graphs for all microservices up to date?*

**`cb-indexer` solves this.** It runs as a lightweight, single-binary background daemon that:
1. **Deep-Scans Workspaces**: Automatically discovers all microservices, tech stacks (Go, Node.js, Python, Java Spring Boot, etc.), and assigned ports.
2. **Builds Interactive Topology Maps**: Renders an infinite-canvas whiteboard with directional routing arrows and curved non-overlapping Bezier lines.
3. **Ingests AST Graphs**: Integrates directly with [`codebase-memory-mcp`](https://github.com/DeusData/codebase-memory-mcp) to maintain Abstract Syntax Tree (AST) knowledge graphs and call hierarchies.
4. **Exposes MCP Tools**: Serves 11 standardized Model Context Protocol tools over Streamable HTTP and Stdio, empowering AI agents to query cross-service relationships, trace API hops, search AST symbols, and trigger re-indexing on demand.

---

## ⚡ Key Highlights

| Feature | Description |
| :--- | :--- |
| 🌐 **Next.js 15 TypeScript Webview** | Modern, responsive dashboard and AST explorer built with React 19, TypeScript, and Tailwind CSS, fully embedded in the single Go binary. |
| 📋 **Interactive Architecture Whiteboard** | Calm SVG service topology map with drag-and-drop cards, curved Bezier routing arrows, pan/zoom, and persistent layout coordinates. |
| 🌌 **3D Galaxy AST Explorer (`/graph/`)** | Full-page 3D WebGL knowledge graph (Three.js) rendering code entities (Classes, Functions, Routes, Files) as an interactive cosmic network with visible text sprites. |
| 🕸️ **2D Network View** | Force-directed 2D canvas with collision prevention, natural 1-hop focus glow, balanced dimming, and link relation labels. |
| 🌳 **Left-to-Right Tree Flowchart** | Expandable hierarchical tree mapping `Projects ──► Folders ──► Files ──► Classes ──► Functions` with smooth horizontal branches. |
| 📁 **Interactive Project Tree Sidebar** | Collapsible dual-tab sidebar featuring live Node & Edge type filters alongside an interactive, expandable codebase file tree. |
| 🎨 **Real-Time Visual Customization** | Dynamic live sliders for **Edge Thickness** (1px–6px), **Edge Opacity** (10%–100%), **Node Size** (0.6x–2.5x), and **Node Opacity** (20%–100%). |
| 🔎 **Symbol Search & Live Code Context** | Search AST symbols across all microservices and inspect actual source code slices directly within the dashboard. |
| 🔗 **Interactive Connection Explorer** | Node details drawer displaying navigable lists of all inbound and outbound relations with click-to-navigate focus. |
| 📊 **100% Project-Focused Metrics** | Real-time hero cards tracking `Total Services`, `Index Coverage`, `Total Nodes`, and `Service Connections`. |
| 🔍 **Native Folder Browser Dialog** | Integrated OS Explorer folder selection (`Browse...`) to effortlessly register local workspaces. |
| 🗑️ **GitHub-Style Project Deletion** | Safeguarded project removal requiring typing the exact `project_id` to confirm, with automatic AST graph cache purging. |
| 🔒 **API Token Auth & `.env` Support** | Built-in `.env` file loader, token-protected REST & MCP endpoints, with real-time status badges in the top navbar. |
| 🔄 **Git Pull & Automatic Sync** | One-click `Git Pull & Sync All` (fast-forward safe) to pull latest commits and re-index modified files into the knowledge graph. |
| ⚡ **Real-Time Live SSE Stream** | Watch background indexing jobs, warnings, and completions live on terminal stdout and the dashboard via Server-Sent Events (`/api/events`). |
| 🤖 **Standard MCP Server** | Connects seamlessly with Claude Desktop, Cursor, Antigravity IDE, Cline, and Continue via HTTP or Stdio. |
---

## 🚀 Quick Start

### 1. Prerequisites

- **Go (>= 1.25)**: To compile or run `cb-indexer`.
- **Node.js (>= 18)**: Required to use the AST memory graph engine.
- **codebase-memory-mcp**:
  ```bash
  npm install -g codebase-memory-mcp
  ```

---

### 2. Installation

#### Option A: Global Go Install (Recommended)
```bash
go install github.com/Abbilville/cb-indexer/cmd/cb-indexer@latest
```
*Installs `cb-indexer` directly to `$GOPATH/bin` so you can run it from any terminal.*

#### Option B: Build from Source
```bash
git clone https://github.com/Abbilville/cb-indexer.git
cd cb-indexer

# Linux / macOS
go build -o bin/cb-indexer ./cmd/cb-indexer

# Windows PowerShell
go build -o bin/cb-indexer.exe ./cmd/cb-indexer
```

---

### 3. Start the Daemon

```bash
# Start background daemon (automatically loads .env if present)
cb-indexer daemon
```

Terminal output:
```text
[cb-indexer] Daemon started (interval: 15m0s, auto-pull: true, mode: moderate)
[cb-indexer] Dashboard UI:    http://127.0.0.1:43770/
[cb-indexer] MCP HTTP Server: http://127.0.0.1:43770/mcp
[cb-indexer] Auth Status:     ENABLED (API & Dashboard require token)
```

Open your browser at **[http://localhost:43770/](http://localhost:43770/)**.

---

## 🤖 Connecting AI Agents via MCP

`cb-indexer` speaks the official [Model Context Protocol (MCP)](https://modelcontextprotocol.io/). You can connect it via **HTTP Stream** (when the daemon is running) or **Stdio** (standalone binary execution).

### 1. Cursor IDE

Open **Cursor Settings** $\rightarrow$ **Features** $\rightarrow$ **MCP**, or edit `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "cb-indexer": {
      "url": "http://localhost:43770/mcp"
    }
  }
}
```

### 2. Claude Desktop

Add `cb-indexer` to your `claude_desktop_config.json`:
- **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`
- **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "cb-indexer": {
      "command": "cb-indexer",
      "args": ["run", "--stdio"]
    }
  }
}
```

### 3. Antigravity IDE / Cline

In your workspace or global settings `mcp_config.json`:

```json
{
  "mcpServers": {
    "cb-indexer": {
      "url": "http://127.0.0.1:43770/mcp"
    }
  }
}
```

> [!TIP]
> **Securing with Auth Token**: If you set `CB_INDEXER_AUTH_TOKEN=your-secret-token` in your environment, pass it in your MCP config under `headers`:
> ```json
> "headers": {
>   "Authorization": "Bearer your-secret-token"
> }
> ```

---

## 🛠️ MCP Tools Reference & AI Prompt Examples

Once connected, your AI assistant can call any of the following 11 tools autonomously:

| MCP Tool | Access | Key Parameters | Description |
| :--- | :---: | :--- | :--- |
| `get_architecture_overview` | `Read` | `project?` | Returns full workspace topology: services, languages, ports, and inter-service edges. |
| `get_repo_details` | `Read` | `repo_name`, `project?` | Returns deep service metadata, AST index status, node/edge counts, and inbound/outbound links. |
| `get_related_repos` | `Read` | `repo_name`, `direction?` | Finds upstream callers (`inbound`), downstream dependencies (`outbound`), or `all`. |
| `query_codebase_symbols` | `Read` | `query`, `repo_name?`, `label?` | Searches AST symbols (functions, methods, classes, structs) across microservices. |
| `get_symbol_context` | `Read` | `repo_name`, `file_path`, `start_line?` | Retrieves source code snippet slices around symbol line ranges. |
| `list_projects` | `Read` | `project?` | Lists all registered projects in the catalog and active AST graph databases. |
| `check_project_status` | `Read` | `project?` | Freshness report detailing manifest integrity and per-repo index staleness. |
| `trigger_index` | `Write` | `project?`, `repo_name?`, `pull?` | Triggers immediate AST indexing (with optional `git pull`) for a whole project or one service. |
| `scan_and_create_registry` | `Write` | `workspace_path`, `output_file?` | Discovers microservices in a folder and saves declarative `registry.yaml`. |
| `onboard_workspace` | `Write` | `workspace_path`, `project_id?` | Atomic pipeline: scan directory $\rightarrow$ register project $\rightarrow$ batch index into AST. |
| `remove_project` | `Write` | `project`, `purge_graphs?` | Decommissions a project from the catalog and cleans up cache graph files. |
### Real-World AI Prompts to Try:

- **Topology Discovery**:  
  > *"Explain the architecture of this workspace. What services are running and what ports do they use?"*  
  *(AI calls `get_architecture_overview`)*

- **Tracing Dependencies**:  
  > *"Which services invoke the payment-service? If I change its API contracts, what breaks?"*  
  *(AI calls `get_related_repos(repo_name="payment-service", direction="inbound")`)*

- **Freshness Check**:  
  > *"Check if my microservices are up-to-date in the AST knowledge graph."*  
  *(AI calls `check_project_status`)*

- **Auto-Onboarding**:  
  > *"Scan the directory `C:\Telkom\my-microservices` and onboard it into the catalog."*  
  *(AI calls `onboard_workspace(workspace_path="C:\\Telkom\\my-microservices")`)*

---

## 📋 Web Dashboard & AST Knowledge Graph Guide

`cb-indexer` features a self-contained, high-performance web dashboard built with **Next.js 15, TypeScript, and Three.js**, pre-compiled and embedded directly into the Go binary. Users who run `go install` or `go build` do not need Node.js installed on their machines.

### 1. Main Dashboard (`/`)
* **Service Topology Map**:
  * Displays service cards with runtime ports, indexing health dots, and tech stack badges.
  * Drag cards anywhere on the canvas; custom layouts are automatically remembered in your browser across sessions.
  * Reset view, zoom controls, and **Reset to Circle** button.
  * Non-overlapping curved Bezier routes for `routes_to`, `registers_with`, and `api_call`.
* **Open AST Knowledge Graph Button**: Top-right button and navbar badge to jump directly into the full-page AST explorer.
* **Service Catalog**: Search and filter services by name, port, or technology stack. Click any card to inspect AST statistics and query symbols.
* **Action Center**: Trigger global re-indexing, execute fast-forward Git pulls across all microservices, or decommission projects.
* **Live Activity Stream**: Real-time event log streaming daemon progress, indexing completions, and errors via Server-Sent Events.

---

### 2. Dedicated AST Knowledge Graph Explorer (`/graph/`)
Navigate to **[http://localhost:43770/graph/](http://localhost:43770/graph/)** (or click **AST Explorer** in the top navbar):

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    AST Knowledge Graph Explorer                             │
│  [← Dashboard]       [bank-microservices2  348 nodes • 102 links]           │
├──────────────────────────┬──────────────────────────────────────────────────┤
│    Collapsible Sidebar   │                 Full-Screen Canvas               │
│  [Filters] [ProjectTree] │                                                  │
│  ─────────────────────── │  • 3D Galaxy (Three.js WebGL spatial graph)      │
│  • Repository Selector   │  • 2D Network (Canvas D3 physics layout)         │
│  • Symbol Search Filter  │  • Tree Flowchart (Expandable left-to-right tree)│
│  • Edge Thickness Slider │  • Top-Right Controls:                           │
│  • Edge Opacity Slider   │    - View mode switcher                          │
│  • Node Size Slider      │    - Fullscreen toggle                           │
│  • Node Opacity Slider   │    - Interactive Legend                          │
│  • 15 Node Type Toggles  │  • Floating Node & Edge Inspector Drawers        │
│  • 21 Edge Type Toggles  │    - Inbound & Outbound navigable connections    │
│  • Interactive Code Tree │    - Live code snippet preview                   │
└──────────────────────────┴──────────────────────────────────────────────────┘
```

* **Three Immersive View Modes**:
  1. **3D Galaxy (WebGL)**: Immersive spatial network with glowing node spheres, solid directional links (`linkOpacity: 0.75`), and smooth camera flights to clicked symbols.
  2. **2D Network (Canvas)**: Crisp 2D constellation layout with collision prevention (`d3Force`), distance-based label rendering, and smooth pan/zoom.
  3. **Tree Flowchart**: Left-to-right expandable architectural tree (`Projects ──► Folders ──► Files ──► Classes ──► Functions`) with smooth Bezier branches and chevron indicators.
* **1-Hop Neighborhood Focus & Balanced Dimming**:
  * Clicking any node or selecting an item from the **Project Tree** highlights the node with a natural blue ring and highlights its 1-hop connected neighbors in cyan.
  * Non-connected nodes and links remain subtly visible at balanced opacity, maintaining full architectural context.
* **Interactive Node Inspector**:
  * Displays symbol label, qualified name, and exact source file location.
  * **Navigable Inbound & Outbound Tabs**: Lists all incoming and outgoing connections with relationship types (`CALLS`, `IMPORTS`, `DEFINES`). Clicking any neighbor immediately shifts graph focus to that node.
  * **View Code Button**: Fetches and renders the real source code slice around the symbol directly from disk.
* **Display & Visual Settings**:
  * Real-time sliders in the sidebar for **Edge Thickness** (1px–6px), **Edge Opacity** (10%–100%), **Node Size** (0.6x–2.5x), and **Node Opacity** (20%–100%).
---

## 🔐 Authentication & Security

`cb-indexer` includes built-in token authentication for HTTP MCP endpoints, REST APIs, and the Web Dashboard.

### 1. Enabling Authentication via `.env` or Environment Variables
Create or edit `.env` in your repository root:
```env
# Secret token / API key for securing HTTP MCP endpoints & Web Dashboard
CB_INDEXER_AUTH_TOKEN=your-secret-token

# Optional custom port (Default: 43770)
PORT=43770
```

When you start `cb-indexer daemon`, it **automatically loads `.env` on startup**. You can also pass the token via CLI flag or process environment variable:
```bash
cb-indexer daemon --auth-token "your-secret-token"
```

> [!NOTE]
> If `CB_INDEXER_AUTH_TOKEN` is left empty or omitted, authentication is **disabled** for open local development.

### 2. Authenticating in the Web Dashboard
1. Open the dashboard at `http://localhost:43770/`.
2. Click the **Auth** button in the upper-right header.
3. Enter your secret token into the dialog and click **Save & Apply**.
4. The navbar badge displays the real-time authentication status:
   - 🟢 **Active**: Server requires auth, and the entered token was validated.
   - 🟡 **Token Req**: Server requires an auth token, but none has been saved in the browser.
   - 🔴 **Auth Failed**: The entered token was rejected with `401 Unauthorized`.
   - ⚪ **Auth (Disabled)**: The server has no token configured (open development mode).

### 3. Authenticating AI Agents via MCP
When connecting AI agents over Streamable HTTP, pass the token in your client headers:
- `Authorization: Bearer <your-secret-token>`
- or `X-API-Key: <your-secret-token>`
- or query parameter: `?token=<your-secret-token>` (supported for browser and SSE connections)

---

## 🔒 Private Repositories & Git Sync

When you click **"Git Pull & Sync All"** on the dashboard or trigger `pull: true` via MCP:

1. **How Git Pull Works**:
   - `cb-indexer` executes the native `git` CLI on your machine.
   - It pulls the **workspace root** (if monorepo) and every **microservice subfolder** (if multi-repo or submodules).
   - Once pulled, it parses modified files and updates AST graphs automatically.

2. **Authenticating with Private GitHub Repositories**:
   Since `cb-indexer` uses your local Git CLI, it **automatically inherits your existing Git credentials**:
   - **Windows Git Credential Manager (GCM)**: If you have already authenticated in Windows Terminal, credentials stored in the Windows Credential Store are used automatically with zero extra setup.
   - **SSH Keys (`git@github.com:...`)**: If your repo remotes use SSH, Git automatically uses your local `~/.ssh/id_ed25519` or `~/.ssh/id_rsa`.
   - **GitHub CLI (`gh`)**: Run `gh auth login` and `gh auth setup-git` to configure Git credentials machine-wide.
   - **Personal Access Token (PAT)**: Set your remote URL to `https://<TOKEN>@github.com/owner/repo.git`.

> [!NOTE]
> **Non-Interactive Protection**: `cb-indexer` runs with `GIT_TERMINAL_PROMPT=0`. If authentication credentials are missing, Git will **never hang** waiting for hidden terminal inputs; it immediately reports a clean warning in the **Ingestion & Daemon Activity** log.

---

## 🛠️ CLI Reference

```text
Usage: cb-indexer [command] [options]
```

| Command | Usage | Description |
| :--- | :--- | :--- |
| `daemon` | `cb-indexer daemon [--interval 15m] [--port 43770] [--pull]` | **Primary mode**: Launches Web Dashboard, HTTP MCP server, and Git watcher. |
| `onboard` | `cb-indexer onboard [path] [-p project_id] [-m mode]` | Scans folder, generates `registry.yaml`, and batch-indexes all repositories. |
| `scan` | `cb-indexer scan [path] [-o registry.yaml] [-p project_id]` | Inspects directory up to depth 4, detects services/ports, and outputs YAML. |
| `index` | `cb-indexer index [-r path/to/registry.yaml] [-p project_id] [--pull]` | Triggers AST knowledge graph indexing for all repositories in the registry. |
| `status` | `cb-indexer status` | Displays daemon health, indexed repository counts, and recent index run logs. |
| `remove` | `cb-indexer remove [project_id] [--no-purge-graphs]` | Unregisters a project from catalog and optionally deletes AST SQLite files. |
| `run` | `cb-indexer run [--port 43770] [--stdio]` | Runs standalone MCP server via HTTP or Stdio without dashboard. |

---

## 📄 Manifest Schema (`registry.yaml`)

Every scanned workspace produces a declarative manifest `registry.yaml`:

```yaml
project_id: bank-microservices
name: bank-microservices
description: Core banking and payment processing services
git_url: https://github.com/Abbilville/bank-microservices
source_path: C:\Projects\bank-microservices\registry.yaml

repos:
  - name: gateway-service
    local_path: ./services/gateway-service
    tech_stack: [Java, Spring Boot, Spring Cloud Gateway]
    entry_point: GatewayApplication.java
    port: 8888
    git_url: https://github.com/Abbilville/bank-microservices/tree/main/services/gateway-service
    git_origin: root

  - name: account-service
    local_path: ./services/account-service
    tech_stack: [Node.js, Express, PostgreSQL]
    entry_point: src/server.js
    port: 4000
    git_url: https://github.com/Abbilville/bank-microservices/tree/main/services/account-service
    git_origin: root

relationships:
  - source: gateway-service
    target: account-service
    type: routes_to
    description: API Gateway routes incoming client traffic to account-service
```

---

## 🐳 Docker & Container Deployment

### Docker Compose (Recommended)

`docker-compose.yml`:
```yaml
services:
  cb-indexer:
    build:
      context: .
      dockerfile: Dockerfile
    container_name: cb-indexer
    restart: unless-stopped
    ports:
      - "43770:43770"
    environment:
      - PORT=43770
      - CB_INDEXER_AUTH_TOKEN=${CB_INDEXER_AUTH_TOKEN:-}
    volumes:
      - ./data:/app/data
      - cb-indexer-cache:/root/.cache/codebase-memory-mcp
      - cb-indexer-config:/root/.config/cb-mcp

volumes:
  cb-indexer-cache:
  cb-indexer-config:
```

```bash
docker compose up --build -d
docker compose logs -f
```

---

## ❓ FAQ & Troubleshooting

<details>
<summary><strong>Q: Why do my microservices show "Not indexed" or "0 AST nodes"?</strong></summary>

AST nodes and call graph edges are populated when repositories are ingested into `codebase-memory-mcp`. Click **"Re-index Projects"** in the Action Center (or run `cb-indexer index`) to ingest all repositories into AST knowledge graphs. Once indexed, the dashboard reads the exact counts directly from SQLite.
</details>

<details>
<summary><strong>Q: How do I change the default port from 43770?</strong></summary>

Specify `--port` in the CLI or set `PORT=5000` in your environment or `.env`:
```bash
cb-indexer daemon --port 5000
```
</details>

<details>
<summary><strong>Q: How does API authentication work, and why does my token show "Auth Failed" or "Auth (Disabled)"?</strong></summary>

- If `CB_INDEXER_AUTH_TOKEN` is set in your `.env` or environment, the server protects all `/api/*` endpoints and `/mcp`. If you haven't entered the matching token in the Web Dashboard (via the **Auth** button), requests will return `401 Unauthorized` and the status badge will indicate **Auth Failed**.
- If no token is configured on the server, authentication is bypassed for local development, and the badge displays **Auth (Disabled)**.
</details>

<details>
<summary><strong>Q: How do I safely delete or decommission a project from the catalog?</strong></summary>

Click the red **Delete Project** button in the dashboard action bar (or run `cb-indexer remove <project_id>`). To prevent accidental deletion, the dashboard requires you to type the exact `project_id` before confirming. You can also toggle whether to purge the underlying AST knowledge graph cache files.
</details>

<details>
<summary><strong>Q: Can I manage multiple microservice projects simultaneously?</strong></summary>

Yes! Every project scanned or onboarded is registered in `~/.config/cb-mcp/projects.yaml` (with fallback to `~/.config/oss-mcp/projects.yaml`). Use the **Project dropdown** in the action bar to switch between workspaces instantly.
</details>

---

## 📄 License

MIT © [Abbilville](https://github.com/Abbilville)
