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
import { RepoDetail, ProjectCatalogItem } from '../../types/project';
import { ApiService } from '../../services/api';
import {
  GraphPayload,
  GraphNode,
  GraphEdge,
  AnalysisMode,
  CallFlowResult,
  ImpactResult,
  PathResult,
  FlowResult,
} from '../../types/graph';
import { ArrowLeft, RefreshCw, Loader2, Database, Network, GitBranch } from 'lucide-react';

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


  const [projects, setProjects] = useState<ProjectCatalogItem[]>([]);
  const [currentProjectId, setCurrentProjectId] = useState('');
  const [repos, setRepos] = useState<RepoDetail[]>([]);
  const [selectedRepo, setSelectedRepo] = useState('');
  const [graphScope, setGraphScope] = useState<'ast' | 'cpg'>('ast');
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


  // CPG Analysis & Neighborhood
  const [analysisMode, setAnalysisMode] = useState<AnalysisMode>('explore');
  const [neighborhoodDepth, setNeighborhoodDepth] = useState(1);
  const [neighborhoodInbound, setNeighborhoodInbound] = useState(true);
  const [neighborhoodOutbound, setNeighborhoodOutbound] = useState(true);

  // Analysis Inputs & Results
  const [callFlowDirection, setCallFlowDirection] = useState<'callers' | 'callees' | 'both'>('both');
  const [callFlowDepth, setCallFlowDepth] = useState(3);
  const [callFlowResult, setCallFlowResult] = useState<CallFlowResult | null>(null);
  const [impactResult, setImpactResult] = useState<ImpactResult | null>(null);
  const [flowResult, setFlowResult] = useState<FlowResult | null>(null);
  const [pathResult, setPathResult] = useState<PathResult | null>(null);

  const [taintSource, setTaintSource] = useState('');
  const [taintSink, setTaintSink] = useState('');
  const [pathFrom, setPathFrom] = useState('');
  const [pathTo, setPathTo] = useState('');
  const [pathRel, setPathRel] = useState('CALL');

  // Compute active analysis path highlight sets
  const { highlightedNodeIds, highlightedEdgeIds } = useMemo(() => {
    const nodeIds = new Set<string | number>();
    const edgeIds = new Set<string | number>();

    if (callFlowResult) {
      callFlowResult.nodes.forEach((n) => nodeIds.add(n.id));
      callFlowResult.edges.forEach((e) => edgeIds.add(e.id));
    } else if (flowResult) {
      nodeIds.add(flowResult.source.id);
      nodeIds.add(flowResult.sink.id);
      flowResult.steps.forEach((s) => nodeIds.add(s.node.id));
    } else if (impactResult) {
      nodeIds.add(impactResult.target_node.id);
      impactResult.direct_callers.forEach((n) => nodeIds.add(n.id));
      impactResult.indirect_callers.forEach((n) => nodeIds.add(n.id));
      impactResult.edges.forEach((e) => edgeIds.add(e.id));
    } else if (pathResult && pathResult.found) {
      pathResult.nodes.forEach((n) => nodeIds.add(n.id));
      pathResult.edges.forEach((e) => edgeIds.add(e.id));
    }

    return { highlightedNodeIds: nodeIds, highlightedEdgeIds: edgeIds };
  }, [callFlowResult, flowResult, impactResult, pathResult]);

  const handleClearAnalysisPath = useCallback(() => {
    setCallFlowResult(null);
    setFlowResult(null);
    setImpactResult(null);
    setPathResult(null);
    setAnalysisMode('explore');
    showToast('Analysis path cleared', 'info');
  }, [showToast]);

  const handleScopeChange = useCallback((newScope: 'ast' | 'cpg') => {
    setGraphScope(newScope);
    setSelectedNode(null);
    setSelectedEdge(null);
    setSelectedLabels([]);
    setCallFlowResult(null);
    setFlowResult(null);
    setImpactResult(null);
    setPathResult(null);
    setAnalysisMode('explore');
    if (newScope === 'cpg') {
      // Sensible defaults: exclude CFG and DATA_FLOW by default to avoid clutter
      setSelectedEdgeTypes(['CALL', 'REF', 'TYPE', 'IMPORT', 'CONTAINS', 'AST']);
    } else {
      setSelectedEdgeTypes([]);
    }
  }, []);

  const handleTriggerAction = useCallback(
    async (
      action: 'callers' | 'callees' | 'data_flow' | 'control_flow' | 'impact' | 'find_path',
      targetNode: GraphNode
    ) => {
      const repoTarget = targetNode.project || selectedRepo || currentProjectId;
      if (!repoTarget) return;

      try {
        if (action === 'callers' || action === 'callees') {
          const dir = action === 'callers' ? 'callers' : 'callees';
          setAnalysisMode('call_flow');
          setCallFlowDirection(dir);
          const res = await ApiService.getCallFlow({
            repo: repoTarget,
            project: currentProjectId,
            symbol: targetNode.name,
            direction: dir,
            depth: callFlowDepth,
          });
          setCallFlowResult(res);
          showToast(`Traced ${res.nodes.length} ${dir} for ${targetNode.name}`, 'info');
        } else if (action === 'control_flow') {
          setAnalysisMode('control_flow');
          const res = await ApiService.queryCPG({
            repo: repoTarget,
            type: 'cfg',
            symbol: targetNode.name,
          });
          const flow = res.flow as FlowResult | undefined;
          if (flow) {
            setFlowResult(flow);
            showToast(`Traced CFG for ${targetNode.name} (${flow.steps.length} steps)`, 'info');
          } else {
            showToast('No CFG steps found for this node', 'warn');
          }
        } else if (action === 'data_flow') {
          setAnalysisMode('data_flow');
          setTaintSource(targetNode.name);
          const res = await ApiService.queryCPG({
            repo: repoTarget,
            type: 'data_flow',
            source: targetNode.name,
          });
          const flow = res.flow as FlowResult | undefined;
          if (flow) {
            setFlowResult(flow);
            showToast(`Traced data flow from ${targetNode.name} (${flow.steps.length} steps)`, 'info');
          } else {
            showToast('No data flow outgoing from this node', 'warn');
          }
        } else if (action === 'impact') {
          setAnalysisMode('impact');
          const res = await ApiService.getImpactAnalysis({
            repo: repoTarget,
            project: currentProjectId,
            symbol: targetNode.name,
          });
          showToast(`Impact analysis: ${res.direct_count + res.indirect_count} dependents found`, 'info');
        } else if (action === 'find_path') {
          setAnalysisMode('find_path');
          setPathFrom(targetNode.name);
          showToast(`Set '${targetNode.name}' as starting point for path search`, 'info');
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Action failed';
        showToast(msg, 'error');
      }
    },
    [selectedRepo, currentProjectId, callFlowDepth, showToast]
  );

  const handleTraceTaintFlow = useCallback(async () => {
    const repoTarget = selectedRepo || currentProjectId;
    if (!repoTarget || !taintSource.trim()) return;
    try {
      const res = await ApiService.getTaintFlow({
        repo: repoTarget,
        project: currentProjectId,
        source: taintSource.trim(),
        sink: taintSink.trim(),
      });
      showToast(`Taint path traced: ${res.steps.length} step(s)`, 'info');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to trace taint flow';
      showToast(msg, 'error');
    }
  }, [selectedRepo, currentProjectId, taintSource, taintSink, showToast]);

  const handleFindPath = useCallback(async () => {
    const repoTarget = selectedRepo || currentProjectId;
    if (!repoTarget || !pathFrom.trim() || !pathTo.trim()) return;
    try {
      const res = await ApiService.findPath({
        repo: repoTarget,
        project: currentProjectId,
        from: pathFrom.trim(),
        to: pathTo.trim(),
        rel: pathRel,
      });
      if (res.found) {
        showToast(`Path found with ${res.nodes.length} nodes!`, 'success');
      } else {
        showToast('No connecting path found', 'warn');
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Path search failed';
      showToast(msg, 'error');
    }
  }, [selectedRepo, currentProjectId, pathFrom, pathTo, pathRel, showToast]);
  // Loading
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Load project list & overview repos with persistent project selection
  const loadInitialData = useCallback(async () => {
    try {
      setIsLoading(true);
      const projData = await ApiService.getProjects();
      const list = projData.registered_projects || [];
      setProjects(list);

      if (list.length > 0) {
        // Read project from URL query param
        let urlProject = '';
        if (typeof window !== 'undefined') {
          const params = new URLSearchParams(window.location.search);
          urlProject = params.get('project') || '';
        }
        // Read project from localStorage
        const savedProject = (typeof window !== 'undefined' && localStorage.getItem('CB_INDEXER_CURRENT_PROJECT')) || '';
        const targetPreferred = urlProject || savedProject;
        const matched =
          (targetPreferred &&
            list.find(
              (p) =>
                (p.project_id && p.project_id.toLowerCase() === targetPreferred.toLowerCase()) ||
                (p.name && p.name.toLowerCase() === targetPreferred.toLowerCase()) ||
                (p.registry_path && p.registry_path.toLowerCase() === targetPreferred.toLowerCase())
            )) ||
          list[0];

        const pId = matched.project_id || matched.registry_path || '';
        setCurrentProjectId(pId);
        if (typeof window !== 'undefined' && pId) {
          localStorage.setItem('CB_INDEXER_CURRENT_PROJECT', pId);
          const currentUrl = new URL(window.location.href);
          currentUrl.searchParams.set('project', pId);
          window.history.replaceState({}, '', currentUrl.toString());
        }

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


  // Load graph payload from /api/graph (AST or CPG)
  const loadGraph = useCallback(
    async (projectId: string, repoTarget?: string, scope: 'ast' | 'cpg' = 'ast') => {
      if (!projectId) return;
      try {
        setIsLoading(true);
        const payload = await ApiService.getGraph({
          project: projectId,
          repo: repoTarget || undefined,
          scope: scope,
          limit: 350,
        });
        setGraphData(payload);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : `Failed to fetch ${scope.toUpperCase()} graph`;
        showToast(msg, 'error');
      } finally {
        setIsLoading(false);
      }
    },
    [showToast]
  );

  const handleSwitchProject = useCallback(
    async (newProjectId: string) => {
      if (!newProjectId || newProjectId === currentProjectId) return;
      setCurrentProjectId(newProjectId);
      setSelectedRepo('');
      setSelectedNode(null);
      setSelectedEdge(null);
      setCallFlowResult(null);
      setFlowResult(null);
      setImpactResult(null);
      setPathResult(null);

      if (typeof window !== 'undefined') {
        localStorage.setItem('CB_INDEXER_CURRENT_PROJECT', newProjectId);
        const currentUrl = new URL(window.location.href);
        currentUrl.searchParams.set('project', newProjectId);
        window.history.replaceState({}, '', currentUrl.toString());
      }

      try {
        const overview = await ApiService.getOverview(newProjectId);
        setRepos(overview.repos || []);
        await loadGraph(newProjectId, '', graphScope);
        showToast(`Switched to project '${newProjectId}'`, 'info');
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Failed to switch project';
        showToast(msg, 'error');
      }
    },
    [currentProjectId, graphScope, loadGraph, showToast]
  );

  useEffect(() => {
    loadInitialData();
  }, [loadInitialData]);

  useEffect(() => {
    if (currentProjectId) {
      loadGraph(currentProjectId, selectedRepo, graphScope);
    }
  }, [currentProjectId, selectedRepo, graphScope, loadGraph]);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await loadGraph(currentProjectId, selectedRepo, graphScope);
    setIsRefreshing(false);
    showToast(`${graphScope === 'cpg' ? 'CPG' : 'AST'} knowledge graph refreshed`, 'info');
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
            href={`/?project=${encodeURIComponent(currentProjectId)}`}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-xs font-medium text-gray-300 hover:text-white transition-all active:scale-95"
            title="Return to Main Dashboard"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Dashboard</span>
          </Link>

          <div className="h-4 w-[1px] bg-white/10" />
          <div className="flex items-center gap-2">
            <h1 className="text-sm font-bold tracking-tight text-white flex items-center gap-2">
              <span>{graphScope === 'cpg' ? 'Code Property Graph (CPG) Explorer' : 'AST Knowledge Graph Explorer'}</span>
              <span
                className={`text-[10px] uppercase font-mono px-1.5 py-0.2 rounded border ${
                  graphScope === 'cpg'
                    ? 'bg-cyan-500/10 text-cyan-300 border-cyan-500/20'
                    : 'bg-purple-500/10 text-purple-300 border-purple-500/20'
                }`}
              >
                {graphScope === 'cpg' ? 'Joern CPG' : 'Code Intelligence'}
              </span>
            </h1>
          </div>
        </div>

        {/* Graph Type Switcher: AST vs CPG */}
        <div className="flex items-center p-0.5 rounded-xl bg-white/5 border border-white/10 text-xs font-mono">
          <button
            onClick={() => handleScopeChange('ast')}
            className={`flex items-center gap-1.5 px-3 py-1 rounded-lg font-medium transition-all ${
              graphScope === 'ast'
                ? 'bg-purple-600/30 text-purple-200 border border-purple-500/40 shadow-sm'
                : 'text-gray-400 hover:text-white'
            }`}
            title="Tree-sitter Abstract Syntax Tree (AST)"
          >
            <GitBranch className="w-3.5 h-3.5" />
            <span>AST</span>
          </button>
          <button
            onClick={() => handleScopeChange('cpg')}
            className={`flex items-center gap-1.5 px-3 py-1 rounded-lg font-medium transition-all ${
              graphScope === 'cpg'
                ? 'bg-cyan-600/30 text-cyan-200 border border-cyan-500/40 shadow-sm'
                : 'text-gray-400 hover:text-white'
            }`}
            title="Joern Code Property Graph (CPG)"
          >
            <Network className="w-3.5 h-3.5" />
            <span>CPG</span>
          </button>
        </div>

        <div className="flex items-center gap-3">
          {/* Active project & graph stats */}
          <div className="hidden sm:flex items-center gap-2 text-xs font-mono">
            {/* Interactive Project Switcher in /graph */}
            {projects.length > 1 ? (
              <div className="relative">
                <select
                  value={currentProjectId}
                  onChange={(e) => handleSwitchProject(e.target.value)}
                  className="appearance-none pl-7 pr-6 py-1 rounded-lg bg-blue-500/10 hover:bg-blue-500/20 border border-blue-500/20 text-blue-300 text-xs font-mono font-medium focus:outline-none focus:border-blue-400 cursor-pointer max-w-[190px] truncate"
                  title="Switch Active Project"
                >
                  {projects.map((p) => {
                    const pId = p.project_id || p.registry_path || '';
                    return (
                      <option key={pId} value={pId} className="bg-gray-900 text-white font-mono">
                        {p.name || pId} ({p.total_repos ?? 0} repos)
                      </option>
                    );
                  })}
                </select>
                <Database className="w-3 h-3 text-blue-400 absolute left-2 top-1/2 -translate-y-1/2 pointer-events-none" />
                <span className="absolute right-2 top-1/2 -translate-y-1/2 text-blue-400 text-[9px] pointer-events-none">
                  ▼
                </span>
              </div>
            ) : (
              <span className="px-2.5 py-1 rounded-lg bg-blue-500/10 border border-blue-500/20 text-blue-300 flex items-center gap-1.5">
                <Database className="w-3 h-3 text-blue-400" />
                <span>{selectedRepo || currentProjectId || 'Global'}</span>
              </span>
            )}

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
          graphScope={graphScope}
          onChangeGraphScope={handleScopeChange}
          analysisMode={analysisMode}
          onChangeAnalysisMode={setAnalysisMode}
          neighborhoodDepth={neighborhoodDepth}
          onChangeNeighborhoodDepth={setNeighborhoodDepth}
          neighborhoodInbound={neighborhoodInbound}
          onChangeNeighborhoodInbound={setNeighborhoodInbound}
          neighborhoodOutbound={neighborhoodOutbound}
          onChangeNeighborhoodOutbound={setNeighborhoodOutbound}
          callFlowDirection={callFlowDirection}
          onChangeCallFlowDirection={setCallFlowDirection}
          callFlowDepth={callFlowDepth}
          onChangeCallFlowDepth={setCallFlowDepth}
          taintSource={taintSource}
          onChangeTaintSource={setTaintSource}
          taintSink={taintSink}
          onChangeTaintSink={setTaintSink}
          onTraceTaintFlow={handleTraceTaintFlow}
          pathFrom={pathFrom}
          onChangePathFrom={setPathFrom}
          pathTo={pathTo}
          onChangePathTo={setPathTo}
          pathRel={pathRel}
          onChangePathRel={setPathRel}
          onFindPath={handleFindPath}
          hasActiveAnalysisPath={Boolean(callFlowResult || flowResult || impactResult || (pathResult && pathResult.found))}
          onClearAnalysisPath={handleClearAnalysisPath}
        />

        {/* Center Canvas */}
        <main className="flex-1 relative h-full w-full overflow-hidden bg-black/40">
          {isLoading ? (
            <div className="w-full h-full flex flex-col items-center justify-center gap-3 text-xs text-gray-400">
              <Loader2 className={`w-7 h-7 animate-spin ${graphScope === 'cpg' ? 'text-cyan-400' : 'text-purple-400'}`} />
              <span>Loading {graphScope === 'cpg' ? 'Joern Code Property Graph (CPG)...' : 'AST Knowledge Graph...'}</span>
            </div>
          ) : !graphData || graphData.nodes.length === 0 ? (
            <div className="w-full h-full flex flex-col items-center justify-center gap-2 text-xs text-gray-400 p-6 text-center">
              <p className="font-semibold text-gray-300">
                {graphScope === 'cpg' ? 'No Code Property Graph Found' : 'No AST Knowledge Graph Found'}
              </p>
              <p className="text-[11px] text-gray-500 max-w-sm">
                {graphScope === 'cpg'
                  ? 'Trigger CPG indexing via the dashboard or CLI `cb-indexer index -engine cpg` to generate CPG graphs.'
                  : 'Make sure the repository has been indexed via codebase-memory-mcp.'}
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
                  highlightedNodeIds={highlightedNodeIds}
                  highlightedEdgeIds={highlightedEdgeIds}
                  neighborhoodDepth={neighborhoodDepth}
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
                  highlightedNodeIds={highlightedNodeIds}
                  highlightedEdgeIds={highlightedEdgeIds}
                  neighborhoodDepth={neighborhoodDepth}
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
                  graphScope={graphScope}
                  analysisMode={analysisMode}
                  onTriggerAction={handleTriggerAction}
                  callFlowResult={callFlowResult}
                  impactResult={impactResult}
                  flowResult={flowResult}
                  pathResult={pathResult}
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
