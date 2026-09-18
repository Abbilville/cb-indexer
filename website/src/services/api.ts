import {
  ProjectsResponse,
  ProjectOverview,
  StatusResponse,
  CodeContextResponse,
} from '../types/project';
import { GraphPayload } from '../types/graph';

const AUTH_STORAGE_KEY = 'OSS_INDEXER_AUTH_TOKEN';

export class ApiService {
  private static getAuthToken(): string {
    if (typeof window === 'undefined') return '';
    return localStorage.getItem(AUTH_STORAGE_KEY) || '';
  }

  public static setAuthToken(token: string): void {
    if (typeof window === 'undefined') return;
    if (token.trim()) {
      localStorage.setItem(AUTH_STORAGE_KEY, token.trim());
    } else {
      localStorage.removeItem(AUTH_STORAGE_KEY);
    }
  }

  public static hasAuthToken(): boolean {
    return !!this.getAuthToken();
  }

  private static getHeaders(customHeaders?: HeadersInit): HeadersInit {
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

  public static async getHealth(): Promise<{ status: string; service: string; auth_required: boolean }> {
    return this.request<{ status: string; service: string; auth_required: boolean }>('/health');
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

  public static async triggerReindex(params: {
    project?: string;
    repoName?: string;
    pull?: boolean;
  }): Promise<{ status: string; message: string }> {
    return this.request<{ status: string; message: string }>('/api/trigger', {
      method: 'POST',
      body: JSON.stringify({
        project: params.project,
        repo: params.repoName,
        pull: !!params.pull,
      }),
    });
  }

  public static async scanWorkspace(params: {
    path: string;
    projectId?: string;
  }): Promise<{ status: string; project_id: string; total_repos: number; message: string }> {
    return this.request<{ status: string; project_id: string; total_repos: number; message: string }>(
      '/api/scan',
      {
        method: 'POST',
        body: JSON.stringify({
          path: params.path,
          project_id: params.projectId,
        }),
      }
    );
  }

  public static async browseFolder(): Promise<{ path: string; status: string }> {
    return this.request<{ path: string; status: string }>('/api/browse-folder', {
      method: 'POST',
    });
  }

  public static async deleteProject(params: {
    projectId: string;
    purgeGraphs: boolean;
  }): Promise<{ status: string; message: string }> {
    return this.request<{ status: string; message: string }>('/api/project/remove', {
      method: 'POST',
      body: JSON.stringify({
        project: params.projectId,
        purge_graphs: params.purgeGraphs,
      }),
    });
  }
}
