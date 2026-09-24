export interface ProjectCatalogItem {
  name: string;
  project_id: string;
  description?: string;
  total_repos?: number;
  registry_path?: string;
  git_url?: string;
}

export interface ProjectsResponse {
  registered_projects: ProjectCatalogItem[];
  indexed_codebase_memory_graphs: unknown[];
  total_registered_projects: number;
  total_indexed_graphs: number;
}

export interface RepoDetail {
  name: string;
  local_path: string;
  description?: string;
  tech_stack?: string[];
  port?: number;
  is_indexed: boolean;
  index_nodes?: number;
  index_edges?: number;
  indexed_at?: string;
  source?: string;
  git_url?: string;
  git_origin?: string;
  is_cpg_indexed?: boolean;
  cpg_nodes?: number;
  cpg_edges?: number;
}

export interface ProjectRelationship {
  source: string;
  target: string;
  type: string;
  description?: string;
  metadata?: Record<string, unknown>;
}

export interface CPGStatus {
  available: boolean;
  engine: string;
  binary_path?: string;
  version?: string;
  cache_dir: string;
  indexed_repos: number;
  total_nodes: number;
  total_edges: number;
  help?: string;
}

export interface ProjectOverview {
  project_id: string;
  project_name: string;
  description?: string;
  git_url?: string;
  source_path?: string;
  total_repos: number;
  indexed_repos: number;
  unindexed_repos: number;
  total_nodes: number;
  total_edges: number;
  total_relationships: number;
  total_cpg_nodes?: number;
  total_cpg_edges?: number;
  indexed_cpg_repos?: number;
  cpg_status?: CPGStatus;
  repos: RepoDetail[];
  relationships: ProjectRelationship[];
  is_all_indexed: boolean;
}

export interface DaemonStatus {
  running: boolean;
  watcher_active: boolean;
  last_scan?: string;
  active_projects: number;
}

export interface StatusResponse {
  daemon: DaemonStatus;
  is_indexing: boolean;
  server_time: string;
  active_projects: number;
  cpg?: CPGStatus;
}

export interface CodeSnippet {
  project: string;
  file_path: string;
  start_line: number;
  end_line: number;
  total_lines: number;
  snippet: string;
}

export interface CodeContextResponse {
  status: string;
  project: string;
  repo: string;
  context: CodeSnippet;
}
