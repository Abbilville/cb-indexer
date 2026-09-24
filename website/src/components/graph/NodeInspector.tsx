'use client';

import React, { useState, useMemo, useEffect } from 'react';
import {
  GraphNode,
  GraphEdge,
  AnalysisMode,
  CallFlowResult,
  ImpactResult,
  PathResult,
  FlowResult,
} from '../../types/graph';
import { getNodeColor, getEdgeColor } from './utils';
import { ApiService } from '../../services/api';
import { useToast } from '../ui/Toast';
import {
  X,
  FileCode,
  ArrowUpRight,
  ArrowDownLeft,
  Loader2,
  ChevronRight,
  Compass,
  Route,
  ShieldAlert,
} from 'lucide-react';

interface NodeInspectorProps {
  node: GraphNode | null;
  links: GraphEdge[];
  nodes?: GraphNode[];
  projectId: string;
  onClose: () => void;
  onSelectNode: (node: GraphNode | null) => void;
  graphScope?: 'ast' | 'cpg';
  analysisMode?: AnalysisMode;
  onTriggerAction?: (action: 'callers' | 'callees' | 'data_flow' | 'control_flow' | 'impact' | 'find_path', node: GraphNode) => void;
  callFlowResult?: CallFlowResult | null;
  impactResult?: ImpactResult | null;
  flowResult?: FlowResult | null;
  pathResult?: PathResult | null;
}

interface ConnectedNeighbor {
  linkId: string | number;
  edgeType: string;
  nodeId: string | number;
  nodeName: string;
  nodeLabel: string;
  targetNode: GraphNode;
}

export function NodeInspector({
  node,
  links,
  nodes = [],
  projectId,
  onClose,
  onSelectNode,
  graphScope = 'ast',
  analysisMode = 'explore',
  onTriggerAction,
  callFlowResult,
  impactResult,
  flowResult,
  pathResult,
}: NodeInspectorProps) {
  const { showToast } = useToast();
  const [snippet, setSnippet] = useState<string | null>(null);
  const [snippetStartLine, setSnippetStartLine] = useState<number>(1);
  const [isLoadingSnippet, setIsLoadingSnippet] = useState(false);
  const [activeConnTab, setActiveConnTab] = useState<'inbound' | 'outbound'>('inbound');

  // Map line numbers to graph nodes in this file for clickable line navigation
  const nodesByLine = useMemo(() => {
    const map = new Map<number, GraphNode[]>();
    if (!node?.file_path || !nodes) return map;
    const targetFile = node.file_path.toLowerCase();
    nodes.forEach((n) => {
      if (n.file_path && n.file_path.toLowerCase() === targetFile && n.start_line) {
        const list = map.get(n.start_line) || [];
        list.push(n);
        map.set(n.start_line, list);
      }
    });
    return map;
  }, [node?.file_path, nodes]);

  // Automatically fetch code context whenever the selected node changes
  useEffect(() => {
    if (!node?.file_path) {
      setSnippet(null);
      return;
    }

    let isCancelled = false;
    const fetchSnippet = async () => {
      try {
        setIsLoadingSnippet(true);
        const start = Math.max(1, (node.start_line || 1) - 4);
        const end = Math.max(start + 12, (node.end_line || node.start_line || 1) + 6);
        const res = await ApiService.getCodeContext({
          project: projectId,
          repo: node.project || projectId,
          file: node.file_path as string,
          start,
          end,
          padding: 0,
        });
        if (!isCancelled) {
          setSnippet(res.context.snippet);
          setSnippetStartLine(res.context.start_line || start);
        }
      } catch {
        if (!isCancelled) {
          setSnippet(null);
        }
      } finally {
        if (!isCancelled) {
          setIsLoadingSnippet(false);
        }
      }
    };

    fetchSnippet();
    return () => {
      isCancelled = true;
    };
  }, [node?.id, node?.file_path, node?.start_line, node?.end_line, node?.project, projectId]);

  // Fast lookup map for resolving neighbor nodes from link IDs
  const nodeMap = useMemo(() => {
    const map = new Map<string, GraphNode>();
    nodes.forEach((n) => {
      map.set(String(n.id), n);
    });
    return map;
  }, [nodes]);

  // Compute actual inbound and outbound neighbor lists
  const { inboundNeighbors, outboundNeighbors } = useMemo(() => {
    const inList: ConnectedNeighbor[] = [];
    const outList: ConnectedNeighbor[] = [];

    if (!node) return { inboundNeighbors: inList, outboundNeighbors: outList };
    const currentNodeId = String(node.id);

    links.forEach((l) => {
      // Resolve source & target whether they are objects or primitive IDs
      const rawSrc = l.source;
      const rawDst = l.target;

      const srcId = typeof rawSrc === 'object' && rawSrc !== null ? String(rawSrc.id) : String(rawSrc);
      const dstId = typeof rawDst === 'object' && rawDst !== null ? String(rawDst.id) : String(rawDst);

      const srcNode = typeof rawSrc === 'object' && rawSrc !== null ? (rawSrc as GraphNode) : nodeMap.get(srcId);
      const dstNode = typeof rawDst === 'object' && rawDst !== null ? (rawDst as GraphNode) : nodeMap.get(dstId);

      // Inbound: edge points into this node
      if (dstId === currentNodeId && srcId !== currentNodeId) {
        const name = srcNode ? (srcNode.name || srcNode.qualified_name || `Node #${srcId}`) : `Node #${srcId}`;
        const label = srcNode ? srcNode.label : 'Symbol';
        inList.push({
          linkId: l.id,
          edgeType: l.type,
          nodeId: srcId,
          nodeName: name,
          nodeLabel: label,
          targetNode: srcNode || {
            id: srcId,
            name,
            label,
            qualified_name: name,
            project: node.project,
          },
        });
      }

      // Outbound: edge points out of this node
      if (srcId === currentNodeId && dstId !== currentNodeId) {
        const name = dstNode ? (dstNode.name || dstNode.qualified_name || `Node #${dstId}`) : `Node #${dstId}`;
        const label = dstNode ? dstNode.label : 'Symbol';
        outList.push({
          linkId: l.id,
          edgeType: l.type,
          nodeId: dstId,
          nodeName: name,
          nodeLabel: label,
          targetNode: dstNode || {
            id: dstId,
            name,
            label,
            qualified_name: name,
            project: node.project,
          },
        });
      }
    });

    return { inboundNeighbors: inList, outboundNeighbors: outList };
  }, [node, links, nodeMap]);

  if (!node) return null;

  const color = getNodeColor(node.label);

  const handleFetchSnippet = async () => {
    if (!node.file_path) return;
    try {
      setIsLoadingSnippet(true);
      const res = await ApiService.getCodeContext({
        project: projectId,
        repo: node.project || projectId,
        file: node.file_path,
        start: node.start_line || 1,
        end: node.end_line || 30,
        padding: 4,
      });

      setSnippet(res.context.snippet);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to load source snippet';
      showToast(msg, 'error');
    } finally {
      setIsLoadingSnippet(false);
    }
  };

  const activeList = activeConnTab === 'inbound' ? inboundNeighbors : outboundNeighbors;

  return (
    <div className="absolute top-4 right-4 z-30 w-84 sm:w-96 max-h-[88%] flex flex-col p-4 rounded-2xl bg-gray-950/95 border border-white/15 shadow-2xl backdrop-blur-xl animate-in slide-in-from-right-4 overflow-hidden">
      {/* Header */}
      <div className="flex items-start justify-between gap-2 pb-3 border-b border-white/10 shrink-0">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <span
              className="w-2.5 h-2.5 rounded-full shrink-0"
              style={{ backgroundColor: color }}
            />
            <span className="text-[10px] uppercase font-mono tracking-wider px-2 py-0.5 rounded bg-white/10 text-gray-200">
              {node.label}
            </span>
            {Boolean(node.properties?.ast_correlated) && (
              <span className="text-[9px] uppercase font-mono px-1.5 py-0.5 rounded bg-purple-500/20 text-purple-300 border border-purple-500/30" title="Correlated with Tree-sitter AST Node">
                AST #{String(node.properties?.ast_node_id)}
              </span>
            )}
            {Boolean(node.properties?.language) && (
              <span className="text-[9px] uppercase font-mono px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-300 border border-blue-500/20">
                {String(node.properties?.language)}
              </span>
            )}
            <span className="text-[10px] text-gray-500 font-mono">#{node.id}</span>
          </div>

          <h3 className="text-sm font-bold text-white font-mono break-all leading-snug">
            {node.name || node.qualified_name}
          </h3>
        </div>

        <button
          onClick={onClose}
          className="text-gray-400 hover:text-white p-1 rounded-lg hover:bg-white/10 transition-colors shrink-0"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto py-3 space-y-3.5 pr-1 text-xs">
        {/* Full qualified name */}
        {node.qualified_name && node.qualified_name !== node.name && (
          <div>
            <span className="text-[10px] text-gray-500 font-semibold uppercase tracking-wider block mb-0.5">
              Qualified Name
            </span>
            <span className="font-mono text-gray-300 text-[11px] break-all bg-black/40 px-2 py-1 rounded block">
              {node.qualified_name}
            </span>
          </div>
        )}

        {/* File Path & Line Numbers */}
        {node.file_path && (
          <div>
            <span className="text-[10px] text-gray-500 font-semibold uppercase tracking-wider block mb-0.5">
              Location
            </span>
            <div className="flex items-center justify-between gap-2 bg-black/40 px-2.5 py-1.5 rounded-xl border border-white/5">
              <span className="font-mono text-[11px] text-gray-300 truncate" title={node.file_path}>
                {node.file_path}
                {node.start_line ? `:${node.start_line}` : ''}
                {Boolean(node.properties?.column) ? `:${String(node.properties?.column)}` : ''}
              </span>
              <button
                onClick={handleFetchSnippet}
                disabled={isLoadingSnippet}
                className="inline-flex items-center gap-1 text-[10px] px-2 py-1 rounded bg-blue-500/10 hover:bg-blue-500/20 text-blue-300 border border-blue-500/20 font-medium transition-all shrink-0 active:scale-95"
              >
                {isLoadingSnippet ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : (
                  <FileCode className="w-3 h-3 text-blue-400" />
                )}
                <span>Code</span>
              </button>
            </div>
          </div>
        )}

        {/* Method / Function Signature */}
        {Boolean(node.properties?.signature) && (
          <div>
            <span className="text-[10px] text-gray-500 font-semibold uppercase tracking-wider block mb-0.5">
              Signature
            </span>
            <span className="font-mono text-cyan-300 text-[11px] break-all bg-black/40 px-2.5 py-1 rounded-xl block border border-cyan-500/20">
              {String(node.properties?.signature)}
            </span>
          </div>
        )}

        {/* Interactive Line-Clickable Code Viewer */}
        {snippet && (
          <div className="rounded-xl bg-black/90 border border-blue-500/30 overflow-hidden animate-in fade-in">
            <div className="flex items-center justify-between px-2.5 py-1.5 bg-blue-950/40 border-b border-blue-500/20 text-[10px] text-blue-300 font-mono">
              <span className="flex items-center gap-1.5">
                <FileCode className="w-3 h-3 text-blue-400" />
                <span>Code Viewer (Click line to focus node)</span>
              </span>
              <button
                onClick={() => setSnippet(null)}
                className="text-gray-400 hover:text-white"
                title="Collapse Preview"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
            <div className="overflow-x-auto max-h-56 font-mono text-[11px] select-text">
              {snippet.split('\n').map((lineText, idx) => {
                const currentLineNum = snippetStartLine + idx;
                const isSelectedLine =
                  currentLineNum >= (node.start_line || 1) &&
                  currentLineNum <= (node.end_line || node.start_line || 1);
                const lineNodes = nodesByLine.get(currentLineNum) || [];
                const hasNode = lineNodes.length > 0;

                return (
                  <div
                    key={`line-${currentLineNum}`}
                    onClick={() => {
                      if (hasNode && onSelectNode) {
                        onSelectNode(lineNodes[0]);
                        showToast(`Focused ${lineNodes[0].label}: ${lineNodes[0].name} (line ${currentLineNum})`, 'info');
                      }
                    }}
                    className={`flex items-stretch group transition-colors ${
                      hasNode ? 'cursor-pointer hover:bg-blue-500/15' : ''
                    } ${
                      isSelectedLine
                        ? 'bg-blue-600/25 border-l-2 border-cyan-400 text-white font-medium'
                        : 'text-gray-300'
                    }`}
                    title={hasNode ? `Line ${currentLineNum}: ${lineNodes.map(n => `${n.label} '${n.name}'`).join(', ')} (Click to focus)` : `Line ${currentLineNum}`}
                  >
                    {/* Line number column */}
                    <div
                      className={`w-10 shrink-0 select-none text-right pr-2 py-0.5 border-r border-white/5 text-[10px] ${
                        isSelectedLine
                          ? 'text-cyan-300 font-bold bg-blue-500/10'
                          : 'text-gray-600 group-hover:text-gray-400'
                      }`}
                    >
                      {currentLineNum}
                    </div>

                    {/* Node indicator badge if a CPG node starts on this line */}
                    {hasNode && (
                      <div className="w-2.5 shrink-0 flex items-center justify-center pl-0.5">
                        <span
                          className="w-1.5 h-1.5 rounded-full"
                          style={{ backgroundColor: getNodeColor(lineNodes[0].label) }}
                          title={`${lineNodes[0].label}: ${lineNodes[0].name}`}
                        />
                      </div>
                    )}

                    {/* Line code text */}
                    <pre className="flex-1 pl-2 pr-3 py-0.5 whitespace-pre overflow-visible text-[11px] leading-relaxed">
                      {lineText || ' '}
                    </pre>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Quick Analysis Actions for CPG */}
        {graphScope === 'cpg' && onTriggerAction && (
          <div className="pt-2 border-t border-white/5 space-y-1.5">
            <span className="text-[10px] text-gray-500 font-semibold uppercase tracking-wider block">
              Quick Actions
            </span>
            <div className="flex flex-wrap gap-1.5">
              {(node.label === 'Method' || node.label === 'Function' || node.label === 'Call') && (
                <>
                  <button
                    type="button"
                    onClick={() => onTriggerAction('callers', node)}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-300 border border-cyan-500/20 text-[11px] font-medium transition-all active:scale-95"
                    title="Trace callers of this method"
                  >
                    <ArrowDownLeft className="w-3 h-3 text-cyan-400" />
                    <span>Show Callers</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onTriggerAction('callees', node)}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-300 border border-cyan-500/20 text-[11px] font-medium transition-all active:scale-95"
                    title="Trace callees invoked by this method"
                  >
                    <ArrowUpRight className="w-3 h-3 text-cyan-400" />
                    <span>Show Callees</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onTriggerAction('control_flow', node)}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 border border-amber-500/20 text-[11px] font-medium transition-all active:scale-95"
                    title="Trace Control Flow (CFG) within this function"
                  >
                    <span>Control Flow</span>
                  </button>
                </>
              )}
              {(node.label === 'Variable' || node.label === 'Param' || node.label === 'Call') && (
                <button
                  type="button"
                  onClick={() => onTriggerAction('data_flow', node)}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-pink-500/10 hover:bg-pink-500/20 text-pink-300 border border-pink-500/20 text-[11px] font-medium transition-all active:scale-95"
                  title="Trace data flow from this variable"
                >
                  <span>Trace Data</span>
                </button>
              )}
              <button
                type="button"
                onClick={() => onTriggerAction('impact', node)}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-purple-500/10 hover:bg-purple-500/20 text-purple-300 border border-purple-500/20 text-[11px] font-medium transition-all active:scale-95"
                title="Analyze blast radius & dependents"
              >
                <Compass className="w-3 h-3 text-purple-400" />
                <span>Analyze Impact</span>
              </button>
              <button
                type="button"
                onClick={() => onTriggerAction('find_path', node)}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-blue-500/10 hover:bg-blue-500/20 text-blue-300 border border-blue-500/20 text-[11px] font-medium transition-all active:scale-95"
                title="Find path to another node"
              >
                <Route className="w-3 h-3 text-blue-400" />
                <span>Find Path</span>
              </button>
            </div>
          </div>
        )}

        {/* Context-Aware Panel: Impact Analysis Results */}
        {analysisMode === 'impact' && impactResult && (
          <div className="pt-2 border-t border-purple-500/30 space-y-2 bg-purple-950/20 p-2.5 rounded-xl border">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold text-purple-300 uppercase tracking-wider flex items-center gap-1">
                <Compass className="w-3.5 h-3.5 text-purple-400" />
                Impact Analysis
              </span>
              <span className="text-[10px] font-mono text-purple-400 font-bold">
                {(impactResult.direct_count || 0) + (impactResult.indirect_count || 0)} dependents
              </span>
            </div>
            <div className="grid grid-cols-3 gap-1.5 text-center text-[10px] font-mono">
              <div className="p-1.5 rounded-lg bg-black/40 border border-white/5">
                <span className="text-gray-400 block text-[9px]">Direct</span>
                <span className="font-bold text-white text-xs">{impactResult.direct_count}</span>
              </div>
              <div className="p-1.5 rounded-lg bg-black/40 border border-white/5">
                <span className="text-gray-400 block text-[9px]">Indirect</span>
                <span className="font-bold text-purple-300 text-xs">{impactResult.indirect_count}</span>
              </div>
              <div className="p-1.5 rounded-lg bg-black/40 border border-white/5">
                <span className="text-gray-400 block text-[9px]">Files</span>
                <span className="font-bold text-cyan-300 text-xs">{impactResult.affected_file_count}</span>
              </div>
            </div>
            {(impactResult.affected_files || []).length > 0 && (
              <div className="space-y-1">
                <span className="text-[9px] text-gray-400 font-semibold uppercase block">Affected Files</span>
                <div className="max-h-24 overflow-y-auto space-y-0.5 text-[10px] font-mono text-gray-300">
                  {(impactResult.affected_files || []).map((f) => (
                    <div key={f} className="truncate px-1.5 py-0.5 rounded bg-black/40">
                      {f}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Context-Aware Panel: Call Flow Results */}
        {analysisMode === 'call_flow' && callFlowResult && (
          <div className="pt-2 border-t border-cyan-500/30 space-y-2 bg-cyan-950/20 p-2.5 rounded-xl border">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold text-cyan-300 uppercase tracking-wider flex items-center gap-1">
                <Route className="w-3.5 h-3.5 text-cyan-400" />
                Call Flow ({callFlowResult.direction})
              </span>
              <span className="text-[10px] font-mono text-cyan-400 font-bold">
                {(callFlowResult.nodes || []).length} methods
              </span>
            </div>
            <div className="max-h-32 overflow-y-auto space-y-1">
              {(callFlowResult.nodes || []).map((n, idx) => (
                <div
                  key={`cf-${n.id}-${idx}`}
                  onClick={() => onSelectNode(n)}
                  className="p-1.5 rounded-lg bg-black/40 hover:bg-white/10 border border-white/5 cursor-pointer flex items-center justify-between gap-1 text-[11px] font-mono"
                >
                  <span className="text-cyan-200 truncate">{n.name}</span>
                  <span className="text-[9px] text-gray-500 shrink-0">#{n.id}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Context-Aware Panel: Taint & Data Flow Results */}
        {(analysisMode === 'taint_flow' || analysisMode === 'data_flow') && flowResult && (
          <div className="pt-2 border-t border-pink-500/30 space-y-2 bg-pink-950/20 p-2.5 rounded-xl border">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold text-pink-300 uppercase tracking-wider flex items-center gap-1">
                <ShieldAlert className="w-3.5 h-3.5 text-pink-400" />
                {flowResult.flow_type || 'Flow Path'}
              </span>
              <span className="text-[10px] font-mono text-pink-400 font-bold">
                {(flowResult.steps || []).length} steps
              </span>
            </div>
            <div className="space-y-1 text-[10px] font-mono">
              <div className="p-1.5 rounded-lg bg-black/50 border border-white/5 flex items-center justify-between">
                <span className="text-gray-400">Source:</span>
                <span className="text-pink-300 truncate max-w-[180px]">{flowResult.source?.name || '—'}</span>
              </div>
              <div className="p-1.5 rounded-lg bg-black/50 border border-white/5 flex items-center justify-between">
                <span className="text-gray-400">Sink:</span>
                <span className="text-pink-300 truncate max-w-[180px]">{flowResult.sink?.name || '—'}</span>
              </div>
            </div>
            <div className="max-h-36 overflow-y-auto space-y-1 pt-1">
              {(flowResult.steps || []).map((step) => (
                <div
                  key={`step-${step.step_index}-${step.node.id}`}
                  onClick={() => onSelectNode(step.node)}
                  className="p-1.5 rounded-lg bg-black/40 hover:bg-white/10 border border-white/5 cursor-pointer flex items-center justify-between gap-1 text-[10px] font-mono"
                >
                  <span className="text-gray-400 shrink-0">{step.step_index}.</span>
                  <span className="text-gray-200 truncate flex-1">{step.node.name}</span>
                  <span className="text-[9px] px-1 py-0.2 rounded bg-pink-500/20 text-pink-300 shrink-0">
                    {step.edge_type}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Context-Aware Panel: Find Path Results */}
        {analysisMode === 'find_path' && pathResult && (
          <div className="pt-2 border-t border-blue-500/30 space-y-2 bg-blue-950/20 p-2.5 rounded-xl border">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold text-blue-300 uppercase tracking-wider flex items-center gap-1">
                <Route className="w-3.5 h-3.5 text-blue-400" />
                Path Result
              </span>
              <span className={`text-[10px] font-mono font-bold ${pathResult.found ? 'text-emerald-400' : 'text-amber-400'}`}>
                {pathResult.found ? `${(pathResult.nodes || []).length} nodes` : 'No path found'}
              </span>
            </div>
            {pathResult.found && (
              <div className="max-h-36 overflow-y-auto space-y-1">
                {(pathResult.nodes || []).map((n, idx) => (
                  <div
                    key={`p-${n.id}-${idx}`}
                    onClick={() => onSelectNode(n)}
                    className="p-1.5 rounded-lg bg-black/40 hover:bg-white/10 border border-white/5 cursor-pointer flex items-center justify-between gap-1 text-[10px] font-mono"
                  >
                    <span className="text-gray-400 shrink-0">{idx + 1}.</span>
                    <span className="text-blue-200 truncate flex-1">{n.name}</span>
                    <span className="text-[9px] text-gray-500 shrink-0">{n.label}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}


        {/* Inbound & Outbound Connections Navigation Tabs */}
        <div className="space-y-2 pt-1 border-t border-white/5">
          <div className="flex items-center p-1 rounded-xl bg-black/40 border border-white/5">
            <button
              onClick={() => setActiveConnTab('inbound')}
              className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-[11px] font-semibold transition-all ${
                activeConnTab === 'inbound'
                  ? 'bg-white/15 text-emerald-300'
                  : 'text-gray-400 hover:text-white'
              }`}
            >
              <ArrowDownLeft className="w-3.5 h-3.5 text-emerald-400" />
              <span>Inbound ({inboundNeighbors.length})</span>
            </button>
            <button
              onClick={() => setActiveConnTab('outbound')}
              className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-[11px] font-semibold transition-all ${
                activeConnTab === 'outbound'
                  ? 'bg-white/15 text-cyan-300'
                  : 'text-gray-400 hover:text-white'
              }`}
            >
              <ArrowUpRight className="w-3.5 h-3.5 text-cyan-400" />
              <span>Outbound ({outboundNeighbors.length})</span>
            </button>
          </div>

          {/* List of Connected Nodes */}
          <div className="max-h-44 overflow-y-auto space-y-1.5 pr-0.5">
            {activeList.length === 0 ? (
              <div className="py-4 text-center text-gray-500 text-[11px]">
                No {activeConnTab} connections found
              </div>
            ) : (
              activeList.map((conn) => {
                const connNodeColor = getNodeColor(conn.nodeLabel);
                const edgeColor = getEdgeColor(conn.edgeType);

                return (
                  <div
                    key={`conn-${conn.linkId}-${conn.nodeId}`}
                    onClick={() => onSelectNode(conn.targetNode)}
                    className="p-2 rounded-xl bg-black/40 hover:bg-white/10 border border-white/5 hover:border-blue-500/30 transition-all cursor-pointer flex items-center justify-between gap-2 group"
                    title={`Click to focus on ${conn.nodeName}`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 mb-0.5">
                        <span
                          className="text-[9px] font-mono uppercase px-1.5 py-0.2 rounded border"
                          style={{
                            backgroundColor: `${edgeColor}15`,
                            borderColor: `${edgeColor}35`,
                            color: edgeColor,
                          }}
                        >
                          {conn.edgeType}
                        </span>
                        <span
                          className="text-[9px] px-1.5 py-0.2 rounded-full font-sans uppercase font-bold"
                          style={{
                            backgroundColor: `${connNodeColor}20`,
                            color: connNodeColor,
                          }}
                        >
                          {conn.nodeLabel}
                        </span>
                      </div>
                      <div className="font-mono text-gray-200 text-[11px] font-semibold truncate group-hover:text-blue-300 transition-colors">
                        {conn.nodeName}
                      </div>
                    </div>

                    <ChevronRight className="w-3.5 h-3.5 text-gray-500 group-hover:text-white group-hover:translate-x-0.5 transition-all shrink-0" />
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Node Properties */}
        {node.properties && Object.keys(node.properties).length > 0 && (
          <div className="pt-1 border-t border-white/5">
            <span className="text-[10px] text-gray-500 font-semibold uppercase tracking-wider block mb-1">
              Properties
            </span>
            <div className="p-2 rounded-xl bg-black/40 border border-white/5 font-mono text-[10px] text-gray-400 max-h-28 overflow-y-auto space-y-1">
              {Object.entries(node.properties).map(([k, v]) => (
                <div key={k} className="flex justify-between gap-2">
                  <span className="text-gray-500">{k}:</span>
                  <span className="text-gray-300 truncate max-w-[180px]">
                    {typeof v === 'object' ? JSON.stringify(v) : String(v)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
