import type { GraphNode, GraphEdge, AnalysisMode } from './graph';

// Source location that both AST and CPG nodes can use
export interface SourceLocation {
  filePath: string;
  startLine: number;
  endLine: number;
  startColumn?: number;
  endColumn?: number;
  nodeId?: string | number;
  nodeLabel?: string;
  nodeName?: string;
}

// A single file tab
export interface FileTab {
  id: string; // unique key
  filePath: string;
  repoName: string;
  projectId: string;
  language: string;
  lastLine: number; // last scrolled-to line
  lastNodeId?: string | number;
}

// Navigation history entry
export interface NavHistoryEntry {
  sourceLocation: SourceLocation;
  fileTab: FileTab;
  timestamp: number;
}

// A node indicator on a code line - multiple nodes can be on same line
export interface LineNodeIndicator {
  nodeId: string | number;
  nodeLabel: string;
  nodeName: string;
  qualifiedName: string;
  startColumn?: number;
  endColumn?: number;
}

// Response from nodes-by-location API
export interface NodesByLocationResponse {
  file_path: string;
  line: number;
  nodes: Array<{
    id: string | number;
    label: string;
    name: string;
    qualified_name: string;
    start_line: number;
    end_line: number;
    start_column?: number;
    end_column?: number;
    properties?: Record<string, unknown>;
  }>;
}

// File source response
export interface FileSourceResponse {
  file_path: string;
  repo: string;
  project: string;
  language: string;
  total_lines: number;
  start_line: number;
  end_line: number;
  content: string;
  lines: string[];
}

// Props for the CodeViewer component
export interface CodeViewerProps {
  isOpen: boolean;
  onToggle: () => void;
  selectedNode: GraphNode | null;
  hoveredNodeId: string | number | null;
  graphNodes: GraphNode[];
  graphEdges: GraphEdge[];
  projectId: string;
  selectedRepo: string;
  graphScope: 'ast' | 'cpg';
  analysisMode: AnalysisMode;
  highlightedNodeIds: Set<string | number>;
  onSelectNode: (node: GraphNode) => void;
  onHoverNode: (nodeId: string | number | null) => void;
}

export function inferLanguage(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase() || '';
  const map: Record<string, string> = {
    ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript',
    py: 'python', go: 'go', rs: 'rust', java: 'java', kt: 'kotlin',
    c: 'c', cpp: 'cpp', h: 'c', hpp: 'cpp', cs: 'csharp',
    rb: 'ruby', php: 'php', swift: 'swift', scala: 'scala',
    sql: 'sql', sh: 'bash', bash: 'bash', zsh: 'bash',
    yaml: 'yaml', yml: 'yaml', json: 'json', xml: 'xml', html: 'html', css: 'css',
    md: 'markdown', toml: 'toml', dockerfile: 'docker',
  };
  return map[ext] || 'plaintext';
}
