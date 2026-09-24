'use client';

import React, { useEffect, useRef, useMemo } from 'react';
import ForceGraph3D from '3d-force-graph';
import * as THREE from 'three';
import { GraphRendererProps } from './types';
import { getNodeColor, getEdgeColor, filterGraphData } from './utils';
import { GraphNode, GraphEdge } from '../../types/graph';

interface ForceGraph3DInstance {
  graphData: (data?: unknown) => { nodes?: GraphNode[]; links?: GraphEdge[] };
  width: (w: number) => ForceGraph3DInstance;
  height: (h: number) => ForceGraph3DInstance;
  cameraPosition: (
    pos?: { x?: number; y?: number; z?: number },
    lookAt?: { x?: number; y?: number; z?: number },
    ms?: number
  ) => ForceGraph3DInstance;
  nodeColor: (fn?: unknown) => ForceGraph3DInstance;
  linkColor: (fn?: unknown) => ForceGraph3DInstance;
  refresh: () => ForceGraph3DInstance;
  _destructor?: () => void;
}

// Safe Canvas-backed Text Sprite for Three.js
function createTextSprite(text: string, color: string, fontSize = 22): THREE.Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = 'rgba(9, 13, 22, 0.9)';
    if (typeof ctx.roundRect === 'function') {
      ctx.beginPath();
      ctx.roundRect(4, 6, 248, 52, 10);
      ctx.fill();
      ctx.strokeStyle = color;
      ctx.lineWidth = 2.5;
      ctx.stroke();
    } else {
      ctx.fillRect(4, 6, 248, 52);
      ctx.strokeStyle = color;
      ctx.lineWidth = 2.5;
      ctx.strokeRect(4, 6, 248, 52);
    }

    ctx.font = `bold ${fontSize}px -apple-system, sans-serif`;
    ctx.fillStyle = '#f8fafc';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text.length > 20 ? text.slice(0, 18) + '…' : text, 128, 32);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearFilter;
  const spriteMaterial = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthWrite: false,
  });
  const sprite = new THREE.Sprite(spriteMaterial);
  sprite.scale.set(18, 4.5, 1);
  return sprite;
}

export function Graph3DView({
  data,
  selectedNode,
  selectedEdge,
  onSelectNode,
  onSelectEdge,
  onHoverNode,
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
  const containerRef = useRef<HTMLDivElement>(null);
  const graphRef = useRef<ForceGraph3DInstance | null>(null);
  const edgeThicknessRef = useRef<number>(edgeThickness);
  const edgeOpacityRef = useRef<number>(edgeOpacity);
  const nodeSizeRef = useRef<number>(nodeSize);
  const nodeOpacityRef = useRef<number>(nodeOpacity);

  edgeThicknessRef.current = edgeThickness;
  edgeOpacityRef.current = edgeOpacity;
  nodeSizeRef.current = nodeSize;
  nodeOpacityRef.current = nodeOpacity;

  const onHoverNodeRef = useRef(onHoverNode);
  onHoverNodeRef.current = onHoverNode;
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

    // 2. Otherwise compute multi-hop neighborhood according to neighborhoodDepth
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

  // Refs for current state to decouple click selection from data re-simulation
  const selectedNodeRef = useRef<GraphNode | null>(selectedNode);
  const selectedEdgeRef = useRef<GraphEdge | null>(selectedEdge);
  const highlightNodesRef = useRef<Set<string | number>>(highlightNodes);
  const highlightLinksRef = useRef<Set<string | number>>(highlightLinks);

  selectedNodeRef.current = selectedNode;
  selectedEdgeRef.current = selectedEdge;
  highlightNodesRef.current = highlightNodes;
  highlightLinksRef.current = highlightLinks;
  // 1. Initialize 3D Graph
  useEffect(() => {
    if (!containerRef.current) return;

    const { nodes, links } = filterGraphData(data, filterLabels, filterEdgeTypes);
    const graphData = {
      nodes: nodes.map((n) => ({ ...n })),
      links: links.map((l) => ({ ...l })),
    };

    if (!graphRef.current) {
      const graph = new ForceGraph3D(containerRef.current);
      const instance = graph as unknown as ForceGraph3DInstance;
      graphRef.current = instance;

      graph
        .backgroundColor('rgba(0, 0, 0, 0)')
        .width(containerRef.current.clientWidth)
        .height(containerRef.current.clientHeight || 550)
        .nodeId('id')
        .nodeVal((node: unknown) => {
          const n = node as GraphNode;
          return n.val || 5;
        })
        .warmupTicks(30)
        .cooldownTicks(60)
        .d3AlphaDecay(0.04)
        .linkOpacity(edgeOpacityRef.current ?? 0.75)
        .nodeThreeObject((node: unknown) => {
          const n = node as GraphNode;
          const isSelected = selectedNodeRef.current && String(selectedNodeRef.current.id) === String(n.id);
          const isConnected = highlightNodesRef.current.has(n.id);
          const hasSelection = !!selectedNodeRef.current;
          const isDimmed = hasSelection && !isConnected;

          const radius = Math.max(Math.sqrt(n.val || 5) * 2.2 * (nodeSizeRef.current || 1.0), 3);
          const colorHex = getNodeColor(n.label);

          const group = new THREE.Group();

          // Sphere Material with Subtle Dimming
          const geometry = new THREE.SphereGeometry(radius, 16, 16);
          const currentOpacity = nodeOpacityRef.current ?? 1.0;
          const material = new THREE.MeshLambertMaterial({
            color: new THREE.Color(isDimmed ? '#1e293b' : colorHex),
            transparent: true,
            opacity: isDimmed ? currentOpacity * 0.15 : currentOpacity,
            emissive: isSelected
              ? new THREE.Color(colorHex)
              : isConnected
                ? new THREE.Color(colorHex)
                : isDimmed
                  ? new THREE.Color('#020617')
                  : new THREE.Color(colorHex),
            emissiveIntensity: isSelected ? 0.9 : isConnected ? 0.5 : isDimmed ? 0 : 0.2,
          });
          const sphere = new THREE.Mesh(geometry, material);
          group.add(sphere);

          // Selection wireframe halo
          if (isSelected) {
            const wireGeo = new THREE.SphereGeometry(radius * 1.5, 12, 12);
            const wireMat = new THREE.MeshBasicMaterial({
              color: 0x60a5fa,
              wireframe: true,
              transparent: true,
              opacity: 0.8,
            });
            const wire = new THREE.Mesh(wireGeo, wireMat);
            group.add(wire);
          } else if (isConnected && hasSelection) {
            const wireGeo = new THREE.SphereGeometry(radius * 1.3, 10, 10);
            const wireMat = new THREE.MeshBasicMaterial({
              color: 0xffffff,
              wireframe: true,
              transparent: true,
              opacity: 0.4,
            });
            const wire = new THREE.Mesh(wireGeo, wireMat);
            group.add(wire);
          }

          // Node Text Label Sprite
          if (!isDimmed) {
            try {
              const labelText = n.name || n.qualified_name || String(n.id);
              const sprite = createTextSprite(
                labelText,
                isSelected ? '#60a5fa' : isConnected ? '#ffffff' : colorHex
              );
              sprite.position.set(0, radius + 4.5, 0);
              group.add(sprite);
            } catch {
              // Canvas fallback
            }
          }

          return group;
        })
        // Link Colors: Highlight connected links with original color, subtle dimming for others
        .linkColor((link: unknown) => {
          const l = link as GraphEdge;
          const hasSelection = !!selectedNodeRef.current || highlightLinksRef.current.size > 0;
          const isHighlighted = highlightLinksRef.current.has(l.id);
          const isSelectedEdge = selectedEdgeRef.current && String(selectedEdgeRef.current.id) === String(l.id);

          if (isSelectedEdge) return '#f59e0b';
          if (hasSelection) {
            return isHighlighted ? getEdgeColor(l.type) : 'rgba(255, 255, 255, 0.08)';
          }
          return getEdgeColor(l.type);
        })
        .linkWidth((link: unknown) => {
          const l = link as GraphEdge;
          const currentBase = edgeThicknessRef.current || 1;
          const hasSelection = !!selectedNodeRef.current || highlightLinksRef.current.size > 0;
          const isHighlighted = highlightLinksRef.current.has(l.id);
          const isSelectedEdge = selectedEdgeRef.current && String(selectedEdgeRef.current.id) === String(l.id);
          if (isSelectedEdge) return currentBase * 2.2;
          if (hasSelection) {
            return isHighlighted ? currentBase * 2.5 : Math.max(currentBase * 0.35, 0.3);
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
        .linkWidth((link: unknown) => {
          const l = link as GraphEdge;
          const currentBase = edgeThicknessRef.current || 1;
          const hasSelection = !!selectedNodeRef.current;
          const isHighlighted = highlightLinksRef.current.has(l.id);
          const isSelectedEdge = selectedEdgeRef.current && String(selectedEdgeRef.current.id) === String(l.id);
          if (isSelectedEdge) return currentBase * 2.2;
          if (hasSelection) {
            return isHighlighted ? currentBase * 2.2 : Math.max(currentBase * 0.35, 0.3);
          }
          return currentBase;
        })
        // Directional Arrows
        .linkDirectionalArrowLength((link: unknown) => {
          const l = link as GraphEdge;
          const currentBase = edgeThicknessRef.current || 1;
          const hasSelection = !!selectedNodeRef.current;
          const isHighlighted = highlightLinksRef.current.has(l.id);
          if (hasSelection && !isHighlighted) return 0;
          return isHighlighted ? Math.max(currentBase * 2.6, 6) : Math.max(currentBase * 2.2, 5);
        })
        .linkDirectionalArrowRelPos(0.6)
        .linkDirectionalArrowResolution(8)
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

          if (instance && n.x !== undefined && n.y !== undefined && n.z !== undefined) {
            const distance = 130;
            const distRatio = 1 + distance / Math.hypot(n.x || 1, n.y || 1, n.z || 1);
            instance.cameraPosition(
              {
                x: (n.x || 0) * distRatio,
                y: (n.y || 0) * distRatio,
                z: (n.z || 0) * distRatio,
              },
              { x: n.x || 0, y: n.y || 0, z: n.z || 0 },
              800
            );
          }
        })
        .onLinkClick((link: unknown) => {
          const l = link as GraphEdge;
          onSelectEdge(l);
        })
        .onBackgroundClick(() => {
          onSelectNode(null);
          onSelectEdge(null);
        })
        .onNodeHover((node: unknown) => {
          const n = node as GraphNode | null;
          onHoverNodeRef.current?.(n ? n.id : null);
        });

      // Load initial graph data immediately upon initialization
      graph.graphData(graphData);
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
  }, [data, filterLabels, filterEdgeTypes, onSelectNode, onSelectEdge]);

  // 2. Update graph data when filtered data changes
  useEffect(() => {
    if (!graphRef.current) return;
    const { nodes, links } = filterGraphData(data, filterLabels, filterEdgeTypes);
    const graphData = {
      nodes: nodes.map((n) => ({ ...n })),
      links: links.map((l) => ({ ...l })),
    };
    graphRef.current.graphData(graphData);
  }, [data, filterLabels, filterEdgeTypes]);

  // 3. Re-render visuals on selection without resetting physics
  useEffect(() => {
    if (graphRef.current) {
      graphRef.current.refresh();
    }
  }, [selectedNode, selectedEdge, highlightNodes, highlightLinks, edgeThickness, edgeOpacity, nodeSize, nodeOpacity]);

  // 4. Focus camera when searchFocusId changes or tree node clicked
  useEffect(() => {
    if (!searchFocusId || !graphRef.current) return;
    const currentData = graphRef.current.graphData();
    if (!currentData || !currentData.nodes) return;
    const target = currentData.nodes.find(
      (n) => n.id !== undefined && String(n.id) === String(searchFocusId)
    );
    if (target && target.x !== undefined && target.y !== undefined && target.z !== undefined) {
      graphRef.current.cameraPosition(
        { x: target.x * 1.5, y: target.y * 1.5, z: target.z + 140 },
        { x: target.x, y: target.y, z: target.z },
        800
      );
      const matched = data.nodes.find((n) => String(n.id) === String(searchFocusId)) || null;
      onSelectNode(matched);
    }
  }, [searchFocusId, data.nodes, onSelectNode]);

  // 5. Center & fly camera to selectedNode (from Project Tree or sidebar)
  useEffect(() => {
    if (!selectedNode || !graphRef.current) return;
    const currentData = graphRef.current.graphData();
    if (!currentData || !currentData.nodes) return;
    const target = currentData.nodes.find(
      (n) => n.id !== undefined && String(n.id) === String(selectedNode.id)
    );
    if (target && target.x !== undefined && target.y !== undefined && target.z !== undefined) {
      graphRef.current.cameraPosition(
        { x: target.x * 1.5, y: target.y * 1.5, z: target.z + 140 },
        { x: target.x, y: target.y, z: target.z },
        800
      );
    }
  }, [selectedNode]);

  return (
    <div className="relative w-full h-full min-h-[500px] overflow-hidden rounded-2xl bg-black/50 border border-white/5">
      <div ref={containerRef} className="w-full h-full cursor-grab active:cursor-grabbing" />
      <div className="absolute bottom-3 left-3 px-2.5 py-1 rounded-lg bg-black/60 backdrop-blur-md border border-white/10 text-[10px] text-gray-400 pointer-events-none select-none">
        Left-click: Rotate • Right-click: Pan • Scroll: Zoom
      </div>
    </div>
  );
}
