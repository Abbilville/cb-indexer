'use client';

import React from 'react';
import Link from 'next/link';
import { Layers, RefreshCw, KeyRound, ExternalLink, Code2 } from 'lucide-react';
import { ApiService } from '../../services/api';

interface NavbarProps {
  currentProject: string;
  gitUrl?: string;
  daemonActive: boolean;
  isRefreshing: boolean;
  onRefresh: () => void;
  onOpenAuth: () => void;
}

export function Navbar({
  currentProject,
  gitUrl,
  daemonActive,
  isRefreshing,
  onRefresh,
  onOpenAuth,
}: NavbarProps) {
  const hasAuth = ApiService.hasAuthToken();

  return (
    <header className="sticky top-0 z-40 flex items-center justify-between px-4 sm:px-6 py-3 bg-gray-950/80 backdrop-blur-xl border-b border-white/10">
      {/* Brand & Project Info */}
      <div className="flex items-center gap-3.5">
        <div className="flex items-center justify-center w-9 h-9 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 shadow-lg shadow-blue-500/25 text-white">
          <Layers className="w-5 h-5" />
        </div>

        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-base sm:text-lg font-bold tracking-tight text-white font-sans">
              cb-indexer
            </h1>
            <span className="text-[10px] uppercase font-mono tracking-wider px-1.5 py-0.5 rounded bg-white/10 text-gray-300">
              v0.1.0
            </span>
          </div>

          <div className="flex items-center gap-2 mt-0.5">
            <div className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-blue-500/10 border border-blue-500/20 text-blue-300 text-[11px] font-medium">
              <span className="w-1.5 h-1.5 rounded-full bg-blue-400" />
              <span>{currentProject || 'No Project Selected'}</span>
            </div>

            <Link
              href="/graph/"
              className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-purple-500/15 border border-purple-500/25 text-purple-300 hover:text-white hover:bg-purple-500/30 text-[11px] font-medium transition-all"
              title="Open Dedicated AST Knowledge Graph"
            >
              <Code2 className="w-3 h-3 text-purple-400" />
              <span>AST Explorer</span>
            </Link>
            {gitUrl && (
              <a
                href={gitUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-[11px] text-gray-400 hover:text-white transition-colors"
                title="Open GitHub Repository"
              >
                <svg className="w-3 h-3" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
                </svg>
                <span>GitHub</span>
                <ExternalLink className="w-2.5 h-2.5 opacity-60" />
              </a>
            )}
          </div>
        </div>
      </div>

      {/* Header Controls */}
      <div className="flex items-center gap-2 sm:gap-3">
        {/* Daemon Status Pill */}
        <div className="hidden sm:inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-black/40 border border-white/10 text-xs text-gray-300">
          <span
            className={`w-2 h-2 rounded-full ${
              daemonActive ? 'bg-emerald-400 pulse-green shadow-emerald-400/50' : 'bg-gray-500'
            }`}
          />
          <span className="font-medium">{daemonActive ? 'Daemon Active' : 'Daemon Idle'}</span>
        </div>

        {/* Auth Modal Trigger */}
        <button
          onClick={onOpenAuth}
          className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-medium transition-all ${
            hasAuth
              ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/20'
              : 'bg-white/5 border-white/10 text-gray-300 hover:bg-white/10'
          }`}
          title="Configure API Auth Token"
        >
          <KeyRound className="w-3.5 h-3.5 text-blue-400" />
          <span>{hasAuth ? 'Auth Active' : 'Auth'}</span>
        </button>

        {/* Refresh Button */}
        <button
          onClick={onRefresh}
          disabled={isRefreshing}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-xs font-medium text-gray-200 transition-all active:scale-95 disabled:opacity-50"
          title="Refresh Dashboard Data"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin text-blue-400' : ''}`} />
          <span className="hidden sm:inline">Refresh</span>
        </button>
      </div>
    </header>
  );
}
