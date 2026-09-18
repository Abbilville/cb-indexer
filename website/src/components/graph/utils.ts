import { GraphNode, GraphEdge, GraphPayload } from '../../types/graph';

export const LABEL_COLORS: Record<string, string> = {
  project: '#3b82f6',     // Blue
  gateway: '#3b82f6',     // Blue
  service: '#3b82f6',     // Blue
  module: '#6366f1',      // Indigo
  branch: '#6366f1',      // Indigo
  folder: '#4f46e5',      // Indigo
  class: '#a855f7',       // Purple
  interface: '#9333ea',   // Purple
  enum: '#c084fc',        // Purple
  function: '#06b6d4',    // Cyan
  method: '#0891b2',      // Cyan
  route: '#10b981',       // Emerald
  file: '#f59e0b',        // Amber
  variable: '#ec4899',    // Pink
  field: '#f43f5e',       // Rose
  decorator: '#8b5cf6',   // Violet
  default: '#94a3b8',     // Slate
};

export const EDGE_COLORS: Record<string, string> = {
  calls: '#06b6d4',
  call_reference: '#0891b2',
  api_call: '#06b6d4',
  imports: '#a855f7',
  defines: '#60a5fa',
  defines_method: '#38bdf8',
  gateway_route: '#60a5fa',
  service_registry: '#a855f7',
  http_calls: '#10b981',
  inherits: '#f59e0b',
  implements: '#f59e0b',
  contains_file: '#64748b',
  contains_folder: '#475569',
  has_branch: '#334155',
  default: 'rgba(255, 255, 255, 0.25)',
};

export function getNodeColor(label: string): string {
  const key = label.toLowerCase();
  return LABEL_COLORS[key] || LABEL_COLORS.default;
}

export function getEdgeColor(type: string): string {
  const key = type.toLowerCase();
  return EDGE_COLORS[key] || EDGE_COLORS.default;
}

export function hexToRgba(hexOrRgba: string, opacity: number): string {
  if (hexOrRgba.startsWith('rgba')) {
    return hexOrRgba.replace(/[\d.]+\)$/, `${opacity})`);
  }
  if (hexOrRgba.startsWith('#')) {
    const hex = hexOrRgba.replace('#', '');
    let r = 0, g = 0, b = 0;
    if (hex.length === 3) {
      r = parseInt(hex[0] + hex[0], 16);
      g = parseInt(hex[1] + hex[1], 16);
      b = parseInt(hex[2] + hex[2], 16);
    } else if (hex.length >= 6) {
      r = parseInt(hex.substring(0, 2), 16);
      g = parseInt(hex.substring(2, 4), 16);
      b = parseInt(hex.substring(4, 6), 16);
    }
    return `rgba(${r}, ${g}, ${b}, ${opacity})`;
  }
  return hexOrRgba;
}

export function filterGraphData(
  data: GraphPayload,
  filterLabels: string[],
  filterEdgeTypes: string[]
): { nodes: GraphNode[]; links: GraphEdge[] } {
  // 1. Filter nodes
  const nodes = data.nodes.filter((node) => {
    if (filterLabels.length > 0 && !filterLabels.includes(node.label)) {
      return false;
    }
    return true;
  });

  const nodeSet = new Set<string | number>(nodes.map((n) => n.id));

  // 2. Filter links (both source and target must be in the filtered nodeSet)
  const links = data.links.filter((link) => {
    const srcId = typeof link.source === 'object' && link.source !== null ? link.source.id : link.source;
    const dstId = typeof link.target === 'object' && link.target !== null ? link.target.id : link.target;

    if (!nodeSet.has(srcId) || !nodeSet.has(dstId)) {
      return false;
    }

    if (filterEdgeTypes.length > 0 && !filterEdgeTypes.includes(link.type)) {
      return false;
    }

    return true;
  });

  return { nodes, links };
}
