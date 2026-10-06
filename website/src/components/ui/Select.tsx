'use client';

import React, { useState, useRef, useEffect, useMemo } from 'react';
import { ChevronDown, Check, Search, X } from 'lucide-react';

export interface SelectOption<T extends string = string> {
  value: T;
  label: string;
  badge?: string;
  description?: string;
  icon?: React.ReactNode;
}

export interface SelectGroup<T extends string = string> {
  name: string;
  options: SelectOption<T>[];
}

export interface SelectProps<T extends string = string> {
  value: T;
  onChange: (value: T) => void;
  options?: SelectOption<T>[];
  groups?: SelectGroup<T>[];
  placeholder?: string;
  className?: string;
  triggerClassName?: string;
  menuClassName?: string;
  size?: 'sm' | 'md' | 'lg';
  leftIcon?: React.ReactNode;
  searchable?: boolean;
  searchPlaceholder?: string;
  disabled?: boolean;
  align?: 'left' | 'right';
  title?: string;
}

export function Select<T extends string = string>({
  value,
  onChange,
  options,
  groups,
  placeholder = 'Select option...',
  className = '',
  triggerClassName = '',
  menuClassName = '',
  size = 'md',
  leftIcon,
  searchable,
  searchPlaceholder = 'Search...',
  disabled = false,
  align = 'left',
  title,
}: SelectProps<T>) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Flatten options for lookup
  const allOptions = useMemo<SelectOption<T>[]>(() => {
    if (options) return options;
    if (groups) return groups.flatMap((g) => g.options);
    return [];
  }, [options, groups]);

  const selectedOption = useMemo(
    () => allOptions.find((o) => o.value === value),
    [allOptions, value]
  );

  // Should we enable search? Explicitly set or automatic for lists > 6 items
  const isSearchActive = searchable !== undefined ? searchable : allOptions.length > 6;

  // Filter options if searching
  const filteredGroups = useMemo<SelectGroup<T>[]>(() => {
    const q = searchQuery.toLowerCase().trim();
    if (!q) {
      if (groups) return groups;
      if (options) return [{ name: '', options }];
      return [];
    }
    if (groups) {
      return groups
        .map((g) => ({
          name: g.name,
          options: g.options.filter(
            (o) =>
              o.label.toLowerCase().includes(q) ||
              o.value.toLowerCase().includes(q) ||
              (o.description && o.description.toLowerCase().includes(q))
          ),
        }))
        .filter((g) => g.options.length > 0);
    }
    if (options) {
      const filtered = options.filter(
        (o) =>
          o.label.toLowerCase().includes(q) ||
          o.value.toLowerCase().includes(q) ||
          (o.description && o.description.toLowerCase().includes(q))
      );
      return filtered.length > 0 ? [{ name: '', options: filtered }] : [];
    }
    return [];
  }, [groups, options, searchQuery]);

  // Click outside listener to dismiss
  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
        setSearchQuery('');
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsOpen(false);
        setSearchQuery('');
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  // Focus search input on open
  useEffect(() => {
    if (isOpen && isSearchActive) {
      setTimeout(() => searchInputRef.current?.focus(), 50);
    }
  }, [isOpen, isSearchActive]);

  const sizeClasses =
    size === 'sm'
      ? 'px-2.5 py-1 text-xs rounded-lg'
      : size === 'lg'
      ? 'px-3.5 py-2.5 text-sm rounded-xl'
      : 'px-3 py-1.5 text-xs rounded-xl';

  return (
    <div ref={containerRef} className={`relative inline-block ${className}`}>
      {/* Trigger Button */}
      <button
        type="button"
        disabled={disabled}
        onClick={() => {
          if (!disabled) {
            setIsOpen(!isOpen);
            if (isOpen) setSearchQuery('');
          }
        }}
        title={title}
        className={`w-full flex items-center justify-between gap-2 bg-black/60 hover:bg-black/80 border border-white/10 hover:border-blue-500/40 text-gray-200 transition-all font-mono focus:outline-none focus:border-blue-500 select-none cursor-pointer shadow-sm ${sizeClasses} ${
          isOpen ? 'border-blue-500/60 ring-1 ring-blue-500/20' : ''
        } ${disabled ? 'opacity-50 cursor-not-allowed' : ''} ${triggerClassName}`}
      >
        <div className="flex items-center gap-1.5 min-w-0 flex-1 truncate">
          {leftIcon && <span className="shrink-0">{leftIcon}</span>}
          {selectedOption?.icon && <span className="shrink-0">{selectedOption.icon}</span>}
          <span className="truncate text-gray-100 font-medium">
            {selectedOption ? selectedOption.label : placeholder}
          </span>
          {selectedOption?.badge && (
            <span className="text-[10px] text-gray-400 font-mono shrink-0 ml-1">
              {selectedOption.badge}
            </span>
          )}
        </div>
        <ChevronDown
          className={`w-3.5 h-3.5 text-gray-400 shrink-0 transition-transform duration-200 ${
            isOpen ? 'rotate-180 text-blue-400' : ''
          }`}
        />
      </button>

      {/* Popover Dropdown Menu */}
      {isOpen && (
        <div
          className={`absolute z-50 mt-1.5 min-w-[200px] w-max max-w-[380px] bg-gray-950/95 border border-white/15 rounded-xl shadow-2xl backdrop-blur-2xl p-1 overflow-hidden animate-in fade-in zoom-in-95 duration-150 ${
            align === 'right' ? 'right-0' : 'left-0'
          } ${menuClassName}`}
        >
          {/* Search box if needed */}
          {isSearchActive && (
            <div className="p-1.5 border-b border-white/10 mb-1">
              <div className="relative flex items-center">
                <Search className="w-3.5 h-3.5 text-gray-500 absolute left-2 pointer-events-none" />
                <input
                  ref={searchInputRef}
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder={searchPlaceholder}
                  className="w-full pl-7 pr-6 py-1 bg-black/50 border border-white/10 rounded-lg text-xs font-mono text-gray-200 placeholder:text-gray-600 focus:outline-none focus:border-blue-500"
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery('')}
                    className="absolute right-2 text-gray-500 hover:text-white"
                  >
                    <X className="w-3 h-3" />
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Options list */}
          <div className="max-h-60 overflow-y-auto space-y-0.5 custom-scrollbar">
            {filteredGroups.length === 0 ? (
              <div className="px-3 py-3 text-center text-xs text-gray-500 font-mono">
                No matching options
              </div>
            ) : (
              filteredGroups.map((group, gIdx) => (
                <div key={group.name || `g-${gIdx}`} className="space-y-0.5">
                  {group.name && (
                    <div className="px-2.5 py-1 text-[10px] font-bold text-gray-500 uppercase tracking-wider select-none">
                      {group.name}
                    </div>
                  )}
                  {group.options.map((opt) => {
                    const isSelected = opt.value === value;
                    return (
                      <div
                        key={opt.value}
                        onClick={() => {
                          onChange(opt.value);
                          setIsOpen(false);
                          setSearchQuery('');
                        }}
                        className={`group px-2.5 py-1.5 rounded-lg text-left transition-all flex items-center justify-between gap-2 font-mono text-xs cursor-pointer select-none ${
                          isSelected
                            ? 'bg-blue-600/20 text-white font-medium border-l-2 border-blue-400 pl-2'
                            : 'text-gray-300 hover:bg-white/10 hover:text-white'
                        }`}
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            {opt.icon && <span className="shrink-0">{opt.icon}</span>}
                            <span className="truncate">{opt.label}</span>
                            {opt.badge && (
                              <span
                                className={`text-[9px] px-1 py-0.2 rounded font-mono shrink-0 ml-1 ${
                                  isSelected
                                    ? 'bg-blue-500/20 text-blue-300'
                                    : 'bg-white/5 text-gray-400 group-hover:text-gray-300'
                                }`}
                              >
                                {opt.badge}
                              </span>
                            )}
                          </div>
                          {opt.description && (
                            <span className="text-[10px] text-gray-500 block truncate font-sans mt-0.5">
                              {opt.description}
                            </span>
                          )}
                        </div>
                        {isSelected && (
                          <Check className="w-3.5 h-3.5 text-blue-400 shrink-0" />
                        )}
                      </div>
                    );
                  })}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
