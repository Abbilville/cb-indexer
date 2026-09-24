'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Folder,
  FolderUp,
  FolderOpen,
  Search,
  X,
  Loader2,
  HardDrive,
  RefreshCw,
  Check,
  ExternalLink,
  ChevronRight,
} from 'lucide-react';
import { ApiService } from '../../services/api';
import { useToast } from '../ui/Toast';

interface FolderExplorerModalProps {
  isOpen: boolean;
  initialPath?: string;
  onClose: () => void;
  onSelect: (selectedPath: string) => void;
}

export function FolderExplorerModal({
  isOpen,
  initialPath,
  onClose,
  onSelect,
}: FolderExplorerModalProps) {
  const { showToast } = useToast();

  const [currentPath, setCurrentPath] = useState('');
  const [parentPath, setParentPath] = useState('');
  const [dirs, setDirs] = useState<string[]>([]);
  const [drives, setDrives] = useState<string[]>([]);
  const [filterText, setFilterText] = useState('');
  const [showHidden, setShowHidden] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isNativeBrowsing, setIsNativeBrowsing] = useState(false);
  const [selectedDirName, setSelectedDirName] = useState<string | null>(null);

  const fetchDirs = useCallback(
    async (path?: string) => {
      try {
        setIsLoading(true);
        setSelectedDirName(null);
        setFilterText('');
        const res = await ApiService.browseDirs(path, showHidden);
        setCurrentPath(res.current);
        setParentPath(res.parent);
        setDirs(res.dirs || []);
        if (res.drives && res.drives.length > 0) {
          setDrives(res.drives);
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Failed to load directory';
        showToast(msg, 'error');
      } finally {
        setIsLoading(false);
      }
    },
    [showHidden, showToast]
  );

  // Load initial directory whenever modal opens
  useEffect(() => {
    if (isOpen) {
      const starting = (initialPath && initialPath.trim() !== '.') ? initialPath.trim() : '.';
      fetchDirs(starting);
    }
  }, [isOpen, initialPath, fetchDirs]);

  const handleNavigate = (subDirName: string) => {
    // Navigate into subDirName
    const separator = currentPath.includes('\\') ? '\\' : '/';
    const next = currentPath.endsWith(separator)
      ? `${currentPath}${subDirName}`
      : `${currentPath}${separator}${subDirName}`;
    fetchDirs(next);
  };

  const handleGoUp = () => {
    if (parentPath && parentPath !== currentPath) {
      fetchDirs(parentPath);
    }
  };

  const handleNativeExplorer = async () => {
    try {
      setIsNativeBrowsing(true);
      const res = await ApiService.browseFolder(currentPath);
      if (res.path) {
        onSelect(res.path);
        onClose();
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Native picker failed';
      showToast(msg, 'error');
    } finally {
      setIsNativeBrowsing(false);
    }
  };

  const handleConfirmSelect = () => {
    if (selectedDirName) {
      const separator = currentPath.includes('\\') ? '\\' : '/';
      const target = currentPath.endsWith(separator)
        ? `${currentPath}${selectedDirName}`
        : `${currentPath}${separator}${selectedDirName}`;
      onSelect(target);
    } else {
      onSelect(currentPath);
    }
    onClose();
  };

  const filteredDirs = useMemo(() => {
    if (!filterText.trim()) return dirs;
    const q = filterText.toLowerCase();
    return dirs.filter((d) => d.toLowerCase().includes(q));
  }, [dirs, filterText]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-200">
      <div className="relative w-full max-w-2xl max-h-[85vh] flex flex-col bg-gray-900/95 border border-white/10 rounded-2xl shadow-2xl backdrop-blur-xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 shrink-0">
          <div className="flex items-center gap-2.5 text-blue-400 font-semibold text-sm">
            <FolderOpen className="w-5 h-5" />
            <span>Select Workspace Folder (IDE Explorer)</span>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white p-1 rounded-lg hover:bg-white/5 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Current Path Bar & Quick Navigation */}
        <div className="px-5 pt-3.5 pb-2.5 border-b border-white/5 bg-black/30 flex flex-col gap-2 shrink-0">
          <div className="flex items-center gap-2">
            <button
              onClick={handleGoUp}
              disabled={!parentPath || parentPath === currentPath || isLoading}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-white/5 hover:bg-white/10 disabled:opacity-30 border border-white/10 rounded-lg text-xs text-gray-200 transition-all shrink-0"
              title="Go up to parent directory"
            >
              <FolderUp className="w-3.5 h-3.5 text-blue-400" />
              <span>Up</span>
            </button>

            {/* Drive selector if available (Windows) */}
            {drives.length > 0 && (
              <select
                value={drives.find((d) => currentPath.toUpperCase().startsWith(d.toUpperCase())) || ''}
                onChange={(e) => {
                  if (e.target.value) fetchDirs(e.target.value);
                }}
                className="px-2 py-1.5 bg-black/60 border border-white/10 rounded-lg text-xs text-gray-200 focus:outline-none focus:border-blue-500 shrink-0"
              >
                {drives.map((drv) => (
                  <option key={drv} value={drv}>
                    {drv}
                  </option>
                ))}
              </select>
            )}

            {/* Path Breadcrumb / Input */}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                fetchDirs(currentPath);
              }}
              className="flex-1 flex items-center"
            >
              <input
                type="text"
                value={currentPath}
                onChange={(e) => setCurrentPath(e.target.value)}
                placeholder="Folder path..."
                className="w-full px-3 py-1.5 bg-black/50 border border-white/10 rounded-lg text-xs text-gray-200 font-mono focus:outline-none focus:border-blue-500"
              />
            </form>

            <button
              onClick={() => fetchDirs(currentPath)}
              disabled={isLoading}
              className="p-1.5 text-gray-400 hover:text-white bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg transition-colors shrink-0"
              title="Refresh directory"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin text-blue-400' : ''}`} />
            </button>
          </div>

          {/* Filter Bar & Options */}
          <div className="flex items-center justify-between gap-3">
            <div className="relative flex-1">
              <Search className="w-3.5 h-3.5 text-gray-500 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={filterText}
                onChange={(e) => setFilterText(e.target.value)}
                placeholder="Filter subfolders..."
                className="w-full pl-8 pr-7 py-1 bg-black/40 border border-white/10 rounded-lg text-xs text-gray-300 placeholder:text-gray-600 focus:outline-none focus:border-blue-500"
              />
              {filterText && (
                <button
                  onClick={() => setFilterText('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-white"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>

            <label className="flex items-center gap-1.5 text-[11px] text-gray-400 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={showHidden}
                onChange={(e) => setShowHidden(e.target.checked)}
                className="w-3.5 h-3.5 rounded accent-blue-500"
              />
              <span>Show hidden</span>
            </label>
          </div>
        </div>

        {/* Directory List View */}
        <div className="flex-1 overflow-y-auto p-3 space-y-1 min-h-[260px] max-h-[380px]">
          {isLoading ? (
            <div className="py-16 flex flex-col items-center justify-center gap-2 text-xs text-gray-500">
              <Loader2 className="w-6 h-6 animate-spin text-blue-400" />
              <span>Loading folders...</span>
            </div>
          ) : filteredDirs.length === 0 ? (
            <div className="py-16 text-center text-xs text-gray-500">
              {filterText ? 'No matching folders found.' : 'No subdirectories found in this location.'}
            </div>
          ) : (
            filteredDirs.map((dirName) => {
              const isSelected = selectedDirName === dirName;
              return (
                <div
                  key={dirName}
                  onClick={() => setSelectedDirName(isSelected ? null : dirName)}
                  onDoubleClick={() => handleNavigate(dirName)}
                  className={`group flex items-center justify-between px-3 py-2 rounded-xl text-xs cursor-pointer select-none transition-all ${
                    isSelected
                      ? 'bg-blue-600/20 border border-blue-500/40 text-blue-200'
                      : 'hover:bg-white/5 border border-transparent text-gray-300'
                  }`}
                >
                  <div className="flex items-center gap-2.5 truncate">
                    <Folder className={`w-4 h-4 shrink-0 ${isSelected ? 'text-blue-400' : 'text-blue-400/70 group-hover:text-blue-400'}`} />
                    <span className="font-medium truncate">{dirName}</span>
                  </div>

                  <div className="flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleNavigate(dirName);
                      }}
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-white/5 hover:bg-white/10 text-[10px] text-gray-400 hover:text-white transition-colors"
                      title="Open folder"
                    >
                      <span>Open</span>
                      <ChevronRight className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Footer Actions */}
        <div className="flex items-center justify-between px-5 py-3 border-t border-white/10 bg-black/40 shrink-0">
          <button
            type="button"
            onClick={handleNativeExplorer}
            disabled={isNativeBrowsing}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs text-gray-400 hover:text-gray-200 hover:bg-white/5 rounded-xl border border-white/10 transition-colors"
            title="Open system file explorer dialog as fallback"
          >
            {isNativeBrowsing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ExternalLink className="w-3.5 h-3.5 text-blue-400" />}
            <span>Native File Explorer...</span>
          </button>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-1.5 text-xs font-medium text-gray-300 hover:text-white bg-white/5 hover:bg-white/10 rounded-xl transition-all"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleConfirmSelect}
              className="inline-flex items-center gap-1.5 px-4 py-1.5 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-500 active:scale-95 rounded-xl shadow-lg shadow-blue-600/25 transition-all"
            >
              <Check className="w-3.5 h-3.5" />
              <span>Select {selectedDirName ? `"${selectedDirName}"` : 'Current Folder'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
