'use client';

import React, { useState } from 'react';
import { GraphNode, GraphPayload } from '../../types/graph';
import { RepoDetail } from '../../types/project';
import { ProjectTreeView } from './ProjectTreeView';
import { getNodeColor, getEdgeColor } from '../graph/utils';
import {
  SlidersHorizontal,
  FolderTree,
  ChevronLeft,
  ChevronRight,
  Database,
  Search,
  X,
} from 'lucide-react';

interface AstSidebarProps {
  data: GraphPayload | null;
  repos: RepoDetail[];
  selectedRepo: string;
  onSelectRepo: (repo: string) => void;
  selectedLabels: string[];
  onToggleLabel: (label: string) => void;
  onSelectAllLabels: () => void;
  onClearAllLabels: () => void;
  selectedEdgeTypes: string[];
  onToggleEdgeType: (type: string) => void;
  onSelectAllEdgeTypes: () => void;
  onClearAllEdgeTypes: () => void;
  searchQuery: string;
  onChangeSearchQuery: (q: string) => void;
  selectedNode: GraphNode | null;
  onSelectNode: (node: GraphNode) => void;
  edgeThickness?: number;
  onChangeEdgeThickness?: (thickness: number) => void;
  edgeOpacity?: number;
  onChangeEdgeOpacity?: (opacity: number) => void;
  nodeSize?: number;
  onChangeNodeSize?: (size: number) => void;
  nodeOpacity?: number;
  onChangeNodeOpacity?: (opacity: number) => void;
}

export function AstSidebar({
  data,
  repos,
  selectedRepo,
  onSelectRepo,
  selectedLabels,
  onToggleLabel,
  onSelectAllLabels,
  onClearAllLabels,
  selectedEdgeTypes,
  onToggleEdgeType,
  onSelectAllEdgeTypes,
  onClearAllEdgeTypes,
  searchQuery,
  onChangeSearchQuery,
  selectedNode,
  onSelectNode,
  edgeThickness = 2.5,
  onChangeEdgeThickness,
  edgeOpacity = 0.75,
  onChangeEdgeOpacity,
  nodeSize = 1.0,
  onChangeNodeSize,
  nodeOpacity = 1.0,
  onChangeNodeOpacity,
}: AstSidebarProps) {
  const [activeTab, setActiveTab] = useState<'filters' | 'tree'>('filters');
  const [isCollapsed, setIsCollapsed] = useState(false);

  const availableLabels = data?.available_labels || [];
  const availableTypes = data?.available_types || [];

  return (
    <aside
      className={`relative h-full flex flex-col bg-gray-950/80 border-r border-white/10 transition-all duration-300 z-30 shrink-0 ${
        isCollapsed ? 'w-12' : 'w-80 sm:w-88'
      }`}
    >
      {/* Collapse/Expand Toggle Button */}
      <button
        onClick={() => setIsCollapsed(!isCollapsed)}
        className="absolute -right-3.5 top-6 z-40 p-1 rounded-full bg-gray-900 border border-white/15 text-gray-400 hover:text-white shadow-lg transition-transform hover:scale-110"
        title={isCollapsed ? 'Expand Sidebar' : 'Collapse Sidebar'}
      >
        {isCollapsed ? <ChevronRight className="w-3.5 h-3.5" /> : <ChevronLeft className="w-3.5 h-3.5" />}
      </button>

      {/* When Collapsed: Vertical Icon Rail */}
      {isCollapsed ? (
        <div className="flex flex-col items-center gap-4 py-6">
          <button
            onClick={() => {
              setIsCollapsed(false);
              setActiveTab('filters');
            }}
            className={`p-2 rounded-xl transition-colors ${
              activeTab === 'filters' ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-white'
            }`}
            title="Filters & Types"
          >
            <SlidersHorizontal className="w-4 h-4" />
          </button>
          <button
            onClick={() => {
              setIsCollapsed(false);
              setActiveTab('tree');
            }}
            className={`p-2 rounded-xl transition-colors ${
              activeTab === 'tree' ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-white'
            }`}
            title="Project Tree"
          >
            <FolderTree className="w-4 h-4" />
          </button>
        </div>
      ) : (
        /* When Expanded: Full Sidebar Header & Tabs */
        <div className="flex flex-col h-full overflow-hidden">
          {/* Repository Selector Dropdown */}
          <div className="p-3.5 border-b border-white/10 bg-black/20 shrink-0">
            <label className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider block mb-1.5 flex items-center gap-1.5">
              <Database className="w-3.5 h-3.5 text-purple-400" />
              Repository Knowledge Graph
            </label>
            <div className="relative">
              <select
                value={selectedRepo}
                onChange={(e) => onSelectRepo(e.target.value)}
                className="w-full appearance-none pl-3 pr-8 py-1.5 bg-black/60 border border-purple-500/30 rounded-xl text-xs font-mono text-purple-200 focus:outline-none focus:border-purple-400 cursor-pointer truncate"
              >
                <option value="">(All Global Graphs)</option>
                {repos.map((r) => (
                  <option key={r.name} value={r.name}>
                    {r.name} {r.is_indexed ? '✓' : '(unindexed)'}
                  </option>
                ))}
              </select>
              <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-purple-400 text-[10px] pointer-events-none">
                ▼
              </span>
            </div>
          </div>

          {/* Dual Tabs Bar */}
          <div className="flex items-center p-1.5 bg-black/30 border-b border-white/10 shrink-0">
            <button
              onClick={() => setActiveTab('filters')}
              className={`flex-1 flex items-center justify-center gap-2 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                activeTab === 'filters'
                  ? 'bg-white/15 text-white shadow-sm'
                  : 'text-gray-400 hover:text-gray-200 hover:bg-white/5'
              }`}
            >
              <SlidersHorizontal className="w-3.5 h-3.5 text-blue-400" />
              <span>Filters</span>
            </button>
            <button
              onClick={() => setActiveTab('tree')}
              className={`flex-1 flex items-center justify-center gap-2 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                activeTab === 'tree'
                  ? 'bg-white/15 text-white shadow-sm'
                  : 'text-gray-400 hover:text-gray-200 hover:bg-white/5'
              }`}
            >
              <FolderTree className="w-3.5 h-3.5 text-emerald-400" />
              <span>Project Tree</span>
            </button>
          </div>

          {/* Tab 1: Filters */}
          {activeTab === 'filters' ? (
            <div className="flex-1 overflow-y-auto p-3.5 space-y-4 text-xs">
              {/* Search Filter */}
              <div className="space-y-1.5">
                <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider block">
                  Search Symbol
                </span>
                <div className="relative">
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => onChangeSearchQuery(e.target.value)}
                    placeholder="Filter nodes by name..."
                    className="w-full pl-8 pr-7 py-1.5 bg-black/50 border border-white/10 rounded-xl text-xs text-gray-200 placeholder:text-gray-500 focus:outline-none focus:border-blue-500"
                  />
                  <Search className="w-3.5 h-3.5 text-gray-500 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                  {searchQuery && (
                    <button
                      onClick={() => onChangeSearchQuery('')}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-white"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  )}
                </div>
              </div>

              {/* Display & Rendering Settings */}
              <div className="space-y-3 p-3 rounded-xl bg-black/40 border border-white/5">
                <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block">
                  Display & Visual Settings
                </span>

                {/* Edge Thickness */}
                <div className="space-y-1">
                  <div className="flex items-center justify-between text-[10px] text-gray-400">
                    <span>Edge Thickness</span>
                    <span className="font-mono text-blue-300 font-bold">{edgeThickness}px</span>
                  </div>
                  <input
                    type="range"
                    min="1"
                    max="6"
                    step="0.5"
                    value={edgeThickness}
                    onChange={(e) => onChangeEdgeThickness?.(parseFloat(e.target.value))}
                    className="w-full h-1 bg-white/10 rounded-lg appearance-none cursor-pointer accent-blue-500"
                  />
                </div>

                {/* Edge Opacity */}
                <div className="space-y-1">
                  <div className="flex items-center justify-between text-[10px] text-gray-400">
                    <span>Edge Opacity</span>
                    <span className="font-mono text-blue-300 font-bold">{Math.round(edgeOpacity * 100)}%</span>
                  </div>
                  <input
                    type="range"
                    min="0.1"
                    max="1"
                    step="0.05"
                    value={edgeOpacity}
                    onChange={(e) => onChangeEdgeOpacity?.(parseFloat(e.target.value))}
                    className="w-full h-1 bg-white/10 rounded-lg appearance-none cursor-pointer accent-blue-500"
                  />
                </div>

                {/* Node Size */}
                <div className="space-y-1">
                  <div className="flex items-center justify-between text-[10px] text-gray-400">
                    <span>Node Size</span>
                    <span className="font-mono text-purple-300 font-bold">{nodeSize}x</span>
                  </div>
                  <input
                    type="range"
                    min="0.6"
                    max="2.5"
                    step="0.1"
                    value={nodeSize}
                    onChange={(e) => onChangeNodeSize?.(parseFloat(e.target.value))}
                    className="w-full h-1 bg-white/10 rounded-lg appearance-none cursor-pointer accent-purple-500"
                  />
                </div>

                {/* Node Opacity */}
                <div className="space-y-1">
                  <div className="flex items-center justify-between text-[10px] text-gray-400">
                    <span>Node Opacity</span>
                    <span className="font-mono text-purple-300 font-bold">{Math.round(nodeOpacity * 100)}%</span>
                  </div>
                  <input
                    type="range"
                    min="0.2"
                    max="1"
                    step="0.05"
                    value={nodeOpacity}
                    onChange={(e) => onChangeNodeOpacity?.(parseFloat(e.target.value))}
                    className="w-full h-1 bg-white/10 rounded-lg appearance-none cursor-pointer accent-purple-500"
                  />
                </div>
              </div>

              {/* Node Types Section */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">
                    Node Types ({availableLabels.length})
                  </span>
                  <div className="flex items-center gap-1.5 text-[10px]">
                    <button
                      onClick={onSelectAllLabels}
                      className="text-blue-400 hover:underline"
                    >
                      All
                    </button>
                    <span className="text-gray-600">•</span>
                    <button
                      onClick={onClearAllLabels}
                      className="text-gray-400 hover:underline"
                    >
                      None
                    </button>
                  </div>
                </div>

                <div className="flex flex-wrap gap-1.5">
                  {availableLabels.map((label) => {
                    const isSelected = selectedLabels.length === 0 || selectedLabels.includes(label);
                    const color = getNodeColor(label);

                    return (
                      <button
                        key={label}
                        onClick={() => onToggleLabel(label)}
                        className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium border transition-all ${
                          isSelected
                            ? 'bg-white/10 border-white/20 text-white'
                            : 'opacity-35 bg-black/40 border-white/5 text-gray-500'
                        }`}
                      >
                        <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: color }} />
                        <span>{label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Edge Types Section */}
              <div className="space-y-2 pt-2 border-t border-white/5">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">
                    Edge Types ({availableTypes.length})
                  </span>
                  <div className="flex items-center gap-1.5 text-[10px]">
                    <button
                      onClick={onSelectAllEdgeTypes}
                      className="text-blue-400 hover:underline"
                    >
                      All
                    </button>
                    <span className="text-gray-600">•</span>
                    <button
                      onClick={onClearAllEdgeTypes}
                      className="text-gray-400 hover:underline"
                    >
                      None
                    </button>
                  </div>
                </div>

                <div className="flex flex-wrap gap-1.5">
                  {availableTypes.map((type) => {
                    const isSelected = selectedEdgeTypes.length === 0 || selectedEdgeTypes.includes(type);
                    const color = getEdgeColor(type);

                    return (
                      <button
                        key={type}
                        onClick={() => onToggleEdgeType(type)}
                        className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-mono border transition-all ${
                          isSelected
                            ? 'bg-white/10 border-white/20 text-gray-200'
                            : 'opacity-35 bg-black/40 border-white/5 text-gray-500'
                        }`}
                      >
                        <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: color }} />
                        <span>{type}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          ) : (
            /* Tab 2: Interactive Project Tree */
            <div className="flex-1 overflow-hidden">
              <ProjectTreeView
                nodes={data?.nodes || []}
                selectedNode={selectedNode}
                onSelectNode={onSelectNode}
              />
            </div>
          )}
        </div>
      )}
    </aside>
  );
}
