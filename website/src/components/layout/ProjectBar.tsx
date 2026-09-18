'use client';

import React from 'react';
import { ProjectCatalogItem } from '../../types/project';
import { FolderGit2, Plus, Trash2, ExternalLink } from 'lucide-react';

interface ProjectBarProps {
  projects: ProjectCatalogItem[];
  currentProjectId: string;
  gitUrl?: string;
  onSelectProject: (projectId: string) => void;
  onOpenScan: () => void;
  onOpenDelete: () => void;
}

export function ProjectBar({
  projects,
  currentProjectId,
  gitUrl,
  onSelectProject,
  onOpenScan,
  onOpenDelete,
}: ProjectBarProps) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-4 sm:px-6 py-3 bg-gray-900/40 border-b border-white/5">
      {/* Project Selector */}
      <div className="flex items-center gap-3 flex-wrap">
        <label htmlFor="project-picker" className="text-xs font-semibold uppercase tracking-wider text-gray-400">
          Project:
        </label>
        <div className="relative min-w-[220px]">
          <select
            id="project-picker"
            value={currentProjectId}
            onChange={(e) => onSelectProject(e.target.value)}
            className="w-full appearance-none pl-9 pr-8 py-2 bg-black/50 hover:bg-black/70 border border-white/10 rounded-xl text-xs font-medium text-gray-200 focus:outline-none focus:border-blue-500 transition-colors cursor-pointer"
          >
            {projects.length === 0 ? (
              <option value="">(No Registered Projects)</option>
            ) : (
              projects.map((p) => {
                const id = p.project_id || p.registry_path || '';
                return (
                  <option key={id} value={id}>
                    {p.name || p.project_id} ({p.total_repos ?? 0} repos)
                  </option>
                );
              })
            )}
          </select>
          <FolderGit2 className="w-4 h-4 text-blue-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 text-[10px] pointer-events-none">
            ▼
          </span>
        </div>

        {gitUrl && (
          <a
            href={gitUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="hidden md:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-xs text-gray-300 hover:text-white transition-all"
            title="Open Repository on GitHub"
          >
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
            </svg>
            <span>GitHub</span>
            <ExternalLink className="w-3 h-3 opacity-60" />
          </a>
        )}
      </div>

      {/* Action Buttons */}
      <div className="flex items-center gap-2">
        {currentProjectId && (
          <button
            onClick={onOpenDelete}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/20 text-rose-300 text-xs font-medium transition-all active:scale-95"
            title="Delete active project"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Delete Project</span>
          </button>
        )}

        <button
          onClick={onOpenScan}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold shadow-lg shadow-blue-600/20 transition-all active:scale-95 whitespace-nowrap"
          title="Scan and register new workspace"
        >
          <Plus className="w-3.5 h-3.5 stroke-[2.5]" />
          <span>Scan New Project</span>
        </button>
      </div>
    </div>
  );
}
