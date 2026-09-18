'use client';

import React from 'react';
import { GraphEdge } from '../../types/graph';
import { getEdgeColor } from './utils';
import { X, ArrowRight, Link2 } from 'lucide-react';

interface EdgeInspectorProps {
  edge: GraphEdge | null;
  onClose: () => void;
}

export function EdgeInspector({ edge, onClose }: EdgeInspectorProps) {
  if (!edge) return null;

  const color = getEdgeColor(edge.type);

  const srcName =
    typeof edge.source === 'object' && edge.source !== null
      ? edge.source.name || edge.source.qualified_name || String(edge.source.id)
      : String(edge.source);

  const dstName =
    typeof edge.target === 'object' && edge.target !== null
      ? edge.target.name || edge.target.qualified_name || String(edge.target.id)
      : String(edge.target);

  return (
    <div className="absolute top-4 right-4 z-30 w-72 sm:w-80 p-4 rounded-2xl bg-gray-950/90 border border-white/15 shadow-2xl backdrop-blur-xl animate-in slide-in-from-right-4">
      <div className="flex items-center justify-between pb-2.5 mb-3 border-b border-white/10">
        <div className="flex items-center gap-2">
          <Link2 className="w-4 h-4 text-blue-400" />
          <span className="text-xs font-bold text-white uppercase tracking-wider">Edge Relation</span>
        </div>
        <button
          onClick={onClose}
          className="text-gray-400 hover:text-white p-1 rounded-lg hover:bg-white/10 transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="space-y-3 text-xs">
        {/* Type Badge */}
        <div>
          <span
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-mono font-semibold"
            style={{ backgroundColor: `${color}20`, color, borderColor: `${color}40`, borderWidth: 1 }}
          >
            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: color }} />
            <span>{edge.type}</span>
          </span>
        </div>

        {/* Source -> Target */}
        <div className="p-2.5 rounded-xl bg-black/40 border border-white/5 space-y-2">
          <div>
            <span className="text-[10px] text-gray-500 uppercase tracking-wider block">Source</span>
            <span className="font-mono text-gray-200 text-[11px] font-semibold truncate block">
              {srcName}
            </span>
          </div>

          <div className="flex items-center justify-center text-gray-500">
            <ArrowRight className="w-4 h-4" />
          </div>

          <div>
            <span className="text-[10px] text-gray-500 uppercase tracking-wider block">Target</span>
            <span className="font-mono text-gray-200 text-[11px] font-semibold truncate block">
              {dstName}
            </span>
          </div>
        </div>

        {/* Properties */}
        {edge.properties && Object.keys(edge.properties).length > 0 && (
          <div>
            <span className="text-[10px] text-gray-500 font-semibold uppercase tracking-wider block mb-1">
              Properties
            </span>
            <div className="p-2 rounded-xl bg-black/40 border border-white/5 font-mono text-[10px] text-gray-400 max-h-32 overflow-y-auto space-y-1">
              {Object.entries(edge.properties).map(([k, v]) => (
                <div key={k} className="flex justify-between gap-2">
                  <span className="text-gray-500">{k}:</span>
                  <span className="text-gray-300 truncate max-w-[150px]">{String(v)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
