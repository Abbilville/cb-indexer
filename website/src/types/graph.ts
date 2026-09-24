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

export type AnalysisMode =
  | 'explore'
  | 'call_flow'
  | 'data_flow'
  | 'taint_flow'
  | 'control_flow'
  | 'impact'
  | 'find_path';

export interface NeighborhoodConfig {
  depth: number;
  inbound: boolean;
  outbound: boolean;
}

export interface CallFlowResult {
  direction: 'callers' | 'callees' | 'both';
  depth: number;
  root_node: GraphNode;
  nodes: GraphNode[];
  edges: GraphEdge[];
  paths?: number[][];
}

export interface ImpactResult {
  target_node: GraphNode;
  direct_callers: GraphNode[];
  indirect_callers: GraphNode[];
  affected_files: string[];
  direct_count: number;
  indirect_count: number;
  affected_file_count: number;
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface PathResult {
  found: boolean;
  from_node: GraphNode;
  to_node: GraphNode;
  relationship?: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface FlowStep {
  step_index: number;
  node: GraphNode;
  edge_type: string;
}

export interface FlowResult {
  flow_type: string;
  source: GraphNode;
  sink: GraphNode;
  steps: FlowStep[];
}
