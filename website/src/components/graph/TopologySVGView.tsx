'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { GraphRendererProps } from './types';
import { ZoomIn, ZoomOut, RotateCcw, LayoutGrid } from 'lucide-react';

interface Point {
  x: number;
  y: number;
}

export function TopologySVGView({
  data,
  selectedNode,
  selectedEdge,
  onSelectNode,
  onSelectEdge,
}: GraphRendererProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState<Point>({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [dragStart, setDragStart] = useState<Point>({ x: 0, y: 0 });
  const [nodePositions, setNodePositions] = useState<Record<string, Point>>({});
  const [draggingNodeId, setDraggingNodeId] = useState<string | number | null>(null);

  const storageKey = `oss_indexer_nodes_${data.project || 'default'}`;

  // Initialize node layout (circle layout or load from localStorage)
  useEffect(() => {
    const saved = localStorage.getItem(storageKey);
    let loaded: Record<string, Point> = {};
    if (saved) {
      try {
        loaded = JSON.parse(saved) as Record<string, Point>;
      } catch {
        loaded = {};
      }
    }

    const newPositions: Record<string, Point> = { ...loaded };
    const width = containerRef.current?.clientWidth || 800;
    const height = containerRef.current?.clientHeight || 550;
    const centerX = width / 2;
    const centerY = height / 2;
    const radius = Math.min(width, height) * 0.35;

    data.nodes.forEach((node, idx) => {
      const key = String(node.id);
      if (!newPositions[key]) {
        const angle = (idx / Math.max(data.nodes.length, 1)) * 2 * Math.PI - Math.PI / 2;
        newPositions[key] = {
          x: centerX + radius * Math.cos(angle),
          y: centerY + radius * Math.sin(angle),
        };
      }
    });

    setNodePositions(newPositions);
  }, [data.nodes, data.project, storageKey]);

  // Save node positions to localStorage
  const savePositions = useCallback(
    (positions: Record<string, Point>) => {
      try {
        localStorage.setItem(storageKey, JSON.stringify(positions));
      } catch {
        // localStorage write error ignored
      }
    },
    [storageKey]
  );

  const handleResetLayout = () => {
    const width = containerRef.current?.clientWidth || 800;
    const height = containerRef.current?.clientHeight || 550;
    const centerX = width / 2;
    const centerY = height / 2;
    const radius = Math.min(width, height) * 0.35;

    const reset: Record<string, Point> = {};
    data.nodes.forEach((node, idx) => {
      const angle = (idx / Math.max(data.nodes.length, 1)) * 2 * Math.PI - Math.PI / 2;
      reset[String(node.id)] = {
        x: centerX + radius * Math.cos(angle),
        y: centerY + radius * Math.sin(angle),
      };
    });

    setNodePositions(reset);
    savePositions(reset);
    setPan({ x: 0, y: 0 });
    setZoom(1);
  };

  // Pan interaction
  const handleMouseDown = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).tagName === 'svg' || (e.target as HTMLElement).id === 'bg-rect') {
      setIsPanning(true);
      setDragStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (isPanning) {
      setPan({
        x: e.clientX - dragStart.x,
        y: e.clientY - dragStart.y,
      });
    } else if (draggingNodeId !== null) {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const mouseX = (e.clientX - rect.left - pan.x) / zoom;
      const mouseY = (e.clientY - rect.top - pan.y) / zoom;

      setNodePositions((prev) => {
        const next = {
          ...prev,
          [String(draggingNodeId)]: { x: mouseX, y: mouseY },
        };
        return next;
      });
    }
  };

  const handleMouseUp = () => {
    if (isPanning) {
      setIsPanning(false);
    }
    if (draggingNodeId !== null) {
      setDraggingNodeId(null);
      savePositions(nodePositions);
    }
  };

  return (
    <div
      ref={containerRef}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      className="relative w-full h-[550px] min-h-[500px] overflow-hidden rounded-2xl bg-black/40 border border-white/5 select-none"
    >
      <svg className="w-full h-full cursor-grab active:cursor-grabbing">
        <defs>
          <marker
            id="topo-arrow"
            viewBox="0 0 10 10"
            refX="22"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto-start-reverse"
          >
            <path d="M 0 1 L 10 5 L 0 9 z" fill="#60a5fa" />
          </marker>
        </defs>

        <rect id="bg-rect" width="100%" height="100%" fill="transparent" />

        <g transform={`translate(${pan.x}, ${pan.y}) scale(${zoom})`}>
          {/* Edges / Links */}
          {data.links.map((link) => {
            const srcId = typeof link.source === 'object' && link.source !== null ? link.source.id : link.source;
            const dstId = typeof link.target === 'object' && link.target !== null ? link.target.id : link.target;
            const p1 = nodePositions[String(srcId)];
            const p2 = nodePositions[String(dstId)];

            if (!p1 || !p2) return null;

            const isEdgeSelected = selectedEdge && selectedEdge.id === link.id;
            const dx = p2.x - p1.x;
            const dy = p2.y - p1.y;
            const cx = (p1.x + p2.x) / 2 - dy * 0.15;
            const cy = (p1.y + p2.y) / 2 + dx * 0.15;
            const pathD = `M ${p1.x} ${p1.y} Q ${cx} ${cy} ${p2.x} ${p2.y}`;

            return (
              <g key={link.id} className="cursor-pointer" onClick={() => onSelectEdge(link)}>
                <path
                  d={pathD}
                  fill="none"
                  stroke={isEdgeSelected ? '#f59e0b' : '#3b82f6'}
                  strokeWidth={isEdgeSelected ? 3 : 1.8}
                  strokeDasharray={link.type?.includes('REGISTRY') ? '4,3' : undefined}
                  markerEnd="url(#topo-arrow)"
                  className="transition-colors hover:stroke-blue-300"
                />
              </g>
            );
          })}

          {/* Nodes */}
          {data.nodes.map((node) => {
            const pos = nodePositions[String(node.id)] || { x: 100, y: 100 };
            const isNodeSelected = selectedNode && selectedNode.id === node.id;
            const isGateway = node.label.toLowerCase() === 'gateway';

            return (
              <g
                key={node.id}
                transform={`translate(${pos.x}, ${pos.y})`}
                onMouseDown={(e) => {
                  e.stopPropagation();
                  setDraggingNodeId(node.id);
                  onSelectNode(node);
                }}
                className="cursor-pointer"
              >
                {/* Node Box */}
                <rect
                  x="-75"
                  y="-26"
                  width="150"
                  height="52"
                  rx="12"
                  fill="rgba(17, 24, 39, 0.95)"
                  stroke={isNodeSelected ? '#60a5fa' : isGateway ? '#818cf8' : 'rgba(255, 255, 255, 0.12)'}
                  strokeWidth={isNodeSelected ? 2.5 : 1}
                  className="transition-all hover:stroke-blue-400"
                />

                {/* Node Title */}
                <text
                  x="0"
                  y="-5"
                  textAnchor="middle"
                  fill="#f3f4f6"
                  fontSize="11"
                  fontWeight="bold"
                  className="pointer-events-none font-sans"
                >
                  {node.name}
                </text>

                {/* Port / Label Chip */}
                <text
                  x="0"
                  y="12"
                  textAnchor="middle"
                  fill={isGateway ? '#a5b4fc' : '#9ca3af'}
                  fontSize="9.5"
                  className="pointer-events-none font-mono"
                >
                  {node.properties?.port ? `:${node.properties.port}` : node.label}
                </text>
              </g>
            );
          })}
        </g>
      </svg>

      {/* Floating Canvas Controls */}
      <div className="absolute top-3 right-3 flex items-center gap-1.5 p-1.5 rounded-xl bg-black/60 backdrop-blur-md border border-white/10 shadow-lg">
        <button
          onClick={() => setZoom((z) => Math.min(z + 0.2, 3))}
          className="p-1.5 text-gray-300 hover:text-white rounded-lg hover:bg-white/10 transition-colors"
          title="Zoom In"
        >
          <ZoomIn className="w-4 h-4" />
        </button>
        <span className="text-[11px] font-mono text-gray-400 px-1">{Math.round(zoom * 100)}%</span>
        <button
          onClick={() => setZoom((z) => Math.max(z - 0.2, 0.4))}
          className="p-1.5 text-gray-300 hover:text-white rounded-lg hover:bg-white/10 transition-colors"
          title="Zoom Out"
        >
          <ZoomOut className="w-4 h-4" />
        </button>
        <div className="w-[1px] h-4 bg-white/10 mx-0.5" />
        <button
          onClick={() => {
            setZoom(1);
            setPan({ x: 0, y: 0 });
          }}
          className="p-1.5 text-gray-300 hover:text-white rounded-lg hover:bg-white/10 transition-colors"
          title="Reset Zoom & Pan"
        >
          <RotateCcw className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={handleResetLayout}
          className="p-1.5 text-gray-300 hover:text-white rounded-lg hover:bg-white/10 transition-colors"
          title="Reset Node Circle Layout"
        >
          <LayoutGrid className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Legend */}
      <div className="absolute bottom-3 left-3 flex items-center gap-3 px-3 py-1.5 rounded-xl bg-black/60 backdrop-blur-md border border-white/10 text-[11px] text-gray-400 pointer-events-none">
        <span className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-blue-500" />
          Service Node
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-indigo-400" />
          Gateway
        </span>
      </div>
    </div>
  );
}
