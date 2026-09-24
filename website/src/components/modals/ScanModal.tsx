'use client';

import React, { useState } from 'react';
import { Search, FolderOpen, X, Loader2 } from 'lucide-react';
import { ApiService } from '../../services/api';
import { useToast } from '../ui/Toast';
import { FolderExplorerModal } from './FolderExplorerModal';

interface ScanModalProps {
  isOpen: boolean;
  onClose: () => void;
  onScanComplete: (projectId: string) => void;
}

export function ScanModal({ isOpen, onClose, onScanComplete }: ScanModalProps) {
  const { showToast } = useToast();
  const [path, setPath] = useState('.');
  const [projectId, setProjectId] = useState('');
  const [indexEngine, setIndexEngine] = useState<'both' | 'ast' | 'cpg' | 'none'>('both');
  const [isScanning, setIsScanning] = useState(false);
  const [isExplorerOpen, setIsExplorerOpen] = useState(false);
  if (!isOpen) return null;

  const handleOpenExplorer = () => {
    setIsExplorerOpen(true);
  };

  const handleFolderSelected = (selectedPath: string) => {
    setPath(selectedPath);
    showToast(`Selected directory: ${selectedPath}`, 'info');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!path.trim()) {
      showToast('Please provide a directory path to scan', 'warn');
      return;
    }

    try {
      setIsScanning(true);
      const res = await ApiService.scanWorkspace({
        path: path.trim(),
        projectId: projectId.trim() || undefined,
      });

      const count = res.total_repos ?? res.repos_count ?? 0;
      showToast(res.message || `Scan complete: found ${count} repositories`, 'success');
      onScanComplete(res.project_id);

      // Auto-trigger indexing if requested
      if (indexEngine !== 'none' && res.project_id) {
        ApiService.triggerReindex({
          project: res.project_id,
          engine: indexEngine,
        }).catch(() => {});
        showToast(`Triggered ${indexEngine.toUpperCase()} indexing in background`, 'info');
      }
      onClose();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Scan failed';
      showToast(msg, 'error');
    } finally {
      setIsScanning(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="relative w-full max-w-lg p-6 bg-gray-900/95 border border-white/10 rounded-2xl shadow-2xl backdrop-blur-xl">
        <div className="flex items-center justify-between pb-4 mb-4 border-b border-white/10">
          <div className="flex items-center gap-2.5 text-blue-400 font-semibold text-base">
            <Search className="w-5 h-5" />
            <span>Scan & Register Project</span>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white p-1 rounded-lg hover:bg-white/5 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-gray-300">Project Directory Path (Local / Server)</label>
            <div className="flex gap-2">
              <input
                type="text"
                value={path}
                onChange={(e) => setPath(e.target.value)}
                placeholder="e.g. /path/to/microservices or ."
                className="flex-1 px-3.5 py-2.5 bg-black/50 border border-white/10 rounded-xl text-sm text-gray-100 placeholder:text-gray-600 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/50"
              />
              <button
                type="button"
                onClick={handleOpenExplorer}
                className="inline-flex items-center gap-1.5 px-3.5 py-2.5 text-xs font-medium text-gray-200 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl transition-all whitespace-nowrap active:scale-95"
                title="Browse folders via IDE Explorer"
              >
                <FolderOpen className="w-4 h-4 text-blue-400" />
                <span>Browse...</span>
              </button>
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-gray-300">Project ID (Optional)</label>
            <input
              type="text"
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
              placeholder="e.g. ecommerce-core"
              className="w-full px-3.5 py-2.5 bg-black/50 border border-white/10 rounded-xl text-sm text-gray-100 placeholder:text-gray-600 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/50"
            />
          </div>

          {/* Indexing Engine Option */}
          <div className="space-y-1.5 pt-2 border-t border-white/5">
            <label className="text-xs font-medium text-gray-300 block">
              Auto-Index Discovered Repositories
            </label>
            <div className="grid grid-cols-4 gap-1.5 p-1 bg-black/50 border border-white/10 rounded-xl text-xs font-mono">
              <button
                type="button"
                onClick={() => setIndexEngine('both')}
                className={`py-1.5 rounded-lg text-center transition-all ${
                  indexEngine === 'both'
                    ? 'bg-blue-600 text-white font-semibold shadow-sm'
                    : 'text-gray-400 hover:text-white'
                }`}
                title="Index Tree-sitter AST & Joern CPG"
              >
                Both
              </button>
              <button
                type="button"
                onClick={() => setIndexEngine('ast')}
                className={`py-1.5 rounded-lg text-center transition-all ${
                  indexEngine === 'ast'
                    ? 'bg-purple-600/30 text-purple-200 border border-purple-500/40 font-semibold'
                    : 'text-gray-400 hover:text-white'
                }`}
                title="Index Tree-sitter AST only"
              >
                AST
              </button>
              <button
                type="button"
                onClick={() => setIndexEngine('cpg')}
                className={`py-1.5 rounded-lg text-center transition-all ${
                  indexEngine === 'cpg'
                    ? 'bg-cyan-600/30 text-cyan-200 border border-cyan-500/40 font-semibold'
                    : 'text-gray-400 hover:text-white'
                }`}
                title="Index Joern CPG only"
              >
                CPG
              </button>
              <button
                type="button"
                onClick={() => setIndexEngine('none')}
                className={`py-1.5 rounded-lg text-center transition-all ${
                  indexEngine === 'none'
                    ? 'bg-white/20 text-white font-semibold'
                    : 'text-gray-500 hover:text-white'
                }`}
                title="Scan manifest only without indexing"
              >
                Skip
              </button>
            </div>
            <p className="text-[11px] text-gray-500">
              {indexEngine === 'both'
                ? 'Will generate Tree-sitter AST and Joern CPG with cross-graph correlation.'
                : indexEngine === 'ast'
                ? 'Will index Tree-sitter AST only (functions, classes, routes).'
                : indexEngine === 'cpg'
                ? 'Will index Joern CPG only (call graphs, CFG, data flow).'
                : 'Will register project without indexing immediately.'}
            </p>
          </div>

          <div className="flex items-center justify-end gap-2.5 pt-4 border-t border-white/10">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-medium text-gray-300 hover:text-white bg-white/5 hover:bg-white/10 rounded-xl transition-all"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isScanning}
              className="inline-flex items-center gap-2 px-5 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-500 active:scale-95 rounded-xl shadow-lg shadow-blue-600/25 transition-all disabled:opacity-50"
            >
              {isScanning && <Loader2 className="w-4 h-4 animate-spin" />}
              <span>{isScanning ? 'Scanning...' : 'Start Scan'}</span>
            </button>
          </div>
        </form>
      </div>

      <FolderExplorerModal
        isOpen={isExplorerOpen}
        initialPath={path}
        onClose={() => setIsExplorerOpen(false)}
        onSelect={handleFolderSelected}
      />
    </div>
  );
}
