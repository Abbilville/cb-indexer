'use client';

import React from 'react';
import { ViewMode, GraphScope } from '../../types/graph';
import { RepoDetail } from '../../types/project';
import { Box, CircleDot, Network, Search, X, Layers, Code2 } from 'lucide-react';
import { getNodeColor, getEdgeColor } from './utils';

interface GraphFilterBarProps {
  viewMode: ViewMode;
  onChangeViewMode: (mode: ViewMode) => void;
  scope: GraphScope;
  onChangeScope: (scope: GraphScope) => void;
  repos: RepoDetail[];
  selectedRepo: string;
  onSelectRepo: (repo: string) => void;
  availableLabels: string[];
  selectedLabels: string[];
  onToggleLabel: (label: string) => void;
  availableTypes: string[];
  selectedEdgeTypes: string[];
  onToggleEdgeType: (type: string) => void;
  searchQuery: string;
  onChangeSearchQuery: (q: string) => void;
}

export function GraphFilterBar({
  viewMode,
  onChangeViewMode,
  scope,
  onChangeScope,
  repos,
  selectedRepo,
  onSelectRepo,
  availableLabels,
  selectedLabels,
  onToggleLabel,
  availableTypes,
  selectedEdgeTypes,
  onToggleEdgeType,
  searchQuery,
  onChangeSearchQuery,
}: GraphFilterBarProps) {
  return (
    <div className="flex flex-col gap-3 p-4 bg-gray-900/80 border border-white/10 rounded-2xl shadow-lg backdrop-blur-md">
      {/* Top Controls Row */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        {/* Scope Selector: Topology vs AST */}
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center p-1 rounded-xl bg-black/50 border border-white/10">
            <button
              onClick={() => onChangeScope('topology')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                scope === 'topology'
                  ? 'bg-blue-600 text-white shadow-md shadow-blue-600/30'
                  : 'text-gray-400 hover:text-white hover:bg-white/5'
              }`}
            >
              <Network className="w-3.5 h-3.5" />
              <span>Architecture Topology</span>
            </button>
            <button
              onClick={() => onChangeScope('ast')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                scope === 'ast'
                  ? 'bg-purple-600 text-white shadow-md shadow-purple-600/30'
                  : 'text-gray-400 hover:text-white hover:bg-white/5'
              }`}
            >
              <Code2 className="w-3.5 h-3.5" />
              <span>AST Code Knowledge Graph</span>
            </button>
          </div>

          {/* If in AST scope: Repository Dropdown */}
          {scope === 'ast' && repos.length > 0 && (
            <div className="relative">
              <select
                value={selectedRepo}
                onChange={(e) => onSelectRepo(e.target.value)}
                className="pl-3 pr-8 py-1.5 bg-black/60 border border-purple-500/30 rounded-xl text-xs font-mono text-purple-300 focus:outline-none focus:border-purple-400 cursor-pointer"
              >
                <option value="">(All Indexed Graphs)</option>
                {repos.map((r) => (
                  <option key={r.name} value={r.name}>
                    {r.name} {r.is_indexed ? '✓' : '(unindexed)'}
                  </option>
                ))}
              </select>
              <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-purple-400 text-[9px] pointer-events-none">
                ▼
              </span>
            </div>
          )}
        </div>

        {/* View Mode Buttons & Search Input */}
        <div className="flex items-center gap-2.5 flex-wrap">
          {/* View Mode Switcher */}
          <div className="flex items-center p-1 rounded-xl bg-black/50 border border-white/10">
            <button
              onClick={() => onChangeViewMode('2d')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                viewMode === '2d'
                  ? 'bg-white/15 text-white font-semibold'
                  : 'text-gray-400 hover:text-white hover:bg-white/5'
              }`}
              title="2D Force Physics Graph"
            >
              <CircleDot className="w-3.5 h-3.5 text-blue-400" />
              <span>2D Force</span>
            </button>

            <button
              onClick={() => onChangeViewMode('3d')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                viewMode === '3d'
                  ? 'bg-blue-600 text-white font-semibold shadow-md shadow-blue-600/30'
                  : 'text-gray-400 hover:text-white hover:bg-white/5'
              }`}
              title="3D WebGL Galaxy Graph (codebase-memory style)"
            >
              <Box className="w-3.5 h-3.5 text-cyan-300" />
              <span>3D Galaxy</span>
            </button>

            <button
              onClick={() => onChangeViewMode('whiteboard')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                viewMode === 'whiteboard'
                  ? 'bg-white/15 text-white font-semibold'
                  : 'text-gray-400 hover:text-white hover:bg-white/5'
              }`}
              title="Interactive SVG Whiteboard Layout"
            >
              <Layers className="w-3.5 h-3.5 text-indigo-400" />
              <span>Whiteboard</span>
            </button>
          </div>

          {/* Quick Node Search */}
          <div className="relative min-w-[190px]">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => onChangeSearchQuery(e.target.value)}
              placeholder="Find & focus symbol..."
              className="w-full pl-8 pr-7 py-1.5 bg-black/50 border border-white/10 rounded-xl text-xs text-gray-200 placeholder:text-gray-500 focus:outline-none focus:border-blue-500"
            />
            <Search className="w-3.5 h-3.5 text-gray-500 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            {searchQuery && (
              <button
                onClick={() => onChangeSearchQuery('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-white p-0.5 rounded"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Filter Pills: Node Labels & Edge Types */}
      <div className="flex flex-col gap-2 pt-2 border-t border-white/5">
        {/* Node Labels Filter */}
        {availableLabels.length > 0 && (
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider shrink-0">
              Node Types:
            </span>
            <div className="flex items-center gap-1.5 flex-wrap">
              {availableLabels.map((label) => {
                const isSelected = selectedLabels.length === 0 || selectedLabels.includes(label);
                const color = getNodeColor(label);

                return (
                  <button
                    key={label}
                    onClick={() => onToggleLabel(label)}
                    className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-medium border transition-all ${
                      isSelected
                        ? 'bg-white/10 border-white/25 text-white'
                        : 'opacity-40 bg-black/40 border-white/5 text-gray-500 hover:opacity-75'
                    }`}
                  >
                    <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: color }} />
                    <span>{label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Edge Types Filter */}
        {availableTypes.length > 0 && (
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider shrink-0">
              Edge Types:
            </span>
            <div className="flex items-center gap-1.5 flex-wrap">
              {availableTypes.map((type) => {
                const isSelected = selectedEdgeTypes.length === 0 || selectedEdgeTypes.includes(type);
                const color = getEdgeColor(type);

                return (
                  <button
                    key={type}
                    onClick={() => onToggleEdgeType(type)}
                    className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-mono border transition-all ${
                      isSelected
                        ? 'bg-white/10 border-white/25 text-gray-200'
                        : 'opacity-40 bg-black/40 border-white/5 text-gray-500 hover:opacity-75'
                    }`}
                  >
                    <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: color }} />
                    <span>{type}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
