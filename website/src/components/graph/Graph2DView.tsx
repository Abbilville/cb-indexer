'use client';

import React, { useEffect, useRef, useMemo } from 'react';
import ForceGraph from 'force-graph';
import { GraphRendererProps } from './types';
import { getNodeColor, getEdgeColor, hexToRgba, filterGraphData } from './utils';
import { GraphNode, GraphEdge } from '../../types/graph';

export function Graph2DView({
  data,
  selectedNode,
  selectedEdge,
  onSelectNode,
  onSelectEdge,
  filterLabels,
  filterEdgeTypes,
  searchFocusId,
  edgeThickness = 2.5,
  edgeOpacity = 0.75,
  nodeSize = 1.0,
  nodeOpacity = 1.0,
}: GraphRendererProps) {
  type ForceGraphInstance = InstanceType<typeof ForceGraph>;
  const graphRef = useRef<ForceGraphInstance | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Compute 1-hop neighborhood for selection focus
  const { highlightNodes, highlightLinks } = useMemo(() => {
    const hNodes = new Set<string | number>();
    const hLinks = new Set<string | number>();

    if (selectedNode) {
      hNodes.add(selectedNode.id);
      data.links.forEach((l) => {
        const srcId = typeof l.source === 'object' && l.source !== null ? l.source.id : l.source;
        const dstId = typeof l.target === 'object' && l.target !== null ? l.target.id : l.target;

        if (String(srcId) === String(selectedNode.id)) {
          hNodes.add(dstId);
          hLinks.add(l.id);
        } else if (String(dstId) === String(selectedNode.id)) {
          hNodes.add(srcId);
          hLinks.add(l.id);
        }
      });
    }

    return { highlightNodes: hNodes, highlightLinks: hLinks };
  }, [selectedNode, data.links]);

  // Keep refs for current state without restarting force simulation
  const selectedNodeRef = useRef<GraphNode | null>(selectedNode);
  const selectedEdgeRef = useRef<GraphEdge | null>(selectedEdge);
  const highlightNodesRef = useRef<Set<string | number>>(highlightNodes);
  const highlightLinksRef = useRef<Set<string | number>>(highlightLinks);

  const edgeThicknessRef = useRef<number>(edgeThickness);
  const edgeOpacityRef = useRef<number>(edgeOpacity);
  const nodeSizeRef = useRef<number>(nodeSize);
  const nodeOpacityRef = useRef<number>(nodeOpacity);

  selectedNodeRef.current = selectedNode;
  selectedEdgeRef.current = selectedEdge;
  highlightNodesRef.current = highlightNodes;
  highlightLinksRef.current = highlightLinks;
  edgeThicknessRef.current = edgeThickness;
  edgeOpacityRef.current = edgeOpacity;
  nodeSizeRef.current = nodeSize;
  nodeOpacityRef.current = nodeOpacity;

  // 1. Initialize graph instance once
  useEffect(() => {
    if (!containerRef.current) return;

    if (!graphRef.current) {
      const graph = new ForceGraph(containerRef.current);
      graphRef.current = graph;

      graph
        .backgroundColor('rgba(0, 0, 0, 0)')
        .width(containerRef.current.clientWidth)
        .height(containerRef.current.clientHeight || 550)
        .nodeId('id')
        .nodeVal((node: unknown) => {
          const n = node as GraphNode;
          return n.val || 5;
        })
        .minZoom(0.25)
        .maxZoom(6)
        .d3VelocityDecay(0.3)
        .d3AlphaDecay(0.025)
        .warmupTicks(40)
        .cooldownTicks(90)
        // Custom Node Renderer with Robust Zoom Clamping & Natural Focus
        .nodeCanvasObject((node: unknown, ctx: CanvasRenderingContext2D, globalScale: number) => {
          try {
            const n = node as GraphNode;
            if (
              typeof n.x !== 'number' ||
              typeof n.y !== 'number' ||
              !Number.isFinite(n.x) ||
              !Number.isFinite(n.y)
            ) {
              return;
            }

            const safeScale = Math.max(0.2, Math.min(Number.isFinite(globalScale) ? globalScale : 1, 6));
            const label = n.name || n.qualified_name || String(n.id);
            const r = Math.sqrt(n.val || 5) * 3.2 * (nodeSizeRef.current || 1.0);
            const isSelected = selectedNodeRef.current && String(selectedNodeRef.current.id) === String(n.id);
            const isConnected = highlightNodesRef.current.has(n.id);
            const hasSelection = !!selectedNodeRef.current;
            const isDimmed = hasSelection && !isConnected;

            const baseColor = getNodeColor(n.label);
            const currentOpacity = nodeOpacityRef.current ?? 1.0;

            // 1. Natural, subtle selection ring
            if (isSelected) {
              ctx.beginPath();
              ctx.arc(n.x, n.y, r + 3, 0, 2 * Math.PI, false);
              ctx.strokeStyle = '#60a5fa';
              ctx.lineWidth = 2.2 / safeScale;
              ctx.stroke();
            } else if (isConnected && hasSelection) {
              ctx.beginPath();
              ctx.arc(n.x, n.y, r + 2, 0, 2 * Math.PI, false);
              ctx.strokeStyle = '#22d3ee';
              ctx.lineWidth = 1.4 / safeScale;
              ctx.stroke();
            }

            // 2. Node Circle with Subtle Balanced Dimming & Custom Opacity
            ctx.beginPath();
            ctx.arc(n.x, n.y, r, 0, 2 * Math.PI, false);

            const fillAlpha = isDimmed ? currentOpacity * 0.35 : currentOpacity;
            ctx.fillStyle = hexToRgba(baseColor, fillAlpha);
            ctx.fill();
            ctx.strokeStyle = isConnected
              ? `rgba(255, 255, 255, ${fillAlpha})`
              : `rgba(255, 255, 255, ${fillAlpha * 0.7})`;
            ctx.lineWidth = (isConnected ? 1.4 : 0.8) / safeScale;
            ctx.stroke();

            // 3. Node Text Label
            const shouldShowLabel = isSelected || isConnected || safeScale >= 0.85;
            if (shouldShowLabel) {
              const fontSize = Math.max(10 / safeScale, 3);
              ctx.font = `600 ${fontSize}px -apple-system, sans-serif`;
              ctx.textAlign = 'center';
              ctx.textBaseline = 'top';

              const textWidth = ctx.measureText(label).width;
              ctx.fillStyle = isDimmed ? 'rgba(9, 13, 22, 0.6)' : 'rgba(9, 13, 22, 0.88)';
              ctx.fillRect(
                n.x - textWidth / 2 - 3,
                n.y + r + 2,
                textWidth + 6,
                fontSize + 3
              );
              ctx.strokeStyle = isSelected ? '#60a5fa' : isConnected ? '#22d3ee' : 'rgba(255,255,255,0.15)';
              ctx.lineWidth = 0.5 / safeScale;
              ctx.strokeRect(
                n.x - textWidth / 2 - 3,
                n.y + r + 2,
                textWidth + 6,
                fontSize + 3
              );

              ctx.fillStyle = isSelected
                ? '#93c5fd'
                : isConnected
                ? '#a5f3fc'
                : isDimmed
                ? 'rgba(226, 232, 240, 0.45)'
                : '#f1f5f9';
              ctx.fillText(label, n.x, n.y + r + 3);
            }
          } catch {
            // Guard against canvas exceptions on rapid zoom
          }
        })
        .nodePointerAreaPaint((node: unknown, color: string, ctx: CanvasRenderingContext2D) => {
          const n = node as GraphNode;
          if (typeof n.x !== 'number' || typeof n.y !== 'number' || !Number.isFinite(n.x) || !Number.isFinite(n.y)) return;
          const r = Math.sqrt(n.val || 5) * 3.2 * (nodeSizeRef.current || 1.0) + 6;
          ctx.fillStyle = color;
          ctx.beginPath();
          ctx.arc(n.x, n.y, r, 0, 2 * Math.PI, false);
          ctx.fill();
        })
        // Link Colors: Custom Edge Opacity & Balanced Dimming
        .linkColor((link: unknown) => {
          const l = link as GraphEdge;
          const hasSelection = !!selectedNodeRef.current;
          const isHighlighted = highlightLinksRef.current.has(l.id);
          const isSelectedEdge = selectedEdgeRef.current && String(selectedEdgeRef.current.id) === String(l.id);

          const currentEdgeOpacity = edgeOpacityRef.current ?? 0.75;
          if (isSelectedEdge) return '#f59e0b';
          if (hasSelection) {
            return isHighlighted
              ? hexToRgba('#38bdf8', Math.min(currentEdgeOpacity * 1.3, 1))
              : hexToRgba(getEdgeColor(l.type), currentEdgeOpacity * 0.25);
          }
          return hexToRgba(getEdgeColor(l.type), currentEdgeOpacity);
        })
        // Edge Thickness: adjustable base thickness
        .linkWidth((link: unknown) => {
          const l = link as GraphEdge;
          const currentBase = edgeThicknessRef.current || 2.5;
          const isHighlighted = highlightLinksRef.current.has(l.id);
          const isSelectedEdge = selectedEdgeRef.current && String(selectedEdgeRef.current.id) === String(l.id);
          if (isSelectedEdge) return currentBase * 1.8;
          if (isHighlighted) return currentBase * 1.4;
          return currentBase;
        })
        // Proportional directional arrows centered on links
        .linkDirectionalArrowLength((link: unknown) => {
          const l = link as GraphEdge;
          const currentBase = edgeThicknessRef.current || 2.5;
          const hasSelection = !!selectedNodeRef.current;
          const isHighlighted = highlightLinksRef.current.has(l.id);
          if (hasSelection && !isHighlighted) return currentBase * 1.5;
          return Math.max(currentBase * 2.2, 5.5);
        })
        .linkDirectionalArrowRelPos(0.6)
        .linkDirectionalArrowColor((link: unknown) => {
          const l = link as GraphEdge;
          const isHighlighted = highlightLinksRef.current.has(l.id);
          const isSelectedEdge = selectedEdgeRef.current && String(selectedEdgeRef.current.id) === String(l.id);
          if (isSelectedEdge) return '#f59e0b';
          return isHighlighted ? '#38bdf8' : getEdgeColor(l.type);
        })
        // Edge Label at link midpoint with distance-based visibility
        .linkCanvasObjectMode(() => 'after')
        .linkCanvasObject((link: unknown, ctx: CanvasRenderingContext2D, globalScale: number) => {
          try {
            if (!Number.isFinite(globalScale) || globalScale < 1.1) return;
            const l = link as GraphEdge & {
              source?: { x?: number; y?: number };
              target?: { x?: number; y?: number };
            };
            if (
              !l.source ||
              !l.target ||
              typeof l.source.x !== 'number' ||
              typeof l.source.y !== 'number' ||
              typeof l.target.x !== 'number' ||
              typeof l.target.y !== 'number' ||
              !Number.isFinite(l.source.x) ||
              !Number.isFinite(l.source.y) ||
              !Number.isFinite(l.target.x) ||
              !Number.isFinite(l.target.y)
            ) {
              return;
            }

            const hasSelection = !!selectedNodeRef.current;
            const isHighlighted = highlightLinksRef.current.has(l.id);

            // Hide edge labels when zoomed out too far, unless highlighted
            if (hasSelection && !isHighlighted && globalScale < 1.4) return;

            const label = l.type;
            if (!label) return;

            const safeScale = Math.max(0.2, Math.min(globalScale, 6));
            const midX = (l.source.x + l.target.x) / 2;
            const midY = (l.source.y + l.target.y) / 2;
            const fontSize = Math.max(8.5 / safeScale, 2.5);

            ctx.font = `600 ${fontSize}px monospace`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';

            const textWidth = ctx.measureText(label).width;
            ctx.fillStyle = 'rgba(9, 13, 22, 0.88)';
            ctx.fillRect(midX - textWidth / 2 - 2, midY - fontSize / 2 - 1, textWidth + 4, fontSize + 2);

            ctx.fillStyle = isHighlighted ? '#38bdf8' : getEdgeColor(l.type);
            ctx.fillText(label, midX, midY);
          } catch {
            // Guard against canvas exceptions on rapid zoom
          }
        })
        // Click handlers
        .onNodeClick((node: unknown) => {
          const n = node as GraphNode;
          onSelectNode(n);
          if (graphRef.current && typeof n.x === 'number' && typeof n.y === 'number' && Number.isFinite(n.x) && Number.isFinite(n.y)) {
            graphRef.current.centerAt(n.x, n.y, 400);
          }
        })
        .onLinkClick((link: unknown) => {
          const l = link as GraphEdge;
          onSelectEdge(l);
        })
        .onBackgroundClick(() => {
          onSelectNode(null);
          onSelectEdge(null);
        });

      // Spread out nodes cleanly to avoid messy hairballs
      interface D3ForceObject {
        strength?: (n: number) => D3ForceObject;
        distance?: (n: number) => D3ForceObject;
      }
      const forceInstance = graph as unknown as { d3Force: (name: string) => D3ForceObject | undefined };
      if (typeof forceInstance.d3Force === 'function') {
        const charge = forceInstance.d3Force('charge');
        if (charge && typeof charge.strength === 'function') {
          charge.strength(-160);
        }
        const linkForce = forceInstance.d3Force('link');
        if (linkForce && typeof linkForce.distance === 'function') {
          linkForce.distance(60);
        }
      }
    }

    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (width > 0 && height > 0 && graphRef.current) {
          graphRef.current.width(width);
          graphRef.current.height(height);
        }
      }
    });

    resizeObserver.observe(containerRef.current);

    return () => {
      resizeObserver.disconnect();
    };
  }, [onSelectNode, onSelectEdge]);

  // 2. Update graph data when dataset changes
  useEffect(() => {
    if (!graphRef.current) return;
    const { nodes, links } = filterGraphData(data, filterLabels, filterEdgeTypes);
    const graphData = {
      nodes: nodes.map((n) => ({ ...n })),
      links: links.map((l) => ({ ...l })),
    };
    graphRef.current.graphData(graphData);
  }, [data, filterLabels, filterEdgeTypes]);

  // 3. Trigger immediate repaint when selection or visual settings change
  useEffect(() => {
    if (graphRef.current) {
      graphRef.current.nodeColor(graphRef.current.nodeColor());
    }
  }, [selectedNode, selectedEdge, highlightNodes, highlightLinks, edgeThickness, edgeOpacity, nodeSize, nodeOpacity]);

  // 4. Center & focus on node when searchFocusId changes or tree node clicked
  useEffect(() => {
    if (!searchFocusId || !graphRef.current) return;
    const currentData = graphRef.current.graphData();
    if (!currentData || !currentData.nodes) return;
    const target = currentData.nodes.find(
      (n) => n.id !== undefined && String(n.id) === String(searchFocusId)
    );
    if (target && typeof target.x === 'number' && typeof target.y === 'number' && Number.isFinite(target.x) && Number.isFinite(target.y)) {
      graphRef.current.centerAt(target.x, target.y, 600);
      const matched = data.nodes.find((n) => String(n.id) === String(searchFocusId)) || null;
      onSelectNode(matched);
    }
  }, [searchFocusId, data.nodes, onSelectNode]);

  return (
    <div className="relative w-full h-full min-h-[500px] overflow-hidden rounded-2xl bg-black/40 border border-white/5">
      <div ref={containerRef} className="w-full h-full cursor-grab active:cursor-grabbing" />
    </div>
  );
}
