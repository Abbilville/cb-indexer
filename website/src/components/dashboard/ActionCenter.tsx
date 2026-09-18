'use client';

import React, { useState } from 'react';
import { ApiService } from '../../services/api';
import { useToast } from '../ui/Toast';
import { Zap, GitPullRequest, Trash2, Loader2 } from 'lucide-react';

interface ActionCenterProps {
  currentProject: string;
  onRefresh: () => void;
  onOpenDelete: () => void;
}

export function ActionCenter({ currentProject, onRefresh, onOpenDelete }: ActionCenterProps) {
  const { showToast } = useToast();
  const [isReindexing, setIsReindexing] = useState(false);
  const [isPulling, setIsPulling] = useState(false);

  const handleReindexAll = async () => {
    try {
      setIsReindexing(true);
      await ApiService.triggerReindex({
        project: currentProject,
      });
      showToast('Global re-indexing triggered', 'success');
      onRefresh();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to trigger re-index';
      showToast(msg, 'error');
    } finally {
      setIsReindexing(false);
    }
  };

  const handlePullAndSync = async () => {
    try {
      setIsPulling(true);
      await ApiService.triggerReindex({
        project: currentProject,
        pull: true,
      });
      showToast('Git pull & sync triggered across repositories', 'success');
      onRefresh();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Git pull & sync failed';
      showToast(msg, 'error');
    } finally {
      setIsPulling(false);
    }
  };

  return (
    <section className="p-5 bg-gray-900/60 border border-white/10 rounded-2xl shadow-lg backdrop-blur-md">
      <div className="flex items-center gap-2 pb-3 mb-3 border-b border-white/10 text-white font-bold text-xs uppercase tracking-wider">
        <Zap className="w-4 h-4 text-amber-400" />
        <span>Action Center</span>
      </div>

      <div className="flex flex-col gap-2.5">
        <button
          onClick={handleReindexAll}
          disabled={isReindexing}
          className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold rounded-xl shadow-lg shadow-blue-600/20 transition-all active:scale-98 disabled:opacity-50"
        >
          {isReindexing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
          <span>Re-index Projects</span>
        </button>

        <button
          onClick={handlePullAndSync}
          disabled={isPulling}
          className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-white/5 hover:bg-white/10 border border-white/10 text-gray-200 hover:text-white text-xs font-medium rounded-xl transition-all active:scale-98 disabled:opacity-50"
        >
          {isPulling ? (
            <Loader2 className="w-4 h-4 animate-spin text-blue-400" />
          ) : (
            <GitPullRequest className="w-4 h-4 text-blue-400" />
          )}
          <span>Git Pull & Sync All</span>
        </button>

        {currentProject && (
          <button
            onClick={onOpenDelete}
            className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/20 text-rose-300 text-xs font-medium rounded-xl transition-all active:scale-98"
          >
            <Trash2 className="w-4 h-4 text-rose-400" />
            <span>Delete Project</span>
          </button>
        )}
      </div>
    </section>
  );
}
