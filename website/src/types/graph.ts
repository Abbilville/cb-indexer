export type GraphScope = 'topology' | 'ast' | 'cpg';
export type ViewMode = '2d' | '3d' | 'whiteboard';

export interface GraphNode {
  id: number | string;
  project: string;
  label: string;
  name: string;
  qualified_name: string;
  file_path?: string;
  start_line?: number;
  end_line?: number;
  properties?: Record<string, unknown>;
  val?: number;
  color?: string;
  x?: number;
  y?: number;
  z?: number;
  vx?: number;
  vy?: number;
  vz?: number;
  fx?: number;
  fy?: number;
  fz?: number;
}

export interface GraphEdge {
  id: number | string;
  project: string;
  source: number | string | GraphNode;
  target: number | string | GraphNode;
  type: string;
  properties?: Record<string, unknown>;
  color?: string;
}

export interface GraphPayload {
  project: string;
  scope: GraphScope;
  total_nodes: number;
  total_edges: number;
  returned_nodes: number;
  returned_edges: number;
  available_labels: string[];
  available_types: string[];
  nodes: GraphNode[];
  links: GraphEdge[];
}

export interface GraphFilterState {
  selectedLabels: string[];
  selectedEdgeTypes: string[];
  searchQuery: string;
  selectedNode: GraphNode | null;
  selectedEdge: GraphEdge | null;
}
