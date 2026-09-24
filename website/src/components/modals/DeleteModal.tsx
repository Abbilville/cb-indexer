'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { AlertTriangle, Trash2, X, Loader2 } from 'lucide-react';
import { ApiService } from '../../services/api';
import { useToast } from '../ui/Toast';

interface DeleteModalProps {
  isOpen: boolean;
  projectId: string;
  projectName?: string;
  onClose: () => void;
  onDeleted: () => void;
}

export function DeleteModal({ isOpen, projectId, projectName, onClose, onDeleted }: DeleteModalProps) {
  const { showToast } = useToast();
  const [confirmInput, setConfirmInput] = useState('');
  const [purgeGraphs, setPurgeGraphs] = useState(true);
  const [purgeCpg, setPurgeCpg] = useState(true);
  const [isDeleting, setIsDeleting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const resetState = useCallback(() => {
    setConfirmInput('');
    setPurgeGraphs(true);
    setIsDeleting(false);
  }, []);

  const handleClose = useCallback(() => {
    resetState();
    onClose();
  }, [resetState, onClose]);

  // Always reset state whenever modal opens or closes or active project changes
  useEffect(() => {
    resetState();
    if (isOpen) {
      const timer = setTimeout(() => {
        inputRef.current?.focus();
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [isOpen, projectId, resetState]);

  // Escape key handler
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isDeleting) {
        handleClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, isDeleting, handleClose]);

  if (!isOpen) return null;

  const targetId = (projectId || '').trim();
  const trimmedInput = confirmInput.trim().toLowerCase();
  const isMatch =
    targetId.length > 0 &&
    (trimmedInput === targetId.toLowerCase() ||
      (projectName && trimmedInput === projectName.trim().toLowerCase()));

  const handleDelete = async () => {
    if (!isMatch || isDeleting) return;

    try {
      setIsDeleting(true);
      await ApiService.deleteProject({
        projectId: targetId,
        purgeGraphs,
        purgeCpg,
      });
      showToast(`Project '${projectName || targetId}' deleted successfully`, 'success');
      resetState();
      onDeleted();
      onClose();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Deletion failed';
      showToast(msg, 'error');
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-in fade-in duration-200"
      onClick={(e) => {
        if (e.target === e.currentTarget && !isDeleting) {
          handleClose();
        }
      }}
    >
      <div className="relative w-full max-w-md p-6 bg-gray-900/95 border border-rose-500/30 rounded-2xl shadow-2xl backdrop-blur-xl">
        <div className="flex items-center justify-between pb-4 mb-4 border-b border-rose-500/20">
          <div className="flex items-center gap-2 text-rose-400 font-semibold text-base">
            <AlertTriangle className="w-5 h-5 text-rose-400" />
            <span>Delete Project</span>
          </div>
          <button
            onClick={handleClose}
            disabled={isDeleting}
            className="text-gray-400 hover:text-white p-1 rounded-lg hover:bg-white/5 transition-colors disabled:opacity-50"
            title="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-3 mb-4 rounded-xl bg-rose-950/40 border border-rose-500/20 text-xs text-rose-200 leading-relaxed">
          <strong className="text-rose-100 font-semibold">Warning: This action cannot be undone.</strong>
          <br />
          This will unregister <code className="bg-black/50 text-white px-1.5 py-0.5 rounded font-mono">{projectName || targetId}</code> from the catalog and clear its saved layout.
        </div>

        <div className="mb-4 space-y-2">
          <label className="flex items-center gap-2.5 cursor-pointer text-xs text-gray-300 select-none">
            <input
              type="checkbox"
              checked={purgeGraphs}
              onChange={(e) => setPurgeGraphs(e.target.checked)}
              disabled={isDeleting}
              className="w-4 h-4 rounded accent-rose-500 border-white/20 bg-black/40"
            />
            <span>Purge Tree-sitter AST graph caches (<code className="font-mono text-gray-400">codebase-memory-mcp</code>)</span>
          </label>
          <label className="flex items-center gap-2.5 cursor-pointer text-xs text-gray-300 select-none">
            <input
              type="checkbox"
              checked={purgeCpg}
              onChange={(e) => setPurgeCpg(e.target.checked)}
              disabled={isDeleting}
              className="w-4 h-4 rounded accent-rose-500 border-white/20 bg-black/40"
            />
            <span>Purge Joern Code Property Graph databases (<code className="font-mono text-gray-400">cb-indexer/cpg</code>)</span>
          </label>
        </div>

        <div className="space-y-1.5 mb-6">
          <label className="text-xs text-gray-400 block">
            To confirm, type <strong className="text-rose-400 font-mono select-all bg-rose-950/60 px-1.5 py-0.5 rounded">{targetId}</strong> below:
          </label>
          <input
            ref={inputRef}
            type="text"
            value={confirmInput}
            onChange={(e) => setConfirmInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && isMatch && !isDeleting) {
                e.preventDefault();
                handleDelete();
              }
            }}
            disabled={isDeleting}
            placeholder="Type project ID to confirm"
            className="w-full px-3.5 py-2.5 bg-black/50 border border-rose-500/30 rounded-xl text-sm text-gray-100 placeholder:text-gray-600 focus:outline-none focus:border-rose-500 focus:ring-1 focus:ring-rose-500/50"
          />
        </div>

        <div className="flex items-center justify-end gap-2.5 pt-4 border-t border-white/10">
          <button
            onClick={handleClose}
            disabled={isDeleting}
            className="px-4 py-2 text-xs font-medium text-gray-300 hover:text-white bg-white/5 hover:bg-white/10 rounded-xl transition-all disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleDelete}
            disabled={!isMatch || isDeleting}
            className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-rose-600 hover:bg-rose-500 active:scale-95 rounded-xl shadow-lg shadow-rose-600/25 transition-all disabled:opacity-40 disabled:pointer-events-none"
          >
            {isDeleting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
            <span>Delete Project</span>
          </button>
        </div>
      </div>
    </div>
  );
}
