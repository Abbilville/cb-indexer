'use client';

import React from 'react';
import { getNodeColor, getEdgeColor } from '../graph/utils';
import { X } from 'lucide-react';

interface FloatingLegendProps {
  availableLabels: string[];
  availableTypes: string[];
  onClose: () => void;
}

export function FloatingLegend({ availableLabels, availableTypes, onClose }: FloatingLegendProps) {
  return (
    <div className="absolute top-16 right-4 z-20 w-64 max-h-[70vh] flex flex-col p-3.5 rounded-2xl bg-gray-950/90 border border-white/15 shadow-2xl backdrop-blur-xl animate-in fade-in slide-in-from-top-2 text-xs overflow-hidden">
      <div className="flex items-center justify-between pb-2 mb-2.5 border-b border-white/10 shrink-0">
        <span className="text-[11px] font-bold text-white uppercase tracking-wider">Graph Legend</span>
        <button onClick={onClose} className="text-gray-400 hover:text-white p-0.5 rounded">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto space-y-3 pr-1">
        {/* Node Labels */}
        <div>
          <span className="text-[10px] text-gray-400 uppercase font-semibold block mb-1.5">
            Node Entity Types
          </span>
          <div className="grid grid-cols-2 gap-1.5">
            {availableLabels.map((l) => (
              <div key={l} className="flex items-center gap-1.5 text-[11px] text-gray-300">
                <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: getNodeColor(l) }} />
                <span className="truncate">{l}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Edge Types */}
        {availableTypes.length > 0 && (
          <div className="pt-2 border-t border-white/5">
            <span className="text-[10px] text-gray-400 uppercase font-semibold block mb-1.5">
              Relationship Types
            </span>
            <div className="flex flex-col gap-1">
              {availableTypes.map((t) => (
                <div key={t} className="flex items-center gap-1.5 text-[11px] text-gray-300 font-mono">
                  <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: getEdgeColor(t) }} />
                  <span className="truncate">{t}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
