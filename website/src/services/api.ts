import {
  ProjectsResponse,
  ProjectOverview,
  StatusResponse,
  CodeContextResponse,
} from '../types/project';
import { GraphPayload } from '../types/graph';

const AUTH_STORAGE_KEY = 'CB_INDEXER_AUTH_TOKEN';
const LEGACY_AUTH_STORAGE_KEY = 'OSS_INDEXER_AUTH_TOKEN';

export class ApiService {
  public static getAuthToken(): string {
    if (typeof window === 'undefined') return '';
    return (
      localStorage.getItem(AUTH_STORAGE_KEY) ||
      localStorage.getItem(LEGACY_AUTH_STORAGE_KEY) ||
      ''
    );
  }

  public static setAuthToken(token: string): void {
    if (typeof window === 'undefined') return;
    const trimmed = token.trim();
    if (trimmed) {
      localStorage.setItem(AUTH_STORAGE_KEY, trimmed);
      localStorage.setItem(LEGACY_AUTH_STORAGE_KEY, trimmed);
    } else {
      localStorage.removeItem(AUTH_STORAGE_KEY);
      localStorage.removeItem(LEGACY_AUTH_STORAGE_KEY);
    }
  }

  public static hasAuthToken(): boolean {
    return !!this.getAuthToken();
  }

  public static getHeaders(customHeaders?: HeadersInit): HeadersInit {
    const token = this.getAuthToken();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
      headers['X-API-Key'] = token;
    }
    return {
      ...headers,
      ...customHeaders,
    };
  }

  private static async request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const baseUrl = process.env.NEXT_PUBLIC_API_URL || '';
    const url = `${baseUrl}${endpoint}`;

    const res = await fetch(url, {
      ...options,
      headers: this.getHeaders(options.headers),
    });

    if (res.status === 401) {
      throw new Error('Unauthorized: Please verify your API Auth Token in settings.');
    }

    if (!res.ok) {
      const errorData = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      const message = typeof errorData.error === 'string' ? errorData.error : `HTTP ${res.status}`;
      throw new Error(message);
    }

    return (await res.json()) as T;
  }

  public static async getHealth(): Promise<{ status: string; service: string; auth_required: boolean; authenticated?: boolean }> {
    return this.request<{ status: string; service: string; auth_required: boolean; authenticated?: boolean }>('/health');
  }

  public static async verifyAuth(tokenOverride?: string): Promise<{ auth_required: boolean; authenticated: boolean; message: string }> {
    const baseUrl = process.env.NEXT_PUBLIC_API_URL || '';
    const url = `${baseUrl}/api/auth/verify`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    const token = tokenOverride !== undefined ? tokenOverride.trim() : this.getAuthToken();
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
      headers['X-API-Key'] = token;
    }

    try {
      const res = await fetch(url, { headers });
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      return {
        auth_required: Boolean(data.auth_required),
        authenticated: Boolean(data.authenticated),
        message: typeof data.message === 'string' ? data.message : res.ok ? 'Authenticated' : 'Unauthorized',
      };
    } catch {
      return {
        auth_required: true,
        authenticated: false,
        message: 'Network error or server unreachable',
      };
    }
  }

  public static async getProjects(): Promise<ProjectsResponse> {
    return this.request<ProjectsResponse>('/api/projects');
  }

  public static async getOverview(projectId?: string): Promise<ProjectOverview> {
    const query = projectId ? `?project=${encodeURIComponent(projectId)}` : '';
    return this.request<ProjectOverview>(`/api/overview${query}`);
  }

  public static async getStatus(projectId?: string): Promise<StatusResponse> {
    const query = projectId ? `?project=${encodeURIComponent(projectId)}` : '';
    return this.request<StatusResponse>(`/api/status${query}`);
  }

  public static async getGraph(params: {
    project?: string;
    repo?: string;
    scope?: string;
    limit?: number;
    labels?: string[];
    types?: string[];
    q?: string;
  }): Promise<GraphPayload> {
    const searchParams = new URLSearchParams();
    if (params.project) searchParams.set('project', params.project);
    if (params.repo) searchParams.set('repo', params.repo);
    if (params.scope) searchParams.set('scope', params.scope);
    if (params.limit) searchParams.set('limit', params.limit.toString());
    if (params.labels && params.labels.length > 0) searchParams.set('labels', params.labels.join(','));
    if (params.types && params.types.length > 0) searchParams.set('types', params.types.join(','));
    if (params.q) searchParams.set('q', params.q);

    const queryStr = searchParams.toString() ? `?${searchParams.toString()}` : '';
    return this.request<GraphPayload>(`/api/graph${queryStr}`);
  }

  public static async getCodeContext(params: {
    project: string;
    repo: string;
    file: string;
    start?: number;
    end?: number;
    padding?: number;
  }): Promise<CodeContextResponse> {
    const searchParams = new URLSearchParams({
      project: params.project,
      repo: params.repo,
      file: params.file,
    });
    if (params.start) searchParams.set('start', params.start.toString());
    if (params.end) searchParams.set('end', params.end.toString());
    if (params.padding) searchParams.set('padding', params.padding.toString());

    return this.request<CodeContextResponse>(`/api/rag/context?${searchParams.toString()}`);
  }

  public static async searchSymbols(params: {
    project?: string;
    repo?: string;
    q: string;
    label?: string;
    limit?: number;
  }): Promise<{ query: string; total_found?: number; symbols?: unknown[]; results?: unknown[] }> {
    const searchParams = new URLSearchParams({ q: params.q });
    if (params.project) searchParams.set('project', params.project);
    if (params.repo) searchParams.set('repo', params.repo);
    if (params.label) searchParams.set('label', params.label);
    if (params.limit) searchParams.set('limit', params.limit.toString());

    return this.request<{ query: string; total_found?: number; symbols?: unknown[]; results?: unknown[] }>(
      `/api/rag/search?${searchParams.toString()}`
    );
  }

  public static async getCPGStatus(): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>('/api/cpg/status');
  }

  public static async queryCPG(params: {
    repo: string;
    type: 'callers' | 'callees' | 'references' | 'cfg' | 'data_flow' | 'types';
    symbol?: string;
    source?: string;
    sink?: string;
  }): Promise<Record<string, unknown>> {
    const searchParams = new URLSearchParams({ repo: params.repo, type: params.type });
    if (params.symbol) searchParams.set('symbol', params.symbol);
    if (params.source) searchParams.set('source', params.source);
    if (params.sink) searchParams.set('sink', params.sink);
    return this.request<Record<string, unknown>>(`/api/cpg/query?${searchParams.toString()}`);
  }

  public static async triggerReindex(params: {
    project?: string;
    repoName?: string;
    pull?: boolean;
    engine?: 'ast' | 'cpg' | 'both';
  }): Promise<{ status: string; message: string }> {
    return this.request<{ status: string; message: string }>('/api/trigger', {
      method: 'POST',
      body: JSON.stringify({
        project: params.project,
        repo_name: params.repoName,
        repo: params.repoName,
        pull: !!params.pull,
        engine: params.engine || 'both',
      }),
    });
  }

  public static async scanWorkspace(params: {
    path: string;
    projectId?: string;
  }): Promise<{ status: string; project_id: string; total_repos: number; repos_count?: number; message?: string }> {
    return this.request<{ status: string; project_id: string; total_repos: number; repos_count?: number; message?: string }>(
      '/api/scan',
      {
        method: 'POST',
        body: JSON.stringify({
          workspace_path: params.path,
          path: params.path,
          project_id: params.projectId,
        }),
      }
    );
  }

  public static async browseDirs(path?: string, showHidden?: boolean): Promise<{ current: string; parent: string; dirs: string[]; drives?: string[] }> {
    const params = new URLSearchParams();
    if (path) params.set('path', path);
    if (showHidden) params.set('show_hidden', 'true');
    const query = params.toString() ? `?${params.toString()}` : '';
    return this.request<{ current: string; parent: string; dirs: string[]; drives?: string[] }>(`/api/browse-dirs${query}`);
  }

  public static async browseFolder(initialPath?: string): Promise<{ path?: string; status: string; message?: string }> {
    return this.request<{ path?: string; status: string; message?: string }>('/api/browse-folder', {
      method: 'POST',
      body: JSON.stringify({ path: initialPath }),
    });
  }

  public static async deleteProject(params: {
    projectId: string;
    purgeGraphs: boolean;
    purgeCpg?: boolean;
  }): Promise<{ status: string; message: string }> {
    return this.request<{ status: string; message: string }>('/api/project/remove', {
      method: 'POST',
      body: JSON.stringify({
        project_id: params.projectId,
        project: params.projectId,
        purge_graphs: params.purgeGraphs,
        purge_cpg: params.purgeCpg ?? params.purgeGraphs,
      }),
    });
  }
}
