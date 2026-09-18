import { GraphPayload, GraphNode, GraphEdge } from '../../types/graph';

export interface GraphRendererProps {
  data: GraphPayload;
  selectedNode: GraphNode | null;
  selectedEdge: GraphEdge | null;
  onSelectNode: (node: GraphNode | null) => void;
  onSelectEdge: (edge: GraphEdge | null) => void;
  filterLabels: string[];
  filterEdgeTypes: string[];
  searchFocusId?: string | number;
  edgeThickness?: number;
  edgeOpacity?: number;
  nodeSize?: number;
  nodeOpacity?: number;
}
