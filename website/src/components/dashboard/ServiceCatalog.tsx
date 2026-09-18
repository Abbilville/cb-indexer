'use client';

import React, { useState, useMemo } from 'react';
import { RepoDetail } from '../../types/project';
import { Search, Server, Database, GitBranch, ArrowRight, X } from 'lucide-react';

interface ServiceCatalogProps {
  repos: RepoDetail[];
  onSelectRepo: (repo: RepoDetail) => void;
}

export function ServiceCatalog({ repos, onSelectRepo }: ServiceCatalogProps) {
  const [filterQuery, setFilterQuery] = useState('');

  const filteredRepos = useMemo(() => {
    if (!filterQuery.trim()) return repos;
    const q = filterQuery.toLowerCase();
    return repos.filter((r) => {
      const nameMatch = r.name.toLowerCase().includes(q);
      const portMatch = r.port?.toString().includes(q) ?? false;
      const techMatch = r.tech_stack?.some((t) => t.toLowerCase().includes(q)) ?? false;
      const descMatch = r.description?.toLowerCase().includes(q) ?? false;
      return nameMatch || portMatch || techMatch || descMatch;
    });
  }, [repos, filterQuery]);

  return (
    <section className="p-5 bg-gray-900/60 border border-white/10 rounded-2xl shadow-lg backdrop-blur-md">
      {/* Header & Search */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-white/10">
        <div className="flex items-center gap-2 text-white">
          <Server className="w-5 h-5 text-blue-400" />
          <h2 className="text-sm sm:text-base font-bold tracking-tight">
            Service & Repository Catalog
          </h2>
          <span className="text-xs text-gray-500 font-mono">
            ({filteredRepos.length} of {repos.length})
          </span>
        </div>

        <div className="relative min-w-[240px]">
          <input
            type="text"
            value={filterQuery}
            onChange={(e) => setFilterQuery(e.target.value)}
            placeholder="Filter by name, tech, or port..."
            className="w-full pl-9 pr-8 py-1.5 bg-black/40 border border-white/10 rounded-xl text-xs text-gray-200 placeholder:text-gray-500 focus:outline-none focus:border-blue-500"
          />
          <Search className="w-4 h-4 text-gray-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          {filterQuery && (
            <button
              onClick={() => setFilterQuery('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-500 hover:text-white p-0.5 rounded"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Grid */}
      {filteredRepos.length === 0 ? (
        <div className="py-12 text-center text-xs text-gray-500">
          No services match your filter criteria.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3.5 pt-4">
          {filteredRepos.map((repo) => (
            <div
              key={repo.name}
              onClick={() => onSelectRepo(repo)}
              className="group cursor-pointer p-4 rounded-xl bg-black/30 hover:bg-black/50 border border-white/5 hover:border-blue-500/40 transition-all hover:shadow-lg hover:shadow-blue-500/5 flex flex-col justify-between"
            >
              <div>
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div className="min-w-0">
                    <h3 className="text-sm font-bold text-gray-100 group-hover:text-blue-300 transition-colors truncate">
                      {repo.name}
                    </h3>
                    <p className="text-[11px] text-gray-400 line-clamp-1 mt-0.5">
                      {repo.description || 'No description provided'}
                    </p>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    {repo.port && (
                      <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
                        :{repo.port}
                      </span>
                    )}
                    <span
                      className={`text-[10px] px-2 py-0.5 rounded-full border ${
                        repo.is_indexed
                          ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'
                          : 'bg-amber-500/10 border-amber-500/20 text-amber-400'
                      }`}
                    >
                      {repo.is_indexed ? 'Indexed' : 'Unindexed'}
                    </span>
                  </div>
                </div>

                {/* Tech Stack Pills */}
                {repo.tech_stack && repo.tech_stack.length > 0 && (
                  <div className="flex flex-wrap gap-1 mb-3">
                    {repo.tech_stack.map((t) => (
                      <span
                        key={t}
                        className="text-[10px] px-1.5 py-0.2 bg-white/5 border border-white/10 rounded text-gray-400"
                      >
                        {t}
                      </span>
                    ))}
                  </div>
                )}
              </div>

              {/* Bottom stats row */}
              <div className="flex items-center justify-between pt-2.5 border-t border-white/5 text-[11px] text-gray-500">
                <div className="flex items-center gap-3">
                  <span className="flex items-center gap-1">
                    <Database className="w-3 h-3 text-purple-400" />
                    <span className="font-mono text-gray-300">
                      {repo.index_nodes ? repo.index_nodes.toLocaleString() : 0}
                    </span>
                  </span>
                  <span className="flex items-center gap-1">
                    <GitBranch className="w-3 h-3 text-gray-400" />
                    <span className="capitalize">{repo.git_origin || 'local'}</span>
                  </span>
                </div>

                <span className="text-blue-400 group-hover:translate-x-0.5 transition-transform inline-flex items-center gap-1 text-[11px] font-medium">
                  Details <ArrowRight className="w-3 h-3" />
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
