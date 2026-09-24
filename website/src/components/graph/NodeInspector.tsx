'use client';

import React, { useState, useMemo } from 'react';
import { GraphNode, GraphEdge } from '../../types/graph';
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
} from 'lucide-react';

interface NodeInspectorProps {
  node: GraphNode | null;
  links: GraphEdge[];
  nodes?: GraphNode[];
  projectId: string;
  onClose: () => void;
  onSelectNode: (node: GraphNode | null) => void;
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
}: NodeInspectorProps) {
  const { showToast } = useToast();
  const [snippet, setSnippet] = useState<string | null>(null);
  const [isLoadingSnippet, setIsLoadingSnippet] = useState(false);
  const [activeConnTab, setActiveConnTab] = useState<'inbound' | 'outbound'>('inbound');

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

        {/* Code Snippet Box */}
        {snippet && (
          <div className="rounded-xl bg-black/80 border border-blue-500/30 overflow-hidden animate-in fade-in">
            <div className="flex items-center justify-between px-2.5 py-1.5 bg-blue-950/40 border-b border-blue-500/20 text-[10px] text-blue-300 font-mono">
              <span>Source Preview</span>
              <button
                onClick={() => setSnippet(null)}
                className="text-gray-400 hover:text-white"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
            <pre className="p-2.5 text-[10px] font-mono text-gray-200 overflow-x-auto max-h-44 leading-relaxed">
              {snippet}
            </pre>
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
