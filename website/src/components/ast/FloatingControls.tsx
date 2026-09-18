'use client';

import React, { useState, useEffect } from 'react';
import { Box, CircleDot, GitFork, Maximize2, Minimize2, Info } from 'lucide-react';

export type AstViewMode = '3d' | '2d' | 'tree';

interface FloatingControlsProps {
  viewMode: AstViewMode;
  onChangeViewMode: (mode: AstViewMode) => void;
  showLegend: boolean;
  onToggleLegend: () => void;
}

export function FloatingControls({
  viewMode,
  onChangeViewMode,
  showLegend,
  onToggleLegend,
}: FloatingControlsProps) {
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    const handleFsChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', handleFsChange);
    return () => document.removeEventListener('fullscreenchange', handleFsChange);
  }, []);

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  };

  return (
    <div className="absolute top-4 right-4 z-20 flex items-center gap-2">
      {/* View Mode Switcher */}
      <div className="flex items-center p-1 rounded-xl bg-gray-950/85 border border-white/15 shadow-xl backdrop-blur-md">
        <button
          onClick={() => onChangeViewMode('3d')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
            viewMode === '3d'
              ? 'bg-blue-600 text-white shadow-md shadow-blue-600/30'
              : 'text-gray-400 hover:text-white hover:bg-white/5'
          }`}
          title="3D WebGL Galaxy View"
        >
          <Box className="w-3.5 h-3.5 text-cyan-300" />
          <span>3D Galaxy</span>
        </button>

        <button
          onClick={() => onChangeViewMode('2d')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
            viewMode === '2d'
              ? 'bg-blue-600 text-white shadow-md shadow-blue-600/30'
              : 'text-gray-400 hover:text-white hover:bg-white/5'
          }`}
          title="2D Canvas Physics View"
        >
          <CircleDot className="w-3.5 h-3.5 text-blue-400" />
          <span>2D Network</span>
        </button>

        <button
          onClick={() => onChangeViewMode('tree')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
            viewMode === 'tree'
              ? 'bg-blue-600 text-white shadow-md shadow-blue-600/30'
              : 'text-gray-400 hover:text-white hover:bg-white/5'
          }`}
          title="Collapsible Tree Flowchart View"
        >
          <GitFork className="w-3.5 h-3.5 text-purple-400" />
          <span>Tree Flowchart</span>
        </button>
      </div>

      {/* Legend Toggle Button */}
      <button
        onClick={onToggleLegend}
        className={`p-2 rounded-xl border shadow-xl backdrop-blur-md transition-all ${
          showLegend
            ? 'bg-white/15 border-white/30 text-white'
            : 'bg-gray-950/85 border-white/15 text-gray-400 hover:text-white'
        }`}
        title="Toggle Legend"
      >
        <Info className="w-4 h-4 text-blue-400" />
      </button>

      {/* Fullscreen Toggle Button */}
      <button
        onClick={toggleFullscreen}
        className="p-2 rounded-xl bg-gray-950/85 border border-white/15 text-gray-400 hover:text-white shadow-xl backdrop-blur-md transition-all"
        title={isFullscreen ? 'Exit Fullscreen' : 'Enter Fullscreen'}
      >
        {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4 text-emerald-400" />}
      </button>
    </div>
  );
}
