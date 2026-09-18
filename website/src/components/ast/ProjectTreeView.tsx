'use client';

import React, { useState, useMemo } from 'react';
import { GraphNode } from '../../types/graph';
import { getNodeColor } from '../graph/utils';
import {
  Folder,
  FolderOpen,
  FileCode,
  Box,
  Code2,
  Globe,
  ChevronRight,
  ChevronDown,
  Search,
  X,
} from 'lucide-react';

interface TreeNode {
  id: string;
  name: string;
  label: string;
  node?: GraphNode;
  children: TreeNode[];
  childMap: Map<string, TreeNode>;
}

interface ProjectTreeViewProps {
  nodes: GraphNode[];
  selectedNode: GraphNode | null;
  onSelectNode: (node: GraphNode) => void;
}

export function ProjectTreeView({ nodes, selectedNode, onSelectNode }: ProjectTreeViewProps) {
  const [filterText, setFilterText] = useState('');
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set(['root']));

  // Build hierarchical tree from flat AST nodes based on file_path and qualified_name
  const rootTree = useMemo(() => {
    const root: TreeNode = {
      id: 'root',
      name: 'Project Root',
      label: 'Project',
      children: [],
      childMap: new Map(),
    };

    nodes.forEach((node) => {
      const filePath = node.file_path || node.name || 'global';
      const parts = filePath.split(/[/\\]/).filter(Boolean);

      let current = root;
      let pathAcc = '';

      // Traverse/create folder and file branches
      parts.forEach((part, index) => {
        pathAcc = pathAcc ? `${pathAcc}/${part}` : part;
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

      // If this node represents a fine-grained symbol inside the file (function, class, route, etc.)
      if (
        node.label !== 'File' &&
        node.label !== 'Folder' &&
        node.label !== 'Branch' &&
        node.label !== 'Project'
      ) {
        const symbolNode: TreeNode = {
          id: String(node.id),
          name: node.name,
          label: node.label,
          node,
          children: [],
          childMap: new Map(),
        };
        current.children.push(symbolNode);
      } else if (!current.node) {
        current.node = node;
      }
    });

    return root;
  }, [nodes]);

  const toggleExpand = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setExpandedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const getNodeIcon = (label: string, isExpanded?: boolean) => {
    const l = label.toLowerCase();
    if (l === 'folder' || l === 'project') {
      return isExpanded ? (
        <FolderOpen className="w-3.5 h-3.5 text-blue-400 shrink-0" />
      ) : (
        <Folder className="w-3.5 h-3.5 text-blue-400 shrink-0" />
      );
    }
    if (l === 'file') {
      return <FileCode className="w-3.5 h-3.5 text-amber-400 shrink-0" />;
    }
    if (l === 'class' || l === 'interface') {
      return <Box className="w-3.5 h-3.5 text-purple-400 shrink-0" />;
    }
    if (l === 'route') {
      return <Globe className="w-3.5 h-3.5 text-emerald-400 shrink-0" />;
    }
    return <Code2 className="w-3.5 h-3.5 text-cyan-400 shrink-0" />;
  };

  // Recursive render of tree items
  const renderItem = (item: TreeNode, depth = 0): React.ReactNode => {
    const hasChildren = item.children.length > 0;
    const isExpanded = expandedKeys.has(item.id) || !!filterText.trim();
    const isSelected = item.node && selectedNode && String(selectedNode.id) === String(item.node.id);

    // If search filter is active, filter node visibility
    if (filterText.trim()) {
      const q = filterText.toLowerCase();
      const matchesSelf = item.name.toLowerCase().includes(q) || item.label.toLowerCase().includes(q);
      const matchesChild = item.children.some(
        (c) => c.name.toLowerCase().includes(q) || c.label.toLowerCase().includes(q)
      );
      if (!matchesSelf && !matchesChild && depth > 0) {
        return null;
      }
    }

    const color = getNodeColor(item.label);

    return (
      <div key={item.id} className="flex flex-col">
        <div
          onClick={() => {
            if (item.node) {
              onSelectNode(item.node);
            } else if (hasChildren) {
              setExpandedKeys((prev) => {
                const next = new Set(prev);
                if (next.has(item.id)) next.delete(item.id);
                else next.add(item.id);
                return next;
              });
            }
          }}
          style={{ paddingLeft: `${depth * 14 + 6}px` }}
          className={`flex items-center gap-1.5 py-1 px-2 rounded-lg cursor-pointer text-xs font-mono transition-colors ${
            isSelected
              ? 'bg-blue-600/30 text-blue-200 font-semibold border border-blue-500/40'
              : 'hover:bg-white/5 text-gray-300'
          }`}
        >
          {hasChildren ? (
            <button
              onClick={(e) => toggleExpand(item.id, e)}
              className="p-0.5 text-gray-500 hover:text-white shrink-0"
            >
              {isExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
            </button>
          ) : (
            <span className="w-4 shrink-0" />
          )}

          {getNodeIcon(item.label, isExpanded)}

          <span className="truncate flex-1" title={item.name}>
            {item.name}
          </span>

          <span
            className="text-[9px] px-1.5 py-0.2 rounded-full font-sans uppercase font-bold shrink-0 opacity-80"
            style={{ backgroundColor: `${color}20`, color }}
          >
            {item.label}
          </span>
        </div>

        {hasChildren && isExpanded && (
          <div className="flex flex-col">
            {item.children.map((child) => renderItem(child, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="flex flex-col h-full overflow-hidden text-xs">
      {/* Tree Search */}
      <div className="p-3 border-b border-white/10 shrink-0">
        <div className="relative">
          <input
            type="text"
            value={filterText}
            onChange={(e) => setFilterText(e.target.value)}
            placeholder="Search files & symbols..."
            className="w-full pl-8 pr-7 py-1.5 bg-black/50 border border-white/10 rounded-xl text-xs text-gray-200 placeholder:text-gray-500 focus:outline-none focus:border-blue-500"
          />
          <Search className="w-3.5 h-3.5 text-gray-500 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          {filterText && (
            <button
              onClick={() => setFilterText('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-white"
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>

      {/* Tree Items List */}
      <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
        {rootTree.children.length === 0 ? (
          <div className="py-8 text-center text-gray-500 text-xs">No project entities indexed</div>
        ) : (
          rootTree.children.map((child) => renderItem(child, 0))
        )}
      </div>
    </div>
  );
}
