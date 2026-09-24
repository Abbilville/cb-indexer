'use client';

import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { X, ChevronDown, ChevronUp, ArrowLeft, ArrowRight, Copy, FileCode, Hash } from 'lucide-react';
import { CodeViewerProps, FileTab, NavHistoryEntry, SourceLocation, LineNodeIndicator, inferLanguage } from '../../types/codeviewer';
import { GraphNode } from '../../types/graph';
import { getNodeColor } from './utils';
import { ApiService } from '../../services/api';
import { useToast } from '../ui/Toast';

const MAX_TABS = 8;
const MAX_HISTORY = 50;
const DEFAULT_PANEL_HEIGHT = 280;
const MIN_PANEL_HEIGHT = 150;
const LS_KEY = 'CB_CODE_VIEWER_HEIGHT';
const HOVER_DEBOUNCE_MS = 100;
const CONTEXT_PADDING = 25; // ~50 lines centered means 25 lines each side

function basename(filePath: string): string {
  const parts = filePath.replace(/\\/g, '/').split('/');
  return parts[parts.length - 1] || filePath;
}

function makeTabId(projectId: string, repoName: string, filePath: string): string {
  return `${projectId}:${repoName}:${filePath}`;
}

export function CodeViewer({
  isOpen,
  onToggle,
  selectedNode,
  hoveredNodeId,
  graphNodes,
  graphEdges,
  projectId,
  selectedRepo,
  graphScope,
  analysisMode,
  highlightedNodeIds,
  onSelectNode,
  onHoverNode,
}: CodeViewerProps) {
  const { showToast } = useToast();

  // Content state
  const [content, setContent] = useState<string[]>([]);
  const [contentStartLine, setContentStartLine] = useState(1);
  const [isLoadingFile, setIsLoadingFile] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Tab state
  const [fileTabs, setFileTabs] = useState<FileTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);

  // Navigation history
  const [navHistory, setNavHistory] = useState<NavHistoryEntry[]>([]);
  const [navHistoryIndex, setNavHistoryIndex] = useState(-1);

  // Panel state
  const [panelHeight, setPanelHeight] = useState(() => {
    if (typeof window === 'undefined') return DEFAULT_PANEL_HEIGHT;
    const stored = localStorage.getItem(LS_KEY);
    return stored ? Math.max(MIN_PANEL_HEIGHT, parseInt(stored, 10) || DEFAULT_PANEL_HEIGHT) : DEFAULT_PANEL_HEIGHT;
  });
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [isResizing, setIsResizing] = useState(false);

  // Multi-node popover
  const [multiNodePopover, setMultiNodePopover] = useState<{
    line: number;
    nodes: LineNodeIndicator[];
    x: number;
    y: number;
  } | null>(null);

  // Go-to-line input
  const [gotoLineValue, setGotoLineValue] = useState('');
  const [showGotoInput, setShowGotoInput] = useState(false);

  // Refs
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const resizeStartRef = useRef<{ startY: number; startHeight: number } | null>(null);
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const popoverRef = useRef<HTMLDivElement>(null);
  const lastLoadedNodeIdRef = useRef<string | number | null>(null);

  // Content cache per tab
  const contentCacheRef = useRef<Map<string, { lines: string[]; startLine: number }>>(new Map());

  // -- Derived data --

  // Map of line -> nodes for the current file
  const lineNodesMap = useMemo(() => {
    const map = new Map<number, GraphNode[]>();
    if (!activeTabId) return map;
    const activeTab = fileTabs.find(t => t.id === activeTabId);
    if (!activeTab) return map;

    for (const node of graphNodes) {
      if (
        node.file_path &&
        node.start_line != null &&
        node.file_path === activeTab.filePath
      ) {
        const line = node.start_line;
        const existing = map.get(line);
        if (existing) {
          existing.push(node);
        } else {
          map.set(line, [node]);
        }
      }
    }
    return map;
  }, [graphNodes, activeTabId, fileTabs]);

  // Selected node's line range
  const selectedLineRange = useMemo<{ start: number; end: number } | null>(() => {
    if (!selectedNode?.file_path || selectedNode.start_line == null) return null;
    const activeTab = fileTabs.find(t => t.id === activeTabId);
    if (!activeTab || activeTab.filePath !== selectedNode.file_path) return null;
    return {
      start: selectedNode.start_line,
      end: selectedNode.end_line ?? selectedNode.start_line,
    };
  }, [selectedNode, activeTabId, fileTabs]);

  // Hovered node's line range
  const hoveredLineRange = useMemo<{ start: number; end: number } | null>(() => {
    if (hoveredNodeId == null) return null;
    const activeTab = fileTabs.find(t => t.id === activeTabId);
    if (!activeTab) return null;
    const node = graphNodes.find(
      n => n.id === hoveredNodeId && n.file_path === activeTab.filePath
    );
    if (!node || node.start_line == null) return null;
    return { start: node.start_line, end: node.end_line ?? node.start_line };
  }, [hoveredNodeId, graphNodes, activeTabId, fileTabs]);

  // Highlighted analysis node line ranges
  const highlightedLineRanges = useMemo(() => {
    const ranges: { start: number; end: number }[] = [];
    if (highlightedNodeIds.size === 0) return ranges;
    const activeTab = fileTabs.find(t => t.id === activeTabId);
    if (!activeTab) return ranges;

    for (const node of graphNodes) {
      if (
        highlightedNodeIds.has(node.id) &&
        node.file_path === activeTab.filePath &&
        node.start_line != null
      ) {
        ranges.push({
          start: node.start_line,
          end: node.end_line ?? node.start_line,
        });
      }
    }
    return ranges;
  }, [highlightedNodeIds, graphNodes, activeTabId, fileTabs]);

  // -- Load content --

  const loadCodeContext = useCallback(
    async (filePath: string, startLine: number, endLine: number | undefined, forceReload = false) => {
      const tabId = makeTabId(projectId, selectedRepo, filePath);
      const cached = contentCacheRef.current.get(tabId);
      if (!forceReload && cached) {
        setContent(cached.lines);
        setContentStartLine(cached.startLine);
        setError(null);
        return;
      }

      setIsLoadingFile(true);
      setError(null);
      try {
        const resp = await ApiService.getCodeContext({
          project: projectId,
          repo: selectedRepo,
          file: filePath,
          start: startLine,
          end: endLine,
          padding: CONTEXT_PADDING,
        });
        const snippet = resp.context?.snippet || '';
        const lines = snippet.split('\n');
        const actualStart = resp.context?.start_line ?? Math.max(1, startLine - CONTEXT_PADDING);
        setContent(lines);
        setContentStartLine(actualStart);
        setError(null);
        // Cache
        contentCacheRef.current.set(tabId, { lines, startLine: actualStart });
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Failed to load source code';
        setError(msg);
        showToast(msg, 'error');
        setContent([]);
      } finally {
        setIsLoadingFile(false);
      }
    },
    [projectId, selectedRepo, showToast]
  );

  // Scroll to a specific line number within the loaded content
  const scrollToLine = useCallback(
    (line: number) => {
      const container = scrollContainerRef.current;
      if (!container) return;
      const lineIndex = line - contentStartLine;
      if (lineIndex < 0 || lineIndex >= content.length) return;
      // Each line is ~20px
      const lineHeight = 20;
      const scrollTarget = lineIndex * lineHeight - container.clientHeight / 2 + lineHeight;
      container.scrollTo({ top: Math.max(0, scrollTarget), behavior: 'smooth' });
    },
    [contentStartLine, content.length]
  );

  // -- Tab management --

  const addOrUpdateTab = useCallback(
    (filePath: string, line: number, nodeId?: string | number) => {
      const tabId = makeTabId(projectId, selectedRepo, filePath);
      setFileTabs(prev => {
        const existing = prev.find(t => t.id === tabId);
        if (existing) {
          return prev.map(t =>
            t.id === tabId ? { ...t, lastLine: line, lastNodeId: nodeId } : t
          );
        }
        const newTab: FileTab = {
          id: tabId,
          filePath,
          repoName: selectedRepo,
          projectId,
          language: inferLanguage(filePath),
          lastLine: line,
          lastNodeId: nodeId,
        };
        const updated = [...prev, newTab];
        // LRU eviction
        if (updated.length > MAX_TABS) {
          return updated.slice(updated.length - MAX_TABS);
        }
        return updated;
      });
      setActiveTabId(tabId);
    },
    [projectId, selectedRepo]
  );

  const closeTab = useCallback(
    (tabId: string) => {
      setFileTabs(prev => {
        const remaining = prev.filter(t => t.id !== tabId);
        if (remaining.length === 0) return prev; // keep at least one
        return remaining;
      });
      if (activeTabId === tabId) {
        setFileTabs(prev => {
          const remaining = prev.filter(t => t.id !== tabId);
          if (remaining.length > 0) {
            setActiveTabId(remaining[remaining.length - 1].id);
          }
          return remaining.length > 0 ? remaining : prev;
        });
      }
      contentCacheRef.current.delete(tabId);
    },
    [activeTabId]
  );

  const switchTab = useCallback(
    (tabId: string) => {
      const tab = fileTabs.find(t => t.id === tabId);
      if (!tab) return;
      setActiveTabId(tabId);
      const cached = contentCacheRef.current.get(tabId);
      if (cached) {
        setContent(cached.lines);
        setContentStartLine(cached.startLine);
        setError(null);
        // Defer scroll to after render
        requestAnimationFrame(() => scrollToLine(tab.lastLine));
      } else {
        loadCodeContext(tab.filePath, tab.lastLine, undefined);
      }
    },
    [fileTabs, loadCodeContext, scrollToLine]
  );

  // -- Navigation history --

  const pushNavHistory = useCallback(
    (location: SourceLocation, tab: FileTab) => {
      const entry: NavHistoryEntry = {
        sourceLocation: location,
        fileTab: tab,
        timestamp: Date.now(),
      };
      setNavHistory(prev => {
        // Truncate forward history
        const truncated = prev.slice(0, navHistoryIndex + 1);
        const updated = [...truncated, entry];
        if (updated.length > MAX_HISTORY) {
          return updated.slice(updated.length - MAX_HISTORY);
        }
        return updated;
      });
      setNavHistoryIndex(prev => Math.min(prev + 1, MAX_HISTORY - 1));
    },
    [navHistoryIndex]
  );

  const navigateBack = useCallback(() => {
    if (navHistoryIndex <= 0) return;
    const newIndex = navHistoryIndex - 1;
    const entry = navHistory[newIndex];
    if (!entry) return;
    setNavHistoryIndex(newIndex);
    const tabId = entry.fileTab.id;
    setActiveTabId(tabId);
    loadCodeContext(entry.fileTab.filePath, entry.sourceLocation.startLine, undefined).then(() => {
      scrollToLine(entry.sourceLocation.startLine);
    });
  }, [navHistory, navHistoryIndex, loadCodeContext, scrollToLine]);

  const navigateForward = useCallback(() => {
    if (navHistoryIndex >= navHistory.length - 1) return;
    const newIndex = navHistoryIndex + 1;
    const entry = navHistory[newIndex];
    if (!entry) return;
    setNavHistoryIndex(newIndex);
    const tabId = entry.fileTab.id;
    setActiveTabId(tabId);
    loadCodeContext(entry.fileTab.filePath, entry.sourceLocation.startLine, undefined).then(() => {
      scrollToLine(entry.sourceLocation.startLine);
    });
  }, [navHistory, navHistoryIndex, loadCodeContext, scrollToLine]);

  // -- Auto-load on node selection --

  useEffect(() => {
    if (!selectedNode?.file_path || selectedNode.start_line == null) return;
    if (lastLoadedNodeIdRef.current === selectedNode.id) return;
    lastLoadedNodeIdRef.current = selectedNode.id;

    const filePath = selectedNode.file_path;
    const startLine = selectedNode.start_line;
    const endLine = selectedNode.end_line;

    // Add/update tab
    addOrUpdateTab(filePath, startLine, selectedNode.id);

    // Load code
    loadCodeContext(filePath, startLine, endLine, true).then(() => {
      requestAnimationFrame(() => scrollToLine(startLine));
    });

    // Push to nav history
    const tabId = makeTabId(projectId, selectedRepo, filePath);
    const tab: FileTab = {
      id: tabId,
      filePath,
      repoName: selectedRepo,
      projectId,
      language: inferLanguage(filePath),
      lastLine: startLine,
      lastNodeId: selectedNode.id,
    };
    pushNavHistory(
      {
        filePath,
        startLine,
        endLine: endLine ?? startLine,
        nodeId: selectedNode.id,
        nodeLabel: selectedNode.label,
        nodeName: selectedNode.name,
      },
      tab
    );

    // Expand if collapsed
    if (isCollapsed) setIsCollapsed(false);
  }, [selectedNode, projectId, selectedRepo, addOrUpdateTab, loadCodeContext, scrollToLine, pushNavHistory, isCollapsed]);

  // -- Resize handling --

  const handleResizeStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      setIsResizing(true);
      resizeStartRef.current = { startY: e.clientY, startHeight: panelHeight };

      const handleMouseMove = (ev: MouseEvent) => {
        if (!resizeStartRef.current) return;
        const delta = resizeStartRef.current.startY - ev.clientY;
        const maxH = window.innerHeight * 0.6;
        const newHeight = Math.min(maxH, Math.max(MIN_PANEL_HEIGHT, resizeStartRef.current.startHeight + delta));
        setPanelHeight(newHeight);
      };

      const handleMouseUp = () => {
        setIsResizing(false);
        resizeStartRef.current = null;
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
        // Persist
        localStorage.setItem(LS_KEY, String(Math.round(panelHeight)));
      };

      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    },
    [panelHeight]
  );

  // Persist height on change
  useEffect(() => {
    if (!isResizing) {
      localStorage.setItem(LS_KEY, String(Math.round(panelHeight)));
    }
  }, [panelHeight, isResizing]);

  // -- Line click → graph sync --

  const handleLineClick = useCallback(
    (lineNum: number, e: React.MouseEvent) => {
      const nodesOnLine = lineNodesMap.get(lineNum);
      if (!nodesOnLine || nodesOnLine.length === 0) return;

      if (nodesOnLine.length === 1) {
        onSelectNode(nodesOnLine[0]);
        setMultiNodePopover(null);
      } else {
        // Show multi-node popover
        const indicators: LineNodeIndicator[] = nodesOnLine.map(n => ({
          nodeId: n.id,
          nodeLabel: n.label,
          nodeName: n.name,
          qualifiedName: n.qualified_name,
        }));
        setMultiNodePopover({
          line: lineNum,
          nodes: indicators,
          x: e.clientX,
          y: e.clientY,
        });
      }
    },
    [lineNodesMap, onSelectNode]
  );

  // Close popover on click-outside or Escape
  useEffect(() => {
    if (!multiNodePopover) return;

    const handleClick = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setMultiNodePopover(null);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMultiNodePopover(null);
    };

    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [multiNodePopover]);

  // -- Hover sync --

  const handleLineHover = useCallback(
    (lineNum: number) => {
      clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = setTimeout(() => {
        const nodesOnLine = lineNodesMap.get(lineNum);
        if (nodesOnLine && nodesOnLine.length > 0) {
          onHoverNode(nodesOnLine[0].id);
        }
      }, HOVER_DEBOUNCE_MS);
    },
    [lineNodesMap, onHoverNode]
  );

  const handleLineLeave = useCallback(() => {
    clearTimeout(hoverTimerRef.current);
    hoverTimerRef.current = undefined;
    onHoverNode(null);
  }, [onHoverNode]);

  // -- Hover from graph → code scroll --
  useEffect(() => {
    if (hoveredNodeId == null) return;
    if (!hoveredLineRange) return;
    // Don't auto-scroll on hover, just highlight (scrolling on hover is jarring)
  }, [hoveredNodeId, hoveredLineRange]);

  // -- Go to line --

  const handleGotoLine = useCallback(() => {
    const line = parseInt(gotoLineValue, 10);
    if (isNaN(line) || line < 1) return;
    scrollToLine(line);
    setShowGotoInput(false);
    setGotoLineValue('');
  }, [gotoLineValue, scrollToLine]);

  // -- Copy handlers --

  const handleCopyFilePath = useCallback(() => {
    const activeTab = fileTabs.find(t => t.id === activeTabId);
    if (!activeTab) return;
    navigator.clipboard.writeText(activeTab.filePath).then(() => {
      showToast('File path copied', 'success');
    });
  }, [activeTabId, fileTabs, showToast]);

  const handleCopyCode = useCallback(() => {
    if (content.length === 0) return;
    navigator.clipboard.writeText(content.join('\n')).then(() => {
      showToast('Code copied to clipboard', 'success');
    });
  }, [content, showToast]);

  // -- Multi-node popover select --

  const handlePopoverNodeSelect = useCallback(
    (indicator: LineNodeIndicator) => {
      const node = graphNodes.find(n => n.id === indicator.nodeId);
      if (node) {
        onSelectNode(node);
      }
      setMultiNodePopover(null);
    },
    [graphNodes, onSelectNode]
  );

  // -- Determine line styling --

  const getLineClass = useCallback(
    (lineNum: number): string => {
      // Selected node's range
      if (
        selectedLineRange &&
        lineNum >= selectedLineRange.start &&
        lineNum <= selectedLineRange.end
      ) {
        return 'bg-cyan-500/15 border-l-2 border-cyan-400';
      }
      // Hovered node's range
      if (
        hoveredLineRange &&
        lineNum >= hoveredLineRange.start &&
        lineNum <= hoveredLineRange.end
      ) {
        return 'bg-white/5 border-l-2 border-white/20';
      }
      // Highlighted analysis path
      for (const range of highlightedLineRanges) {
        if (lineNum >= range.start && lineNum <= range.end) {
          return 'bg-blue-500/10 border-l-2 border-blue-400/30';
        }
      }
      return 'border-l-2 border-transparent';
    },
    [selectedLineRange, hoveredLineRange, highlightedLineRanges]
  );

  // -- Render node indicators for a line --

  const getLineIndicators = useCallback(
    (lineNum: number): LineNodeIndicator[] => {
      const nodes = lineNodesMap.get(lineNum);
      if (!nodes) return [];
      return nodes.map(n => ({
        nodeId: n.id,
        nodeLabel: n.label,
        nodeName: n.name,
        qualifiedName: n.qualified_name,
      }));
    },
    [lineNodesMap]
  );

  if (!isOpen) return null;

  const activeTab = fileTabs.find(t => t.id === activeTabId);

  return (
    <div
      className="fixed bottom-0 left-0 right-0 z-40 bg-gray-950/95 border-t border-white/10 backdrop-blur-xl shadow-2xl flex flex-col"
      style={{ height: isCollapsed ? 32 : panelHeight }}
    >
      {/* Resize handle */}
      {!isCollapsed && (
        <div
          className="absolute top-0 left-0 right-0 h-1.5 cursor-ns-resize hover:bg-cyan-500/30 transition-colors z-10"
          onMouseDown={handleResizeStart}
        />
      )}

      {/* Header bar */}
      <div className="bg-gray-900/80 border-b border-white/10 px-3 py-1.5 flex items-center gap-2 shrink-0 select-none min-h-[32px]">
        {/* Collapse toggle */}
        <button
          onClick={() => setIsCollapsed(prev => !prev)}
          className="text-gray-400 hover:text-white p-0.5 rounded transition-colors"
          title={isCollapsed ? 'Expand' : 'Collapse'}
        >
          {isCollapsed ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
        </button>

        <div className="flex items-center gap-1.5 text-[11px] text-gray-400 font-medium shrink-0">
          <FileCode className="w-3.5 h-3.5 text-cyan-400" />
          <span>Code Viewer</span>
        </div>

        {/* File tabs */}
        <div className="flex items-center gap-0.5 ml-2 overflow-x-auto no-scrollbar flex-1 min-w-0">
          {fileTabs.map(tab => (
            <div
              key={tab.id}
              className={`flex items-center gap-1.5 px-3 py-1 text-[11px] font-mono rounded-t cursor-pointer transition-colors shrink-0 border border-white/10 ${
                tab.id === activeTabId
                  ? 'bg-gray-700/80 text-white border-b-transparent'
                  : 'bg-gray-800/60 text-gray-400 hover:text-gray-200 hover:bg-gray-800/80'
              }`}
              onClick={() => switchTab(tab.id)}
              title={tab.filePath}
            >
              <span className="max-w-[120px] truncate">{basename(tab.filePath)}</span>
              {fileTabs.length > 1 && (
                <button
                  onClick={e => {
                    e.stopPropagation();
                    closeTab(tab.id);
                  }}
                  className="text-gray-500 hover:text-gray-200 transition-colors ml-0.5"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
          ))}
        </div>

        {/* Navigation & tools (right side) */}
        <div className="flex items-center gap-1 shrink-0 ml-auto">
          {/* Nav back/forward */}
          <button
            onClick={navigateBack}
            disabled={navHistoryIndex <= 0}
            className="p-1 rounded text-gray-400 hover:text-white disabled:text-gray-700 disabled:cursor-not-allowed transition-colors"
            title="Navigate back"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={navigateForward}
            disabled={navHistoryIndex >= navHistory.length - 1}
            className="p-1 rounded text-gray-400 hover:text-white disabled:text-gray-700 disabled:cursor-not-allowed transition-colors"
            title="Navigate forward"
          >
            <ArrowRight className="w-3.5 h-3.5" />
          </button>

          <div className="w-px h-4 bg-white/10 mx-1" />

          {/* Copy file path */}
          <button
            onClick={handleCopyFilePath}
            className="p-1 rounded text-gray-400 hover:text-white transition-colors"
            title="Copy file path"
          >
            <Copy className="w-3.5 h-3.5" />
          </button>

          {/* Copy code */}
          <button
            onClick={handleCopyCode}
            className="p-1 rounded text-gray-400 hover:text-white transition-colors"
            title="Copy visible code"
          >
            <FileCode className="w-3.5 h-3.5" />
          </button>

          {/* Go to line */}
          {showGotoInput ? (
            <div className="flex items-center gap-1">
              <input
                type="text"
                value={gotoLineValue}
                onChange={e => setGotoLineValue(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') handleGotoLine();
                  if (e.key === 'Escape') {
                    setShowGotoInput(false);
                    setGotoLineValue('');
                  }
                }}
                placeholder="Line"
                className="w-16 px-1.5 py-0.5 text-[11px] font-mono bg-gray-800 border border-white/15 rounded text-gray-200 placeholder-gray-600 focus:outline-none focus:border-cyan-500/50"
                autoFocus
              />
            </div>
          ) : (
            <button
              onClick={() => setShowGotoInput(true)}
              className="p-1 rounded text-gray-400 hover:text-white transition-colors"
              title="Go to line"
            >
              <Hash className="w-3.5 h-3.5" />
            </button>
          )}

          <div className="w-px h-4 bg-white/10 mx-1" />

          {/* Close */}
          <button
            onClick={onToggle}
            className="p-1 rounded text-gray-400 hover:text-white transition-colors"
            title="Close code viewer"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Code content area */}
      {!isCollapsed && (
        <div
          ref={scrollContainerRef}
          className="flex-1 overflow-auto font-mono text-[12px] leading-relaxed select-text"
        >
          {isLoadingFile && (
            <div className="flex items-center justify-center h-full text-gray-500 text-[11px] gap-2">
              <div className="w-4 h-4 border-2 border-gray-600 border-t-cyan-400 rounded-full animate-spin" />
              Loading source...
            </div>
          )}

          {error && !isLoadingFile && (
            <div className="flex items-center justify-center h-full text-rose-400/80 text-[11px] px-4">
              {error}
            </div>
          )}

          {!isLoadingFile && !error && content.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full text-gray-600 text-[11px] gap-1.5">
              <FileCode className="w-5 h-5 text-gray-700" />
              <span>Select a node to view its source code</span>
            </div>
          )}

          {!isLoadingFile && !error && content.length > 0 && (
            <table className="w-full border-collapse">
              <tbody>
                {content.map((line, idx) => {
                  const lineNum = contentStartLine + idx;
                  const lineClass = getLineClass(lineNum);
                  const indicators = getLineIndicators(lineNum);
                  const hasNodes = indicators.length > 0;

                  return (
                    <tr
                      key={lineNum}
                      className={`${lineClass} transition-colors duration-75 ${
                        hasNodes ? 'cursor-pointer hover:bg-white/5' : ''
                      }`}
                      onClick={hasNodes ? (e) => handleLineClick(lineNum, e) : undefined}
                      onMouseEnter={hasNodes ? () => handleLineHover(lineNum) : undefined}
                      onMouseLeave={hasNodes ? handleLineLeave : undefined}
                    >
                      {/* Line number */}
                      <td className="text-gray-600 text-[11px] font-mono w-12 text-right pr-3 select-none align-top whitespace-nowrap py-px">
                        {lineNum}
                      </td>

                      {/* Node indicator(s) */}
                      <td className="w-5 text-center align-top py-px">
                        {indicators.length > 0 && (
                          <div className="flex items-center justify-center gap-px pt-[3px]">
                            {indicators.slice(0, 3).map((ind, i) => (
                              <span
                                key={i}
                                className="inline-block w-1.5 h-1.5 rounded-full shrink-0"
                                style={{ backgroundColor: getNodeColor(ind.nodeLabel) }}
                                title={`${ind.nodeLabel}: ${ind.nodeName}`}
                              />
                            ))}
                            {indicators.length > 3 && (
                              <span className="text-[8px] text-gray-500">+{indicators.length - 3}</span>
                            )}
                          </div>
                        )}
                      </td>

                      {/* Code text */}
                      <td className="text-gray-200 text-[12px] font-mono whitespace-pre pl-2 py-px align-top">
                        {line}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* Multi-node popover */}
      {multiNodePopover && (
        <div
          ref={popoverRef}
          className="fixed z-50 bg-gray-900 border border-white/15 rounded-xl shadow-2xl p-2 min-w-48 backdrop-blur-xl"
          style={{
            left: Math.min(multiNodePopover.x, window.innerWidth - 220),
            top: multiNodePopover.y - 10,
            transform: 'translateY(-100%)',
          }}
        >
          <div className="text-[10px] text-gray-500 mb-1.5 px-1">
            Line {multiNodePopover.line} — {multiNodePopover.nodes.length} nodes
          </div>
          {multiNodePopover.nodes.map(ind => (
            <button
              key={String(ind.nodeId)}
              onClick={() => handlePopoverNodeSelect(ind)}
              className="flex items-center gap-2 w-full px-2 py-1.5 rounded-lg text-left hover:bg-white/10 transition-colors"
            >
              <span
                className="inline-block px-1.5 py-0.5 rounded text-[9px] font-semibold uppercase tracking-wide"
                style={{
                  backgroundColor: getNodeColor(ind.nodeLabel) + '30',
                  color: getNodeColor(ind.nodeLabel),
                }}
              >
                {ind.nodeLabel}
              </span>
              <span className="text-[11px] text-gray-200 truncate">{ind.nodeName}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
