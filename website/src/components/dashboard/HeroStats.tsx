'use client';

import React from 'react';
import { ProjectOverview } from '../../types/project';
import { Layers, ShieldCheck, Box, Network } from 'lucide-react';

interface HeroStatsProps {
  overview: ProjectOverview | null;
  loading: boolean;
}

export function HeroStats({ overview, loading }: HeroStatsProps) {
  const totalRepos = overview?.total_repos ?? 0;
  const indexedRepos = overview?.indexed_repos ?? 0;
  const coveragePercent = totalRepos > 0 ? Math.round((indexedRepos / totalRepos) * 100) : 0;
  const totalNodes = overview?.total_nodes ?? 0;
  const totalRelationships = overview?.total_relationships ?? 0;

  return (
    <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 px-4 sm:px-6 py-4">
      {/* Card 1: Total Services */}
      <div className="relative overflow-hidden p-5 bg-gray-900/60 hover:bg-gray-900/80 border border-white/10 hover:border-blue-500/30 rounded-2xl transition-all shadow-lg backdrop-blur-md group">
        <div className="flex items-start justify-between">
          <div>
            <span className="text-xs font-semibold uppercase tracking-wider text-gray-400">Total Services</span>
            <div className="text-2xl sm:text-3xl font-bold font-mono text-white mt-1">
              {loading ? <span className="opacity-40 animate-pulse">—</span> : totalRepos}
            </div>
            <div className="text-[11px] text-gray-500 mt-1">Registered microservices</div>
          </div>
          <div className="p-2.5 rounded-xl bg-blue-500/10 border border-blue-500/20 text-blue-400 group-hover:scale-110 transition-transform">
            <Layers className="w-5 h-5" />
          </div>
        </div>
      </div>

      {/* Card 2: Index Coverage */}
      <div className="relative overflow-hidden p-5 bg-gray-900/60 hover:bg-gray-900/80 border border-white/10 hover:border-emerald-500/30 rounded-2xl transition-all shadow-lg backdrop-blur-md group">
        <div className="flex items-start justify-between">
          <div className="flex-1 pr-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-gray-400">Index Coverage</span>
            <div className="text-2xl sm:text-3xl font-bold font-mono text-emerald-400 mt-1">
              {loading ? <span className="opacity-40 animate-pulse">—</span> : `${coveragePercent}%`}
            </div>
            <div className="text-[11px] text-gray-500 mt-1">
              {indexedRepos} of {totalRepos} repositories indexed
            </div>
            <div className="w-full bg-black/40 rounded-full h-1.5 mt-2.5 overflow-hidden border border-white/5">
              <div
                className="bg-emerald-500 h-full rounded-full transition-all duration-500"
                style={{ width: `${coveragePercent}%` }}
              />
            </div>
          </div>
          <div className="p-2.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 group-hover:scale-110 transition-transform shrink-0">
            <ShieldCheck className="w-5 h-5" />
          </div>
        </div>
      </div>

      {/* Card 3: AST Nodes */}
      <div className="relative overflow-hidden p-5 bg-gray-900/60 hover:bg-gray-900/80 border border-white/10 hover:border-purple-500/30 rounded-2xl transition-all shadow-lg backdrop-blur-md group">
        <div className="flex items-start justify-between">
          <div>
            <span className="text-xs font-semibold uppercase tracking-wider text-gray-400">Total AST Nodes</span>
            <div className="text-2xl sm:text-3xl font-bold font-mono text-purple-300 mt-1">
              {loading ? <span className="opacity-40 animate-pulse">—</span> : totalNodes.toLocaleString()}
            </div>
            <div className="text-[11px] text-gray-500 mt-1">Symbols, classes, and routes</div>
          </div>
          <div className="p-2.5 rounded-xl bg-purple-500/10 border border-purple-500/20 text-purple-400 group-hover:scale-110 transition-transform">
            <Box className="w-5 h-5" />
          </div>
        </div>
      </div>

      {/* Card 4: Service Connections */}
      <div className="relative overflow-hidden p-5 bg-gray-900/60 hover:bg-gray-900/80 border border-white/10 hover:border-cyan-500/30 rounded-2xl transition-all shadow-lg backdrop-blur-md group">
        <div className="flex items-start justify-between">
          <div>
            <span className="text-xs font-semibold uppercase tracking-wider text-gray-400">Service Connections</span>
            <div className="text-2xl sm:text-3xl font-bold font-mono text-cyan-300 mt-1">
              {loading ? <span className="opacity-40 animate-pulse">—</span> : totalRelationships}
            </div>
            <div className="text-[11px] text-gray-500 mt-1">Architecture topology links</div>
          </div>
          <div className="p-2.5 rounded-xl bg-cyan-500/10 border border-cyan-500/20 text-cyan-400 group-hover:scale-110 transition-transform">
            <Network className="w-5 h-5" />
          </div>
        </div>
      </div>
    </section>
  );
}
