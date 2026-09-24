'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { ToastProvider, useToast } from '../../components/ui/Toast';
import { AstSidebar } from '../../components/ast/AstSidebar';
import { FloatingControls, AstViewMode } from '../../components/ast/FloatingControls';
import { FloatingLegend } from '../../components/ast/FloatingLegend';
import { NodeInspector } from '../../components/graph/NodeInspector';
import { EdgeInspector } from '../../components/graph/EdgeInspector';
import { RepoDetail } from '../../types/project';
import { ApiService } from '../../services/api';
import { GraphPayload, GraphNode, GraphEdge } from '../../types/graph';
import { ArrowLeft, RefreshCw, Loader2, Database } from 'lucide-react';

const Graph2DView = dynamic(
  () => import('../../components/graph/Graph2DView').then((mod) => mod.Graph2DView),
  {
    ssr: false,
    loading: () => (
      <div className="w-full h-full flex items-center justify-center bg-black/40 text-xs text-gray-400">
        Loading 2D Engine...
      </div>
    ),
  }
);

const Graph3DView = dynamic(
  () => import('../../components/graph/Graph3DView').then((mod) => mod.Graph3DView),
  {
    ssr: false,
    loading: () => (
      <div className="w-full h-full flex items-center justify-center bg-black/40 text-xs text-gray-400">
        Loading 3D WebGL Galaxy...
      </div>
    ),
  }
);

import { TreeFlowchartView } from '../../components/ast/TreeFlowchartView';

function AstExplorerContent() {
  const { showToast } = useToast();


  const [currentProjectId, setCurrentProjectId] = useState('');
  const [repos, setRepos] = useState<RepoDetail[]>([]);
  const [selectedRepo, setSelectedRepo] = useState('');
  const [graphData, setGraphData] = useState<GraphPayload | null>(null);
  const [viewMode, setViewMode] = useState<AstViewMode>('3d');
  const [showLegend, setShowLegend] = useState(false);
  const [edgeThickness, setEdgeThickness] = useState(1);
  const [edgeOpacity, setEdgeOpacity] = useState(0.75);
  const [nodeSize, setNodeSize] = useState(1.0);
  const [nodeOpacity, setNodeOpacity] = useState(1.0);
  // Filters
  const [selectedLabels, setSelectedLabels] = useState<string[]>([]);
  const [selectedEdgeTypes, setSelectedEdgeTypes] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState('');

  // Selection
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [selectedEdge, setSelectedEdge] = useState<GraphEdge | null>(null);

  // Loading
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Load project list & overview repos
  const loadInitialData = useCallback(async () => {
    try {
      setIsLoading(true);
      const projData = await ApiService.getProjects();
      const list = projData.registered_projects || [];


      if (list.length > 0) {
        const pId = list[0].project_id || list[0].registry_path || '';
        setCurrentProjectId(pId);
        const overview = await ApiService.getOverview(pId);
        setRepos(overview.repos || []);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to initialize AST explorer';
      showToast(msg, 'error');
    } finally {
      setIsLoading(false);
    }
  }, [showToast]);

  // Load AST graph payload from /api/graph
  const loadAstGraph = useCallback(
    async (projectId: string, repoTarget?: string) => {
      if (!projectId) return;
      try {
        setIsLoading(true);
        const payload = await ApiService.getGraph({
          project: projectId,
          repo: repoTarget || undefined,
          scope: 'ast',
          limit: 350,
        });
        setGraphData(payload);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Failed to fetch AST graph';
        showToast(msg, 'error');
      } finally {
        setIsLoading(false);
      }
    },
    [showToast]
  );

  useEffect(() => {
    loadInitialData();
  }, [loadInitialData]);

  useEffect(() => {
    if (currentProjectId) {
      loadAstGraph(currentProjectId, selectedRepo);
    }
  }, [currentProjectId, selectedRepo, loadAstGraph]);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await loadAstGraph(currentProjectId, selectedRepo);
    setIsRefreshing(false);
    showToast('Knowledge graph refreshed', 'info');
  };

  // Label filter toggle
  const handleToggleLabel = (label: string) => {
    const all = graphData?.available_labels || [];
    setSelectedLabels((prev) => {
      if (prev.length === 0) {
        return all.filter((l) => l !== label);
      }
      if (prev.includes(label)) {
        return prev.filter((l) => l !== label);
      }
      return [...prev, label];
    });
  };

  // Edge type filter toggle
  const handleToggleEdgeType = (type: string) => {
    const all = graphData?.available_types || [];
    setSelectedEdgeTypes((prev) => {
      if (prev.length === 0) {
        return all.filter((t) => t !== type);
      }
      if (prev.includes(type)) {
        return prev.filter((t) => t !== type);
      }
      return [...prev, type];
    });
  };

  // Search focus matching
  const searchFocusId = useMemo(() => {
    if (!searchQuery.trim() || !graphData) return undefined;
    const q = searchQuery.toLowerCase();
    const matched = graphData.nodes.find(
      (n) =>
        n.name.toLowerCase().includes(q) ||
        n.qualified_name.toLowerCase().includes(q) ||
        (n.file_path && n.file_path.toLowerCase().includes(q))
    );
    return matched ? matched.id : undefined;
  }, [searchQuery, graphData]);

  return (
    <div className="h-screen w-screen flex flex-col bg-[#090d16] text-gray-100 overflow-hidden">
      {/* Top Header Bar */}
      <header className="flex items-center justify-between px-4 py-2.5 bg-gray-950/90 border-b border-white/10 z-30 shrink-0">
        <div className="flex items-center gap-3">
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-xs font-medium text-gray-300 hover:text-white transition-all active:scale-95"
            title="Return to Main Dashboard"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Dashboard</span>
          </Link>

          <div className="h-4 w-[1px] bg-white/10" />

          <div className="flex items-center gap-2">
            <h1 className="text-sm font-bold tracking-tight text-white flex items-center gap-2">
              <span>AST Knowledge Graph Explorer</span>
              <span className="text-[10px] uppercase font-mono px-1.5 py-0.2 rounded bg-purple-500/10 text-purple-300 border border-purple-500/20">
                Code Intelligence
              </span>
            </h1>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {/* Active project & graph stats */}
          <div className="hidden sm:flex items-center gap-2 text-xs font-mono">
            <span className="px-2.5 py-1 rounded-lg bg-blue-500/10 border border-blue-500/20 text-blue-300 flex items-center gap-1.5">
              <Database className="w-3 h-3 text-blue-400" />
              <span>{selectedRepo || currentProjectId || 'Global'}</span>
            </span>

            {graphData && (
              <span className="text-gray-400 text-[11px]">
                <strong className="text-gray-200">{graphData.returned_nodes}</strong> nodes •{' '}
                <strong className="text-gray-200">{graphData.returned_edges}</strong> links
              </span>
            )}
          </div>

          {/* Refresh Button */}
          <button
            onClick={handleRefresh}
            disabled={isRefreshing}
            className="p-1.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-gray-300 hover:text-white transition-colors"
            title="Refresh Knowledge Graph"
          >
            <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin text-blue-400' : ''}`} />
          </button>
        </div>
      </header>

      {/* Main Split Layout: Sidebar + Canvas Area */}
      <div className="flex-1 flex min-h-0 relative overflow-hidden">
        {/* Left Sidebar (Filters + Project Tree) */}
        <AstSidebar
          data={graphData}
          repos={repos}
          selectedRepo={selectedRepo}
          onSelectRepo={setSelectedRepo}
          selectedLabels={selectedLabels}
          onToggleLabel={handleToggleLabel}
          onSelectAllLabels={() => setSelectedLabels([])}
          onClearAllLabels={() => setSelectedLabels(['__NONE__'])}
          selectedEdgeTypes={selectedEdgeTypes}
          onToggleEdgeType={handleToggleEdgeType}
          onSelectAllEdgeTypes={() => setSelectedEdgeTypes([])}
          onClearAllEdgeTypes={() => setSelectedEdgeTypes(['__NONE__'])}
          searchQuery={searchQuery}
          onChangeSearchQuery={setSearchQuery}
          selectedNode={selectedNode}
          onSelectNode={(n) => {
            setSelectedNode(n);
            setSelectedEdge(null);
          }}
          onClearSelectedNode={() => setSelectedNode(null)}
          edgeThickness={edgeThickness}
          onChangeEdgeThickness={setEdgeThickness}
          edgeOpacity={edgeOpacity}
          onChangeEdgeOpacity={setEdgeOpacity}
          nodeSize={nodeSize}
          onChangeNodeSize={setNodeSize}
          nodeOpacity={nodeOpacity}
          onChangeNodeOpacity={setNodeOpacity}
        />

        {/* Center Canvas */}
        <main className="flex-1 relative h-full w-full overflow-hidden bg-black/40">
          {isLoading ? (
            <div className="w-full h-full flex flex-col items-center justify-center gap-3 text-xs text-gray-400">
              <Loader2 className="w-7 h-7 animate-spin text-purple-400" />
              <span>Loading AST Knowledge Graph...</span>
            </div>
          ) : !graphData || graphData.nodes.length === 0 ? (
            <div className="w-full h-full flex flex-col items-center justify-center gap-2 text-xs text-gray-400 p-6 text-center">
              <p className="font-semibold text-gray-300">No AST Knowledge Graph Found</p>
              <p className="text-[11px] text-gray-500 max-w-sm">
                Make sure the repository has been indexed via <code className="text-gray-300">codebase-memory-mcp</code>.
              </p>
            </div>
          ) : (
            <>
              {/* 3D Galaxy View */}
              {viewMode === '3d' && (
                <Graph3DView
                  data={graphData}
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
                  edgeThickness={edgeThickness}
                  edgeOpacity={edgeOpacity}
                  nodeSize={nodeSize}
                  nodeOpacity={nodeOpacity}
                />
              )}

              {/* 2D Network View */}
              {viewMode === '2d' && (
                <Graph2DView
                  data={graphData}
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
                  edgeThickness={edgeThickness}
                  edgeOpacity={edgeOpacity}
                  nodeSize={nodeSize}
                  nodeOpacity={nodeOpacity}
                />
              )}

              {/* Tree Flowchart View */}
              {viewMode === 'tree' && (
                <TreeFlowchartView
                  data={graphData}
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

              {/* Floating Controls in Top Right */}
              <FloatingControls
                viewMode={viewMode}
                onChangeViewMode={(m) => {
                  setViewMode(m);
                  setSelectedNode(null);
                  setSelectedEdge(null);
                }}
                showLegend={showLegend}
                onToggleLegend={() => setShowLegend(!showLegend)}
              />

              {/* Floating Legend */}
              {showLegend && (
                <FloatingLegend
                  availableLabels={graphData.available_labels || []}
                  availableTypes={graphData.available_types || []}
                  onClose={() => setShowLegend(false)}
                />
              )}

              {/* Selected Node Inspector Drawer */}
              {selectedNode && (
                <NodeInspector
                  node={selectedNode}
                  links={graphData.links}
                  nodes={graphData.nodes}
                  projectId={currentProjectId}
                  onClose={() => setSelectedNode(null)}
                  onSelectNode={setSelectedNode}
                />
              )}

              {/* Selected Edge Inspector Drawer */}
              {selectedEdge && (
                <EdgeInspector
                  edge={selectedEdge}
                  onClose={() => setSelectedEdge(null)}
                />
              )}
            </>
          )}
        </main>
      </div>
    </div>
  );
}

export default function AstExplorerPage() {
  return (
    <ToastProvider>
      <AstExplorerContent />
    </ToastProvider>
  );
}
