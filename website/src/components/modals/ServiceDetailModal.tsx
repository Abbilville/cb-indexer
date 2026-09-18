'use client';

import React, { useState } from 'react';
import { RepoDetail } from '../../types/project';
import { ApiService } from '../../services/api';
import { useToast } from '../ui/Toast';
import {
  Layers,
  X,
  Code2,
  GitBranch,
  Folder,
  Globe,
  Database,
  Search,
  Loader2,
  RefreshCw,
  FileCode,
} from 'lucide-react';

interface ServiceDetailModalProps {
  isOpen: boolean;
  repo: RepoDetail | null;
  projectId: string;
  onClose: () => void;
  onReindexTriggered: () => void;
}

interface SymbolSearchResult {
  id: number;
  name: string;
  qualified_name: string;
  label: string;
  file_path: string;
  start_line: number;
  end_line: number;
}

export function ServiceDetailModal({
  isOpen,
  repo,
  projectId,
  onClose,
  onReindexTriggered,
}: ServiceDetailModalProps) {
  const { showToast } = useToast();
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [symbols, setSymbols] = useState<SymbolSearchResult[]>([]);
  const [hasSearched, setHasSearched] = useState(false);
  const [activeSnippet, setActiveSnippet] = useState<{ file: string; snippet: string } | null>(null);
  const [isLoadingSnippet, setIsLoadingSnippet] = useState(false);
  const [isReindexing, setIsReindexing] = useState(false);

  if (!isOpen || !repo) return null;

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchQuery.trim()) return;

    try {
      setIsSearching(true);
      const res = await ApiService.searchSymbols({
        project: projectId,
        repo: repo.name,
        q: searchQuery.trim(),
        limit: 15,
      });

      const parsedResults: SymbolSearchResult[] = [];
      const rawList = Array.isArray(res.symbols) ? res.symbols : Array.isArray(res.results) ? res.results : [];
      for (const r of rawList) {
        if (r && typeof r === 'object') {
          const item = r as Record<string, unknown>;
          parsedResults.push({
            id: typeof item.id === 'number' ? item.id : 0,
            name: typeof item.name === 'string' ? item.name : '',
            qualified_name: typeof item.qualified_name === 'string' ? item.qualified_name : '',
            label: typeof item.label === 'string' ? item.label : 'Symbol',
            file_path: typeof item.file_path === 'string' ? item.file_path : '',
            start_line: typeof item.start_line === 'number' ? item.start_line : 1,
            end_line: typeof item.end_line === 'number' ? item.end_line : 1,
          });
        }
      }

      setSymbols(parsedResults);
      setHasSearched(true);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Symbol search failed';
      showToast(msg, 'error');
    } finally {
      setIsSearching(false);
    }
  };

  const handleViewSnippet = async (sym: SymbolSearchResult) => {
    try {
      setIsLoadingSnippet(true);
      const res = await ApiService.getCodeContext({
        project: projectId,
        repo: repo.name,
        file: sym.file_path,
        start: sym.start_line,
        end: sym.end_line,
        padding: 4,
      });

      setActiveSnippet({
        file: sym.file_path,
        snippet: res.context.snippet,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to fetch code snippet';
      showToast(msg, 'error');
    } finally {
      setIsLoadingSnippet(false);
    }
  };

  const handleReindex = async () => {
    try {
      setIsReindexing(true);
      await ApiService.triggerReindex({
        project: projectId,
        repoName: repo.name,
      });
      showToast(`Re-indexing triggered for ${repo.name}`, 'success');
      onReindexTriggered();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Re-index trigger failed';
      showToast(msg, 'error');
    } finally {
      setIsReindexing(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="relative w-full max-w-2xl max-h-[88vh] flex flex-col p-6 bg-gray-900/95 border border-white/10 rounded-2xl shadow-2xl backdrop-blur-xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-white/10 shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-blue-500/10 border border-blue-500/20 text-blue-400">
              <Layers className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white flex items-center gap-2">
                {repo.name}
                {repo.port && (
                  <span className="text-xs font-mono px-2 py-0.5 rounded-full bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
                    :{repo.port}
                  </span>
                )}
              </h2>
              <p className="text-xs text-gray-400">{repo.description || 'No description available'}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white p-1 rounded-lg hover:bg-white/5 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body Content */}
        <div className="flex-1 overflow-y-auto py-4 space-y-5 pr-1">
          {/* Status & Quick Stats */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
            <div className="p-3 rounded-xl bg-black/40 border border-white/5">
              <div className="text-[11px] text-gray-400 flex items-center gap-1.5 mb-1">
                <Database className="w-3.5 h-3.5 text-purple-400" />
                AST Status
              </div>
              <div className="text-xs font-semibold">
                {repo.is_indexed ? (
                  <span className="text-emerald-400">Indexed</span>
                ) : (
                  <span className="text-amber-400">Unindexed</span>
                )}
              </div>
            </div>

            <div className="p-3 rounded-xl bg-black/40 border border-white/5">
              <div className="text-[11px] text-gray-400 flex items-center gap-1.5 mb-1">
                <Code2 className="w-3.5 h-3.5 text-blue-400" />
                AST Nodes
              </div>
              <div className="text-xs font-semibold font-mono text-gray-200">
                {repo.index_nodes?.toLocaleString() ?? '—'}
              </div>
            </div>

            <div className="p-3 rounded-xl bg-black/40 border border-white/5">
              <div className="text-[11px] text-gray-400 flex items-center gap-1.5 mb-1">
                <Globe className="w-3.5 h-3.5 text-cyan-400" />
                AST Edges
              </div>
              <div className="text-xs font-semibold font-mono text-gray-200">
                {repo.index_edges?.toLocaleString() ?? '—'}
              </div>
            </div>

            <div className="p-3 rounded-xl bg-black/40 border border-white/5">
              <div className="text-[11px] text-gray-400 flex items-center gap-1.5 mb-1">
                <GitBranch className="w-3.5 h-3.5 text-emerald-400" />
                Origin
              </div>
              <div className="text-xs font-semibold capitalize text-gray-200">
                {repo.git_origin || 'Local'}
              </div>
            </div>
          </div>

          {/* Details Metadata */}
          <div className="space-y-2 p-3.5 rounded-xl bg-black/30 border border-white/5 text-xs">
            <div className="flex items-center gap-2 text-gray-300">
              <Folder className="w-4 h-4 text-gray-500 shrink-0" />
              <span className="text-gray-500">Path:</span>
              <span className="font-mono text-gray-300 truncate">{repo.local_path}</span>
            </div>
            {repo.tech_stack && repo.tech_stack.length > 0 && (
              <div className="flex items-center gap-2 pt-1">
                <span className="text-gray-500 shrink-0">Tech Stack:</span>
                <div className="flex flex-wrap gap-1.5">
                  {repo.tech_stack.map((t) => (
                    <span
                      key={t}
                      className="px-2 py-0.5 rounded-md bg-white/5 border border-white/10 text-gray-300 text-[11px]"
                    >
                      {t}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Remote AST Search Section */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold text-gray-300 flex items-center gap-1.5 uppercase tracking-wider">
                <Search className="w-3.5 h-3.5 text-blue-400" />
                Query AST Symbols
              </h3>
              {repo.is_indexed && (
                <span className="text-[11px] text-gray-500">Powered by codebase-memory SQLite</span>
              )}
            </div>

            <form onSubmit={handleSearch} className="flex gap-2">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search functions, classes, routes... (e.g. handleLogin, User)"
                className="flex-1 px-3.5 py-2 bg-black/50 border border-white/10 rounded-xl text-xs text-gray-100 placeholder:text-gray-600 focus:outline-none focus:border-blue-500"
              />
              <button
                type="submit"
                disabled={isSearching || !searchQuery.trim()}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-500 rounded-xl shadow-lg shadow-blue-600/20 disabled:opacity-50 transition-all"
              >
                {isSearching ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
                <span>Search</span>
              </button>
            </form>

            {/* Results Table */}
            {hasSearched && (
              <div className="border border-white/10 rounded-xl overflow-hidden bg-black/40">
                {symbols.length === 0 ? (
                  <div className="p-4 text-center text-xs text-gray-500">
                    No symbols found matching &quot;{searchQuery}&quot;
                  </div>
                ) : (
                  <div className="divide-y divide-white/5 max-h-48 overflow-y-auto">
                    {symbols.map((s) => (
                      <div
                        key={s.id}
                        className="p-2.5 flex items-center justify-between gap-3 hover:bg-white/5 transition-colors text-xs"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-blue-300 font-mono">{s.name}</span>
                            <span className="px-1.5 py-0.2 rounded bg-purple-500/10 text-purple-300 border border-purple-500/20 text-[10px]">
                              {s.label}
                            </span>
                          </div>
                          <div className="text-[11px] text-gray-500 font-mono truncate">
                            {s.file_path}:{s.start_line}
                          </div>
                        </div>
                        <button
                          onClick={() => handleViewSnippet(s)}
                          disabled={isLoadingSnippet}
                          className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium text-gray-300 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg transition-all"
                        >
                          <FileCode className="w-3 h-3 text-cyan-400" />
                          <span>View Code</span>
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Active Code Snippet View */}
            {activeSnippet && (
              <div className="border border-cyan-500/30 rounded-xl overflow-hidden bg-black/70 animate-in fade-in">
                <div className="flex items-center justify-between px-3 py-2 bg-cyan-950/40 border-b border-cyan-500/20 text-xs text-cyan-300 font-mono">
                  <span className="truncate">{activeSnippet.file}</span>
                  <button
                    onClick={() => setActiveSnippet(null)}
                    className="text-gray-400 hover:text-white p-0.5 rounded"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
                <pre className="p-3 text-[11px] font-mono text-gray-200 overflow-x-auto leading-relaxed max-h-56">
                  {activeSnippet.snippet}
                </pre>
              </div>
            )}
          </div>
        </div>

        {/* Footer Actions */}
        <div className="flex items-center justify-between pt-4 border-t border-white/10 shrink-0">
          <button
            onClick={handleReindex}
            disabled={isReindexing}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-gray-300 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl transition-all disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 text-blue-400 ${isReindexing ? 'animate-spin' : ''}`} />
            <span>{isReindexing ? 'Triggering...' : 'Re-index Service'}</span>
          </button>
          <button
            onClick={onClose}
            className="px-4 py-2 text-xs font-semibold text-white bg-white/10 hover:bg-white/15 rounded-xl transition-all"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
