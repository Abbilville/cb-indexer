'use client';

import React, { useState, useMemo } from 'react';
import { ViewMode, GraphScope, GraphPayload, GraphNode, GraphEdge } from '../../types/graph';
import { RepoDetail } from '../../types/project';
import { GraphFilterBar } from './GraphFilterBar';
import dynamic from 'next/dynamic';

const Graph2DView = dynamic(
  () => import('./Graph2DView').then((mod) => mod.Graph2DView),
  {
    ssr: false,
    loading: () => (
      <div className="w-full h-[550px] flex items-center justify-center bg-black/40 text-xs text-gray-400">
        Loading 2D Engine...
      </div>
    ),
  }
);

const Graph3DView = dynamic(
  () => import('./Graph3DView').then((mod) => mod.Graph3DView),
  {
    ssr: false,
    loading: () => (
      <div className="w-full h-[550px] flex items-center justify-center bg-black/40 text-xs text-gray-400">
        Loading 3D WebGL Galaxy...
      </div>
    ),
  }
);
import { TopologySVGView } from './TopologySVGView';
import { NodeInspector } from './NodeInspector';
import { EdgeInspector } from './EdgeInspector';
import { Loader2 } from 'lucide-react';

interface GraphContainerProps {
  data: GraphPayload | null;
  loading: boolean;
  scope: GraphScope;
  onChangeScope: (scope: GraphScope) => void;
  repos: RepoDetail[];
  selectedRepo: string;
  onSelectRepo: (repo: string) => void;
  projectId: string;
}

export function GraphContainer({
  data,
  loading,
  scope,
  onChangeScope,
  repos,
  selectedRepo,
  onSelectRepo,
  projectId,
}: GraphContainerProps) {
  const [viewMode, setViewMode] = useState<ViewMode>('3d');
  const [selectedLabels, setSelectedLabels] = useState<string[]>([]);
  const [selectedEdgeTypes, setSelectedEdgeTypes] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [selectedEdge, setSelectedEdge] = useState<GraphEdge | null>(null);

  // Available labels & edge types discovered from backend payload
  const availableLabels = data?.available_labels || [];
  const availableTypes = data?.available_types || [];

  // Toggle label filter pill
  const handleToggleLabel = (label: string) => {
    setSelectedLabels((prev) => {
      if (prev.length === 0) {
        // If none currently selected, selecting one means filter exclusively to all others except this, or toggle
        return availableLabels.filter((l) => l !== label);
      }
      if (prev.includes(label)) {
        return prev.filter((l) => l !== label);
      }
      return [...prev, label];
    });
  };

  // Toggle edge type filter pill
  const handleToggleEdgeType = (type: string) => {
    setSelectedEdgeTypes((prev) => {
      if (prev.length === 0) {
        return availableTypes.filter((t) => t !== type);
      }
      if (prev.includes(type)) {
        return prev.filter((t) => t !== type);
      }
      return [...prev, type];
    });
  };

  // Find node ID matching search query
  const searchFocusId = useMemo(() => {
    if (!searchQuery.trim() || !data) return undefined;
    const q = searchQuery.toLowerCase();
    const matched = data.nodes.find(
      (n) =>
        n.name.toLowerCase().includes(q) ||
        n.qualified_name.toLowerCase().includes(q) ||
        (n.file_path && n.file_path.toLowerCase().includes(q))
    );
    return matched ? matched.id : undefined;
  }, [searchQuery, data]);

  return (
    <section className="flex flex-col gap-3 p-4 sm:p-5 bg-gray-900/60 border border-white/10 rounded-2xl shadow-lg backdrop-blur-md">
      {/* Filter and Control Bar */}
      <GraphFilterBar
        viewMode={viewMode}
        onChangeViewMode={(mode) => {
          setViewMode(mode);
          setSelectedNode(null);
          setSelectedEdge(null);
        }}
        scope={scope}
        onChangeScope={(s) => {
          onChangeScope(s);
          setSelectedNode(null);
          setSelectedEdge(null);
        }}
        repos={repos}
        selectedRepo={selectedRepo}
        onSelectRepo={onSelectRepo}
        availableLabels={availableLabels}
        selectedLabels={selectedLabels}
        onToggleLabel={handleToggleLabel}
        availableTypes={availableTypes}
        selectedEdgeTypes={selectedEdgeTypes}
        onToggleEdgeType={handleToggleEdgeType}
        searchQuery={searchQuery}
        onChangeSearchQuery={setSearchQuery}
      />

      {/* Canvas Viewport Area */}
      <div className="relative w-full overflow-hidden rounded-2xl">
        {loading ? (
          <div className="w-full h-[550px] flex flex-col items-center justify-center gap-3 bg-black/40 border border-white/5 rounded-2xl text-xs text-gray-400">
            <Loader2 className="w-6 h-6 animate-spin text-blue-400" />
            <span>Loading Knowledge Graph...</span>
          </div>
        ) : !data || data.nodes.length === 0 ? (
          <div className="w-full h-[550px] flex flex-col items-center justify-center gap-2 bg-black/40 border border-white/5 rounded-2xl text-xs text-gray-400">
            <p className="font-semibold text-gray-300">No Graph Data Available</p>
            <p className="text-[11px] text-gray-500">
              Run a workspace scan or re-index your repositories to generate the knowledge graph.
            </p>
          </div>
        ) : (
          <>
            {/* Strategy: 2D Force View */}
            {viewMode === '2d' && (
              <Graph2DView
                data={data}
                selectedNode={selectedNode}
                selectedEdge={selectedEdge}
                onSelectNode={(node) => {
                  setSelectedNode(node);
                  setSelectedEdge(null);
                }}
                onSelectEdge={(edge) => {
                  setSelectedEdge(edge);
                  setSelectedNode(null);
                }}
                filterLabels={selectedLabels}
                filterEdgeTypes={selectedEdgeTypes}
                searchFocusId={searchFocusId}
              />
            )}

            {/* Strategy: 3D Galaxy View */}
            {viewMode === '3d' && (
              <Graph3DView
                data={data}
                selectedNode={selectedNode}
                selectedEdge={selectedEdge}
                onSelectNode={(node) => {
                  setSelectedNode(node);
                  setSelectedEdge(null);
                }}
                onSelectEdge={(edge) => {
                  setSelectedEdge(edge);
                  setSelectedNode(null);
                }}
                filterLabels={selectedLabels}
                filterEdgeTypes={selectedEdgeTypes}
                searchFocusId={searchFocusId}
              />
            )}

            {/* Strategy: Whiteboard Topology SVG View */}
            {viewMode === 'whiteboard' && (
              <TopologySVGView
                data={data}
                selectedNode={selectedNode}
                selectedEdge={selectedEdge}
                onSelectNode={(node) => {
                  setSelectedNode(node);
                  setSelectedEdge(null);
                }}
                onSelectEdge={(edge) => {
                  setSelectedEdge(edge);
                  setSelectedNode(null);
                }}
                filterLabels={selectedLabels}
                filterEdgeTypes={selectedEdgeTypes}
                searchFocusId={searchFocusId}
              />
            )}

            {/* Floating Node Inspector */}
            {selectedNode && (
              <NodeInspector
                node={selectedNode}
                links={data.links}
                projectId={projectId}
                onClose={() => setSelectedNode(null)}
                onSelectNode={setSelectedNode}
              />
            )}

            {/* Floating Edge Inspector */}
            {selectedEdge && (
              <EdgeInspector
                edge={selectedEdge}
                onClose={() => setSelectedEdge(null)}
              />
            )}
          </>
        )}
      </div>
    </section>
  );
}
