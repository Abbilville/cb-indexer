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
  edgeThickness = 1,
  edgeOpacity = 0.75,
  nodeSize = 1.0,
  nodeOpacity = 1.0,
  highlightedNodeIds,
  highlightedEdgeIds,
  neighborhoodDepth = 1,
}: GraphRendererProps) {
  type ForceGraphInstance = InstanceType<typeof ForceGraph>;
  const graphRef = useRef<ForceGraphInstance | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Compute neighborhood / path for selection focus
  const { highlightNodes, highlightLinks } = useMemo(() => {
    const hNodes = new Set<string | number>();
    const hLinks = new Set<string | number>();

    // 1. If explicit analysis path is active
    if (highlightedNodeIds && highlightedNodeIds.size > 0) {
      highlightedNodeIds.forEach((id) => hNodes.add(id));
      if (highlightedEdgeIds) {
        highlightedEdgeIds.forEach((id) => hLinks.add(id));
      }
      return { highlightNodes: hNodes, highlightLinks: hLinks };
    }

    // 2. Multi-hop neighborhood expansion according to neighborhoodDepth
    if (selectedNode) {
      hNodes.add(selectedNode.id);
      let currentHop = new Set<string | number>([String(selectedNode.id)]);
      const depth = Math.max(1, Math.min(neighborhoodDepth || 1, 3));

      for (let hop = 0; hop < depth; hop++) {
        const nextHop = new Set<string | number>();
        data.links.forEach((l) => {
          const rawSrc = typeof l.source === 'object' && l.source !== null ? l.source.id : l.source;
          const rawDst = typeof l.target === 'object' && l.target !== null ? l.target.id : l.target;
          const srcId = String(rawSrc);
          const dstId = String(rawDst);

          if (currentHop.has(srcId)) {
            hNodes.add(rawDst);
            hLinks.add(l.id);
            nextHop.add(dstId);
          } else if (currentHop.has(dstId)) {
            hNodes.add(rawSrc);
            hLinks.add(l.id);
            nextHop.add(srcId);
          }
        });
        currentHop = nextHop;
      }
    }

    return { highlightNodes: hNodes, highlightLinks: hLinks };
  }, [selectedNode, data.links, highlightedNodeIds, highlightedEdgeIds, neighborhoodDepth]);

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

            // 1. Natural selection and connection rings
            if (isSelected) {
              ctx.beginPath();
              ctx.arc(n.x, n.y, r + 4, 0, 2 * Math.PI, false);
              ctx.strokeStyle = '#60a5fa';
              ctx.lineWidth = 2.5 / safeScale;
              ctx.stroke();
            } else if (isConnected && hasSelection) {
              ctx.beginPath();
              ctx.arc(n.x, n.y, r + 2.5, 0, 2 * Math.PI, false);
              ctx.strokeStyle = 'rgba(255, 255, 255, 0.6)';
              ctx.lineWidth = 1.6 / safeScale;
              ctx.stroke();
            }

            // 2. Node Circle with custom opacity & high contrast dimming for outside nodes
            ctx.beginPath();
            ctx.arc(n.x, n.y, r, 0, 2 * Math.PI, false);

            const fillAlpha = isDimmed ? currentOpacity * 0.15 : currentOpacity;
            ctx.fillStyle = hexToRgba(baseColor, fillAlpha);
            ctx.fill();
            ctx.strokeStyle = isSelected
              ? '#ffffff'
              : isConnected
                ? `rgba(255, 255, 255, ${Math.min(fillAlpha * 1.2, 1)})`
                : `rgba(255, 255, 255, ${fillAlpha * 0.4})`;
            ctx.lineWidth = (isSelected ? 2.0 : isConnected ? 1.5 : 0.6) / safeScale;
            ctx.stroke();

            // 3. Node Text Label: only show focused neighborhood if selection active, otherwise standard zoom threshold
            const shouldShowLabel = hasSelection ? (isSelected || isConnected) : safeScale >= 0.85;
            if (shouldShowLabel) {
              const fontSize = Math.max(10 / safeScale, 3);
              ctx.font = `600 ${fontSize}px -apple-system, sans-serif`;
              ctx.textAlign = 'center';
              ctx.textBaseline = 'top';

              const textWidth = ctx.measureText(label).width;
              ctx.fillStyle = isDimmed ? 'rgba(9, 13, 22, 0.6)' : 'rgba(9, 13, 22, 0.9)';
              ctx.fillRect(
                n.x - textWidth / 2 - 3,
                n.y + r + 2,
                textWidth + 6,
                fontSize + 3
              );
              ctx.strokeStyle = isSelected ? '#60a5fa' : isConnected ? 'rgba(255, 255, 255, 0.4)' : 'rgba(255, 255, 255, 0.15)';
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
                  ? '#ffffff'
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
        // Link Colors: Keep original edge color when focused, dim outside edges heavily
        .linkColor((link: unknown) => {
          const l = link as GraphEdge;
          const hasSelection = !!selectedNodeRef.current || highlightLinksRef.current.size > 0;
          const isHighlighted = highlightLinksRef.current.has(l.id);
          const isSelectedEdge = selectedEdgeRef.current && String(selectedEdgeRef.current.id) === String(l.id);

          const currentEdgeOpacity = edgeOpacityRef.current ?? 0.75;
          if (isSelectedEdge) return '#f59e0b';
          if (hasSelection) {
            return isHighlighted
              ? hexToRgba(getEdgeColor(l.type), 1.0)
              : hexToRgba(getEdgeColor(l.type), currentEdgeOpacity * 0.12);
          }
          return hexToRgba(getEdgeColor(l.type), currentEdgeOpacity);
        })
        .linkWidth((link: unknown) => {
          const l = link as GraphEdge;
          const currentBase = edgeThicknessRef.current || 1;
          const hasSelection = !!selectedNodeRef.current || highlightLinksRef.current.size > 0;
          const isHighlighted = highlightLinksRef.current.has(l.id);
          const isSelectedEdge = selectedEdgeRef.current && String(selectedEdgeRef.current.id) === String(l.id);
          if (isSelectedEdge) return currentBase * 2.2;
          if (hasSelection) {
            return isHighlighted ? currentBase * 2.5 : Math.max(currentBase * 0.35, 0.4);
          }
          return currentBase;
        })
        .linkDirectionalParticles((link: unknown) => {
          const l = link as GraphEdge;
          return highlightLinksRef.current.has(l.id) ? 3 : 0;
        })
        .linkDirectionalParticleSpeed(0.008)
        .linkDirectionalParticleWidth((link: unknown) => {
          const l = link as GraphEdge;
          return highlightLinksRef.current.has(l.id) ? 2.5 : 0;
        })
        .linkDirectionalParticleColor((link: unknown) => {
          const l = link as GraphEdge;
          return getEdgeColor(l.type);
        })
        .linkDirectionalArrowLength((link: unknown) => {
          const l = link as GraphEdge;
          const currentBase = edgeThicknessRef.current || 1;
          const hasSelection = !!selectedNodeRef.current;
          const isHighlighted = highlightLinksRef.current.has(l.id);
          if (hasSelection) {
            return isHighlighted ? Math.max(currentBase * 2.6, 6) : 0;
          }
          return Math.max(currentBase * 2.2, 5.5);
        })
        .linkDirectionalArrowRelPos(0.6)
        .linkDirectionalArrowColor((link: unknown) => {
          const l = link as GraphEdge;
          const isSelectedEdge = selectedEdgeRef.current && String(selectedEdgeRef.current.id) === String(l.id);
          if (isSelectedEdge) return '#f59e0b';
          return getEdgeColor(l.type);
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

  // 5. Center & zoom camera to selectedNode (from Project Tree or sidebar)
  useEffect(() => {
    if (!selectedNode || !graphRef.current) return;
    const currentData = graphRef.current.graphData();
    if (!currentData || !currentData.nodes) return;
    const target = currentData.nodes.find(
      (n) => n.id !== undefined && String(n.id) === String(selectedNode.id)
    );
    if (
      target &&
      typeof target.x === 'number' &&
      typeof target.y === 'number' &&
      Number.isFinite(target.x) &&
      Number.isFinite(target.y)
    ) {
      graphRef.current.centerAt(target.x, target.y, 800);
      graphRef.current.zoom(2.2, 800);
    }
  }, [selectedNode]);

  return (
    <div className="relative w-full h-full min-h-[500px] overflow-hidden rounded-2xl bg-black/40 border border-white/5">
      <div ref={containerRef} className="w-full h-full cursor-grab active:cursor-grabbing" />
    </div>
  );
}
