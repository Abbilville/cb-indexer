# oss-indexer

<p align="center">
  <img src="https://raw.githubusercontent.com/Abbilville/oss-indexer/main/assets/banner.png" alt="oss-indexer banner" width="600" onerror="this.style.display='none'"/>
</p>

<p align="center">
  <a href="https://github.com/Abbilville/oss-indexer/releases"><img src="https://img.shields.io/github/v/release/Abbilville/oss-indexer?style=flat-square&color=blue" alt="Release"/></a>
  <a href="https://golang.org/"><img src="https://img.shields.io/badge/go-%3E%3D1.25.0-00ADD8.svg?style=flat-square" alt="Go Version"/></a>
  <a href="https://modelcontextprotocol.io/"><img src="https://img.shields.io/badge/MCP-Model%20Context%20Protocol-orange.svg?style=flat-square" alt="MCP Protocol"/></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-green.svg?style=flat-square" alt="License"/></a>
</p>

`oss-indexer` is the central **write-side topology owner and background indexing daemon** for microservice architectures and multi-repository workspaces. Built in Go using the official [Model Context Protocol Go SDK](https://github.com/modelcontextprotocol/go-sdk), it serves as the single source of truth for repository manifests (`registry.yaml`), workspace discovery, git change tracking, and automated AST knowledge graph batch indexing with [`codebase-memory-mcp`](https://github.com/DeusData/codebase-memory-mcp).

Pairs with **[`oss-ask`](https://github.com/Abbilville/oss-ask)**, the local agent-facing query layer.

---

## ⚡ Highlights

- **Single Source of Truth**: Exclusively manages repository manifest definitions (`registry.yaml`) and machine-wide project catalogs (`~/.config/oss-mcp/projects.yaml`).
- **Autonomous Background Daemon**: Continuously polls git remotes (`git fetch/pull`), detects changed commits, and incrementally reindexes repositories without human intervention.
- **Multi-Stack Scanning**: Automatically detects frameworks (Node.js, Express, React, Vue, Angular, Next.js, Python, FastAPI, Django, Java, Spring Boot, Go, Gin, Fiber, Echo) and listening ports (`.env`, entry points, Dockerfiles, docker-compose).
- **Atomic Workspace Onboarding**: Discovers repositories, creates `registry.yaml`, and executes batch AST indexing with a single command.
- **Streamable HTTP MCP Transport**: Deployed service with endpoints for topology reads, index health checks, and manual triggers.

---

## 🚀 Quick Start

### 1. Installation

#### Pre-built Binaries (Recommended)
Download the latest binary for your OS/Architecture from [GitHub Releases](https://github.com/Abbilville/oss-indexer/releases).

#### Build from Source
```bash
git clone https://github.com/Abbilville/oss-indexer.git
cd oss-indexer
go build -o bin/oss-indexer ./cmd/oss-indexer
```

### 2. Onboard a Workspace
Scan any directory containing microservices and build AST knowledge graphs in one step:
```bash
oss-indexer onboard /path/to/microservices --mode moderate
```

### 3. Run as Background Daemon (Deployed / Localhost)
Start the background daemon with git change tracking and HTTP MCP server:
```bash
# Starts HTTP MCP server on http://127.0.0.1:8080/mcp with 15m polling interval
oss-indexer daemon --interval 15m --port 8080 --pull
```

---

## 🛠️ CLI Reference

```bash
# Start background indexing daemon and HTTP MCP server
oss-indexer daemon [--interval 15m] [--port 8080] [--pull] [--auth-token <secret>]

# Scan workspace directory and generate registry.yaml
oss-indexer scan <workspace_path> [-o output_file] [-p project_id]

# Batch index repositories into codebase-memory-mcp
oss-indexer index [-r registry_path] [-p project_id] [-m moderate|full|fast] [--pull]

# Atomic onboard: scan + write registry + batch index
oss-indexer onboard <workspace_path> [-m mode] [-o output_file]

# Check operational daemon health, index coverage, and run logs
oss-indexer status

# Decommission project and purge knowledge graphs
oss-indexer remove <project_id_or_path> [--no-purge-graphs] [--keep-manifest]

# Run standalone MCP server
oss-indexer run [--port 8080] [--stdio] [--auth-token <secret>]
```

---

## 🔌 Exposed MCP Tools (HTTP Transport)

| Tool | Category | Description | Inputs |
| :--- | :--- | :--- | :--- |
| `get_architecture_overview` | Read | Complete JSON topology: services, tech stacks, ports, and inter-service dependencies. | `project?` (string) |
| `get_repo_details` | Read | Comprehensive details for a specific repository with inbound/outbound edges. | `repo_name` (string), `project?` (string) |
| `get_related_repos` | Read | Upstream callers, downstream dependencies, and shared resources. | `repo_name` (string), `direction?` (string) |
| `list_projects` | Read | Registered project catalog entries and indexed graph databases. | `project?` (string) |
| `check_project_status` | Read | One-call health report showing registry integrity and per-repo index freshness. | `project?` (string) |
| `check_index_status` | Read | Operational daemon health, last run timestamp, and recent errors. | `project?` (string) |
| `trigger_index` | Write | Triggers immediate batch or single-repo AST indexing. | `project?` (string), `repo_name?` (string), `mode?` (string), `pull?` (bool) |
| `scan_and_create_registry` | Write | Scans a directory and generates/saves `registry.yaml`. | `workspace_path` (string), `output_file?` (string) |
| `onboard_workspace` | Write (Composite) | Single-call atomic scan $\rightarrow$ save manifest $\rightarrow$ batch index. | `workspace_path` (string), `mode?` (string), `output_file?` (string) |
| `remove_project` | Write | Purges graph databases, unregisters from catalog, and deletes manifest. | `project` (string), `purge_graphs?` (bool), `delete_manifest?` (bool) |

---

## 📄 Manifest Format (`registry.yaml`)

```yaml
project_id: fintech-platform
name: FinTech Ecosystem
description: Core payment processing and account management stack

repos:
  - name: account-service
    owner: core-team
    local_path: ./services/account-service
    description: User account & balance management
    tech_stack:
      - Go
      - Gin
      - PostgreSQL
    entry_point: main.go
    port: 8080

  - name: payment-gateway
    owner: payments-team
    local_path: ./services/payment-gateway
    description: Payment processing & webhook handler
    tech_stack:
      - Node.js
      - Express
      - Redis
      - JWT
    entry_point: src/server.js
    port: 4000

relationships:
  - source: payment-gateway
    target: account-service
    type: api_call
    description: Payment gateway invokes account-service on port 8080 to debit balances
```

---

## 📄 License

MIT © [Abbilville](https://github.com/Abbilville)
