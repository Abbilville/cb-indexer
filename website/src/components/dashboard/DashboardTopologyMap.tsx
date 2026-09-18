'use client';

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { ProjectOverview, RepoDetail } from '../../types/project';
import { Network, ZoomIn, ZoomOut, RotateCcw, LayoutGrid, ExternalLink } from 'lucide-react';

interface Point {
  x: number;
  y: number;
}

interface DashboardTopologyMapProps {
  overview: ProjectOverview | null;
  onSelectRepo: (repo: RepoDetail) => void;
}

export function DashboardTopologyMap({ overview, onSelectRepo }: DashboardTopologyMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState<Point>({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [dragStart, setDragStart] = useState<Point>({ x: 0, y: 0 });
  const [nodePositions, setNodePositions] = useState<Record<string, Point>>({});
  const [draggingNodeName, setDraggingNodeName] = useState<string | null>(null);
  const [selectedRepoName, setSelectedRepoName] = useState<string | null>(null);

  const repos = useMemo(() => overview?.repos || [], [overview?.repos]);
  const relationships = useMemo(() => overview?.relationships || [], [overview?.relationships]);
  const storageKey = `cb_indexer_topo_positions_${overview?.project_id || 'default'}`;

  // Save node positions to localStorage
  const savePositions = useCallback(
    (positions: Record<string, Point>) => {
      try {
        localStorage.setItem(storageKey, JSON.stringify(positions));
      } catch {
        // storage quota exceeded or disabled
      }
    },
    [storageKey]
  );

  // Initialize or load layout
  useEffect(() => {
    if (repos.length === 0) return;

    let loaded: Record<string, Point> = {};
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved) {
        loaded = JSON.parse(saved) as Record<string, Point>;
      }
    } catch {
      loaded = {};
    }

    const width = containerRef.current?.clientWidth || 800;
    const height = containerRef.current?.clientHeight || 480;
    const centerX = width / 2;
    const centerY = height / 2;
    const radius = Math.min(width, height) * 0.36;

    const newPositions: Record<string, Point> = { ...loaded };

    repos.forEach((repo, idx) => {
      if (!newPositions[repo.name]) {
        // Place gateway / frontend at top or center if detected
        const nameLower = repo.name.toLowerCase();
        if (nameLower.includes('gateway') || nameLower.includes('front')) {
          newPositions[repo.name] = { x: centerX, y: centerY - radius * 0.85 };
        } else {
          const angle = (idx / Math.max(repos.length, 1)) * 2 * Math.PI - Math.PI / 2;
          newPositions[repo.name] = {
            x: centerX + radius * Math.cos(angle),
            y: centerY + radius * Math.sin(angle),
          };
        }
      }
    });

    setNodePositions(newPositions);
  }, [repos, storageKey]);

  // Reset layout to circle
  const handleResetLayout = () => {
    const width = containerRef.current?.clientWidth || 800;
    const height = containerRef.current?.clientHeight || 480;
    const centerX = width / 2;
    const centerY = height / 2;
    const radius = Math.min(width, height) * 0.36;

    const resetPositions: Record<string, Point> = {};
    repos.forEach((repo, idx) => {
      const angle = (idx / Math.max(repos.length, 1)) * 2 * Math.PI - Math.PI / 2;
      resetPositions[repo.name] = {
        x: centerX + radius * Math.cos(angle),
        y: centerY + radius * Math.sin(angle),
      };
    });

    setNodePositions(resetPositions);
    savePositions(resetPositions);
    setPan({ x: 0, y: 0 });
    setZoom(1);
  };

  // Pan interactions
  const handleMouseDown = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).tagName === 'svg' || (e.target as HTMLElement).id === 'topo-bg') {
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
    } else if (draggingNodeName !== null) {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const mouseX = (e.clientX - rect.left - pan.x) / zoom;
      const mouseY = (e.clientY - rect.top - pan.y) / zoom;

      setNodePositions((prev) => ({
        ...prev,
        [draggingNodeName]: { x: mouseX, y: mouseY },
      }));
    }
  };

  const handleMouseUp = () => {
    if (isPanning) {
      setIsPanning(false);
    }
    if (draggingNodeName !== null) {
      setDraggingNodeName(null);
      savePositions(nodePositions);
    }
  };

  return (
    <section className="flex flex-col p-4 sm:p-5 bg-gray-900/60 border border-white/10 rounded-2xl shadow-lg backdrop-blur-md">
      {/* Header with Navigation Link to AST Explorer */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3.5 mb-3 border-b border-white/10">
        <div className="flex items-center gap-2.5">
          <div className="p-2 rounded-xl bg-blue-500/10 border border-blue-500/20 text-blue-400">
            <Network className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-sm sm:text-base font-bold text-white tracking-tight flex items-center gap-2">
              Service Topology Map
              <span className="text-[11px] font-normal text-gray-400 font-mono">
                ({repos.length} services • {relationships.length} links)
              </span>
            </h2>
            <p className="text-[11px] text-gray-500">
              Interactive whiteboard: drag cards to arrange your architecture diagram
            </p>
          </div>
        </div>

        {/* Link to Dedicated AST Knowledge Graph */}
        <div className="flex items-center gap-2">
          <Link
            href="/graph/"
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-xs font-semibold shadow-lg shadow-purple-600/25 transition-all active:scale-95 whitespace-nowrap"
          >
            <span>Open AST Knowledge Graph</span>
            <ExternalLink className="w-3.5 h-3.5" />
          </Link>
        </div>
      </div>

      {/* SVG Canvas */}
      <div
        ref={containerRef}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        className="relative w-full h-[520px] overflow-hidden rounded-2xl bg-black/40 border border-white/5 select-none"
      >
        <svg className="w-full h-full cursor-grab active:cursor-grabbing">
          <defs>
            <marker
              id="arrow-cyan"
              viewBox="0 0 10 7"
              refX="26"
              refY="3.5"
              markerWidth="5"
              markerHeight="4"
              orient="auto"
            >
              <polygon points="0 0, 8 3.5, 0 7, 2 3.5" fill="#06b6d4" />
            </marker>
            <marker
              id="arrow-purple"
              viewBox="0 0 10 7"
              refX="26"
              refY="3.5"
              markerWidth="5"
              markerHeight="4"
              orient="auto"
            >
              <polygon points="0 0, 8 3.5, 0 7, 2 3.5" fill="#a855f7" />
            </marker>
            <marker
              id="arrow-blue"
              viewBox="0 0 10 7"
              refX="26"
              refY="3.5"
              markerWidth="5"
              markerHeight="4"
              orient="auto"
            >
              <polygon points="0 0, 8 3.5, 0 7, 2 3.5" fill="#3b82f6" />
            </marker>
          </defs>

          <rect id="topo-bg" width="100%" height="100%" fill="transparent" />

          <g transform={`translate(${pan.x}, ${pan.y}) scale(${zoom})`}>
            {/* Curved Bezier Relationship Arcs */}
            {relationships.map((rel, i) => {
              const p1 = nodePositions[rel.source];
              const p2 = nodePositions[rel.target];
              if (!p1 || !p2) return null;

              const dx = p2.x - p1.x;
              const dy = p2.y - p1.y;
              const cx = (p1.x + p2.x) / 2 - dy * 0.18;
              const cy = (p1.y + p2.y) / 2 + dx * 0.18;
              const pathD = `M ${p1.x} ${p1.y} Q ${cx} ${cy} ${p2.x} ${p2.y}`;

              const typeLower = rel.type.toLowerCase();
              const isRegistry = typeLower.includes('registry') || typeLower.includes('register');
              const isGateway = typeLower.includes('gateway') || typeLower.includes('route');
              const color = isGateway ? '#06b6d4' : isRegistry ? '#a855f7' : '#3b82f6';
              const markerId = isGateway ? 'url(#arrow-cyan)' : isRegistry ? 'url(#arrow-purple)' : 'url(#arrow-blue)';

              return (
                <g key={`rel-${rel.source}-${rel.target}-${i}`}>
                  <path
                    d={pathD}
                    fill="none"
                    stroke={color}
                    strokeWidth={1.8}
                    strokeDasharray={isRegistry ? '4,3' : undefined}
                    markerEnd={markerId}
                    className="transition-all opacity-85 hover:opacity-100 hover:stroke-white"
                  />
                  {/* Midpoint relation text badge */}
                  <text
                    x={cx}
                    y={cy}
                    textAnchor="middle"
                    fill={color}
                    fontSize="9"
                    fontFamily="monospace"
                    className="pointer-events-none select-none"
                  >
                    {rel.type}
                  </text>
                </g>
              );
            })}

            {/* Service Node Cards */}
            {repos.map((repo) => {
              const pos = nodePositions[repo.name] || { x: 150, y: 150 };
              const isSelected = selectedRepoName === repo.name;
              const nameLower = repo.name.toLowerCase();
              const isGateway = nameLower.includes('gateway') || nameLower.includes('front');

              return (
                <g
                  key={repo.name}
                  transform={`translate(${pos.x}, ${pos.y})`}
                  onMouseDown={(e) => {
                    e.stopPropagation();
                    setDraggingNodeName(repo.name);
                    setSelectedRepoName(repo.name);
                  }}
                  onDoubleClick={() => onSelectRepo(repo)}
                  className="cursor-pointer"
                >
                  {/* Card Background */}
                  <rect
                    x="-82"
                    y="-32"
                    width="164"
                    height="64"
                    rx="14"
                    fill="rgba(13, 19, 33, 0.95)"
                    stroke={
                      isSelected
                        ? '#60a5fa'
                        : isGateway
                        ? '#06b6d4'
                        : repo.is_indexed
                        ? 'rgba(16, 185, 129, 0.3)'
                        : 'rgba(255, 255, 255, 0.12)'
                    }
                    strokeWidth={isSelected ? 2.5 : 1.2}
                    className="transition-all hover:stroke-blue-400"
                  />

                  {/* Header: Name + Port */}
                  <text
                    x="-70"
                    y="-12"
                    textAnchor="start"
                    fill="#f8fafc"
                    fontSize="11.5"
                    fontWeight="bold"
                    fontFamily="sans-serif"
                    className="pointer-events-none"
                  >
                    {repo.name.length > 17 ? repo.name.slice(0, 16) + '…' : repo.name}
                  </text>

                  {repo.port && (
                    <text
                      x="70"
                      y="-12"
                      textAnchor="end"
                      fill="#38bdf8"
                      fontSize="9.5"
                      fontFamily="monospace"
                      className="pointer-events-none"
                    >
                      :{repo.port}
                    </text>
                  )}

                  {/* Divider */}
                  <line x1="-70" y1="-2" x2="70" y2="-2" stroke="rgba(255,255,255,0.08)" strokeWidth="1" />

                  {/* Status Badges */}
                  <circle
                    cx="-65"
                    cy="14"
                    r="3.5"
                    fill={repo.is_indexed ? '#10b981' : '#f59e0b'}
                    className="pointer-events-none"
                  />
                  <text
                    x="-55"
                    y="17"
                    textAnchor="start"
                    fill={repo.is_indexed ? '#a7f3d0' : '#fde68a'}
                    fontSize="9"
                    fontFamily="sans-serif"
                    className="pointer-events-none"
                  >
                    {repo.is_indexed ? 'Indexed' : 'Unindexed'}
                  </text>

                  {/* Tech stack or AST count */}
                  <text
                    x="70"
                    y="17"
                    textAnchor="end"
                    fill="#94a3b8"
                    fontSize="9"
                    fontFamily="monospace"
                    className="pointer-events-none"
                  >
                    {repo.index_nodes ? `${repo.index_nodes} nodes` : isGateway ? 'Gateway' : 'Service'}
                  </text>
                </g>
              );
            })}
          </g>
        </svg>

        {/* Floating Canvas Controls */}
        <div className="absolute top-3 right-3 flex items-center gap-1.5 p-1.5 rounded-xl bg-black/70 backdrop-blur-md border border-white/10 shadow-lg">
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
            title="Reset Pan & Zoom"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={handleResetLayout}
            className="p-1.5 text-gray-300 hover:text-white rounded-lg hover:bg-white/10 transition-colors"
            title="Reset to Circle Layout"
          >
            <LayoutGrid className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Legend */}
        <div className="absolute bottom-3 left-3 flex items-center gap-3 px-3 py-1.5 rounded-xl bg-black/75 backdrop-blur-md border border-white/10 text-[10px] text-gray-400 pointer-events-none flex-wrap">
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
            Indexed AST
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-amber-500" />
            Unindexed
          </span>
          <span className="flex items-center gap-1.5 text-cyan-400">
            <span>──►</span> Gateway Route
          </span>
          <span className="flex items-center gap-1.5 text-purple-400">
            <span>- -►</span> Service Registry
          </span>
          <span className="flex items-center gap-1.5 text-blue-400">
            <span>──►</span> API Call
          </span>
        </div>
      </div>
    </section>
  );
}
