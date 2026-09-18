'use client';

import React, { useState, useMemo, useRef, useEffect } from 'react';
import { GraphRendererProps } from '../graph/types';
import { GraphNode } from '../../types/graph';
import { getNodeColor } from '../graph/utils';
import {
  ZoomIn,
  ZoomOut,
  RotateCcw,
  ChevronRight,
  Folder,
  FileCode,
  Box,
  Code2,
  Globe,
  Database,
} from 'lucide-react';

interface HierarchyNode {
  id: string;
  name: string;
  label: string;
  astNode?: GraphNode;
  children: HierarchyNode[];
  childMap: Map<string, HierarchyNode>;
}

export function TreeFlowchartView({
  data,
  selectedNode,
  onSelectNode,
}: GraphRendererProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(0.82);
  const [pan, setPan] = useState({ x: 50, y: 50 });
  const [isPanning, setIsPanning] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });

  // Track which nodes are currently expanded at each depth
  const [expandedNodeIds, setExpandedNodeIds] = useState<Set<string>>(new Set());

  // 1. Build Left-to-Right hierarchical model from AST nodes, grouped by project
  const rootProjects = useMemo(() => {
    const allNodes = data?.nodes || [];
    const projectMap = new Map<string, HierarchyNode>();

    allNodes.forEach((node) => {
      const projName = node.project || data.project || 'Project';
      let projRoot = projectMap.get(projName);
      if (!projRoot) {
        projRoot = {
          id: `proj-${projName}`,
          name: projName,
          label: 'Project',
          children: [],
          childMap: new Map(),
        };
        projectMap.set(projName, projRoot);
      }

      const filePath = node.file_path || node.name || 'global';
      const parts = filePath.split(/[/\\]/).filter(Boolean);

      let current = projRoot;
      let pathAcc = projName;

      parts.forEach((part, index) => {
        pathAcc = `${pathAcc}/${part}`;
        const isFile = index === parts.length - 1 && part.includes('.');
        const branchLabel = isFile ? 'File' : 'Folder';

        let child = current.childMap.get(part);
        if (!child) {
          child = {
            id: pathAcc,
            name: part,
            label: branchLabel,
            children: [],
            childMap: new Map(),
          };
          current.children.push(child);
          current.childMap.set(part, child);
        }
        current = child;
      });

      // Fine-grained AST entities attached under their file
      if (
        node.label !== 'File' &&
        node.label !== 'Folder' &&
        node.label !== 'Branch' &&
        node.label !== 'Project'
      ) {
        const symbolNode: HierarchyNode = {
          id: String(node.id),
          name: node.name,
          label: node.label,
          astNode: node,
          children: [],
          childMap: new Map(),
        };
        current.children.push(symbolNode);
      } else if (!current.astNode) {
        current.astNode = node;
      }
    });

    return Array.from(projectMap.values());
  }, [data.project, data.nodes]);

  // Initial expansion: expand first project on load
  useEffect(() => {
    if (rootProjects.length > 0) {
      setExpandedNodeIds(new Set([rootProjects[0].id]));
    }
  }, [rootProjects]);

  // 2. Compute visible columns and card positions from left to right
  const { visibleColumns, visibleLinks } = useMemo(() => {
    const columns: Array<Array<{ node: HierarchyNode; x: number; y: number; width: number; height: number }>> = [];
    const links: Array<{
      id: string;
      startX: number;
      startY: number;
      endX: number;
      endY: number;
      color: string;
    }> = [];

    const colWidth = 240;
    const colGap = 90;
    const cardHeight = 44;
    const cardGap = 12;

    if (rootProjects.length === 0) {
      return { visibleColumns: columns, visibleLinks: links };
    }

    // Column 0: All Root Projects
    let rootY = 40;
    const col0Items = rootProjects.map((p) => {
      const item = {
        node: p,
        x: 0,
        y: rootY,
        width: colWidth,
        height: cardHeight,
      };
      rootY += cardHeight + cardGap;
      return item;
    });
    columns.push(col0Items);

    // Helper to traverse and populate next columns to the right for expanded nodes
    let currentDepthNodes: HierarchyNode[] = rootProjects;
    let depth = 0;

    while (currentDepthNodes.length > 0 && depth < 6) {
      const nextDepthNodes: HierarchyNode[] = [];
      const colX = (depth + 1) * (colWidth + colGap);
      let curY = 40;
      const colItems: Array<{ node: HierarchyNode; x: number; y: number; width: number; height: number }> = [];

      currentDepthNodes.forEach((parentNode) => {
        if (expandedNodeIds.has(parentNode.id) && parentNode.children.length > 0) {
          const parentLayout = columns[depth]?.find((c) => c.node.id === parentNode.id);

          parentNode.children.forEach((child) => {
            const childLayout = {
              node: child,
              x: colX,
              y: curY,
              width: colWidth,
              height: cardHeight,
            };
            colItems.push(childLayout);

            // Connect parent on left to child on right
            if (parentLayout) {
              links.push({
                id: `${parentNode.id}->${child.id}`,
                startX: parentLayout.x + parentLayout.width,
                startY: parentLayout.y + parentLayout.height / 2,
                endX: childLayout.x,
                endY: childLayout.y + childLayout.height / 2,
                color: getNodeColor(child.label),
              });
            }

            nextDepthNodes.push(child);
            curY += cardHeight + cardGap;
          });
        }
      });

      if (colItems.length > 0) {
        columns.push(colItems);
      }
      currentDepthNodes = nextDepthNodes;
      depth++;
    }

    return { visibleColumns: columns, visibleLinks: links };
  }, [rootProjects, expandedNodeIds]);

  // Handle node card click: toggle expand and select
  const handleNodeClick = (item: HierarchyNode) => {
    if (item.astNode) {
      onSelectNode(item.astNode);
    }

    if (item.children.length > 0) {
      setExpandedNodeIds((prev) => {
        const next = new Set(prev);
        if (next.has(item.id)) {
          next.delete(item.id);
        } else {
          next.add(item.id);
        }
        return next;
      });
    }
  };

  // Pan interactions
  const handleMouseDown = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).tagName === 'svg' || (e.target as HTMLElement).id === 'tree-bg') {
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
    }
  };

  const handleMouseUp = () => {
    setIsPanning(false);
  };

  const getNodeIcon = (label: string) => {
    const l = label.toLowerCase();
    if (l === 'project') return <Database className="w-3.5 h-3.5 text-blue-400 shrink-0" />;
    if (l === 'folder') return <Folder className="w-3.5 h-3.5 text-indigo-400 shrink-0" />;
    if (l === 'file') return <FileCode className="w-3.5 h-3.5 text-amber-400 shrink-0" />;
    if (l === 'class' || l === 'interface') return <Box className="w-3.5 h-3.5 text-purple-400 shrink-0" />;
    if (l === 'route') return <Globe className="w-3.5 h-3.5 text-emerald-400 shrink-0" />;
    return <Code2 className="w-3.5 h-3.5 text-cyan-400 shrink-0" />;
  };

  return (
    <div
      ref={containerRef}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      className="relative w-full h-full min-h-[550px] overflow-hidden rounded-2xl bg-black/60 border border-white/5 select-none"
    >
      <svg className="w-full h-full cursor-grab active:cursor-grabbing">
        <defs>
          <marker
            id="tree-chevron"
            viewBox="0 0 10 7"
            refX="8"
            refY="3.5"
            markerWidth="5"
            markerHeight="4"
            orient="auto"
          >
            <polygon points="0 0, 8 3.5, 0 7, 2 3.5" fill="#60a5fa" />
          </marker>
        </defs>

        <rect id="tree-bg" width="100%" height="100%" fill="transparent" />

        <g transform={`translate(${pan.x}, ${pan.y}) scale(${zoom})`}>
          {/* Connecting Horizontal Curves (Left to Right) */}
          {visibleLinks.map((link) => {
            const dx = link.endX - link.startX;
            const pathD = `M ${link.startX} ${link.startY} C ${link.startX + dx * 0.45} ${link.startY}, ${
              link.endX - dx * 0.45
            } ${link.endY}, ${link.endX} ${link.endY}`;

            return (
              <path
                key={link.id}
                d={pathD}
                fill="none"
                stroke={link.color || '#3b82f6'}
                strokeWidth={1.8}
                strokeOpacity={0.7}
                markerEnd="url(#tree-chevron)"
                className="transition-all hover:stroke-white hover:stroke-width-2"
              />
            );
          })}

          {/* Node Cards at Each Column Level */}
          {visibleColumns.map((col, colIdx) => {
            return (
              <g key={`col-group-${colIdx}`}>
                {col.map((item) => {
                  const isExpanded = expandedNodeIds.has(item.node.id);
                  const isSelected =
                    item.node.astNode &&
                    selectedNode &&
                    String(selectedNode.id) === String(item.node.astNode.id);
                  const hasChildren = item.node.children.length > 0;
                  const color = getNodeColor(item.node.label);

                  return (
                    <g
                      key={`card-${item.node.id}`}
                      transform={`translate(${item.x}, ${item.y})`}
                      onClick={() => handleNodeClick(item.node)}
                      className="cursor-pointer"
                    >
                      {/* Card Body */}
                      <rect
                        x={0}
                        y={0}
                        width={item.width}
                        height={item.height}
                        rx={10}
                        fill="rgba(15, 23, 42, 0.95)"
                        stroke={
                          isSelected
                            ? '#60a5fa'
                            : isExpanded
                            ? 'rgba(59, 130, 246, 0.5)'
                            : 'rgba(255, 255, 255, 0.12)'
                        }
                        strokeWidth={isSelected ? 2.5 : isExpanded ? 1.5 : 1}
                        className="transition-all hover:stroke-blue-400"
                      />

                      {/* Left Type Color Strip */}
                      <rect
                        x={0}
                        y={0}
                        width={5}
                        height={item.height}
                        rx={2}
                        fill={color}
                      />

                      {/* Icon */}
                      <g transform="translate(14, 14)">
                        {getNodeIcon(item.node.label)}
                      </g>

                      {/* Name */}
                      <text
                        x={36}
                        y={26}
                        fill={isSelected ? '#93c5fd' : '#f8fafc'}
                        fontSize="11.5"
                        fontWeight="bold"
                        fontFamily="sans-serif"
                        className="pointer-events-none"
                      >
                        {item.node.name.length > 18
                          ? item.node.name.slice(0, 16) + '…'
                          : item.node.name}
                      </text>

                      {/* Type Pill */}
                      <rect
                        x={item.width - 68}
                        y={12}
                        width={46}
                        height={20}
                        rx={5}
                        fill={`${color}18`}
                        stroke={`${color}40`}
                        strokeWidth={0.8}
                      />
                      <text
                        x={item.width - 45}
                        y={26}
                        textAnchor="middle"
                        fill={color}
                        fontSize="9"
                        fontFamily="sans-serif"
                        fontWeight="bold"
                        className="pointer-events-none uppercase"
                      >
                        {item.node.label.length > 7
                          ? item.node.label.slice(0, 6)
                          : item.node.label}
                      </text>

                      {/* Chevron Indicator for Children */}
                      {hasChildren && (
                        <g
                          transform={`translate(${item.width - 18}, 14)`}
                          className="text-gray-400"
                        >
                          <ChevronRight
                            className={`w-3.5 h-3.5 transition-transform ${
                              isExpanded ? 'rotate-90 text-blue-400' : 'text-gray-500'
                            }`}
                          />
                        </g>
                      )}
                    </g>
                  );
                })}
              </g>
            );
          })}
        </g>
      </svg>

      {/* Floating Canvas Controls */}
      <div className="absolute top-3 right-3 flex items-center gap-1.5 p-1.5 rounded-xl bg-black/70 backdrop-blur-md border border-white/10 shadow-lg">
        <button
          onClick={() => setZoom((z) => Math.min(z + 0.2, 2.5))}
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
            setZoom(0.82);
            setPan({ x: 50, y: 50 });
          }}
          className="p-1.5 text-gray-300 hover:text-white rounded-lg hover:bg-white/10 transition-colors"
          title="Reset View"
        >
          <RotateCcw className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Navigation Hint */}
      <div className="absolute bottom-3 left-3 px-3 py-1.5 rounded-xl bg-black/75 backdrop-blur-md border border-white/10 text-[10px] text-gray-400 pointer-events-none">
        Click any card to expand children to the right • Drag to pan • Scroll to zoom
      </div>
    </div>
  );
}
