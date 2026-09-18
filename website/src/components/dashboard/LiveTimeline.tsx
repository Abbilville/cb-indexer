'use client';

import React, { useEffect, useState, useRef } from 'react';
import { LiveEvent } from '../../types/events';
import { SseService } from '../../services/sse';
import { Activity, CheckCircle, AlertCircle, AlertTriangle, Info, Trash2 } from 'lucide-react';

export function LiveTimeline() {
  const [events, setEvents] = useState<LiveEvent[]>([]);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const unsubscribe = SseService.subscribe((event) => {
      setEvents((prev) => [event, ...prev.slice(0, 49)]);
    });

    return () => {
      unsubscribe();
    };
  }, []);

  const handleClear = () => {
    setEvents([]);
  };

  return (
    <section className="p-5 bg-gray-900/60 border border-white/10 rounded-2xl shadow-lg backdrop-blur-md flex flex-col flex-1 min-h-[300px]">
      <div className="flex items-center justify-between pb-3 mb-3 border-b border-white/10">
        <div className="flex items-center gap-2 text-white font-bold text-xs uppercase tracking-wider">
          <Activity className="w-4 h-4 text-emerald-400" />
          <span>Ingestion & Activity Stream</span>
        </div>
        {events.length > 0 && (
          <button
            onClick={handleClear}
            className="text-[11px] text-gray-500 hover:text-gray-300 p-1 rounded transition-colors flex items-center gap-1"
            title="Clear logs"
          >
            <Trash2 className="w-3 h-3" />
            <span>Clear</span>
          </button>
        )}
      </div>

      <div
        ref={containerRef}
        className="flex-1 overflow-y-auto space-y-2 pr-1 max-h-[380px]"
      >
        {events.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center py-10 text-center text-xs text-gray-500">
            <span className="w-2 h-2 rounded-full bg-emerald-400 pulse-green mb-2" />
            Listening for live daemon events...
          </div>
        ) : (
          events.map((ev) => (
            <div
              key={ev.id || `${ev.timestamp}-${ev.message}`}
              className="p-2.5 rounded-xl bg-black/30 border border-white/5 text-xs flex items-start gap-2.5 hover:bg-black/50 transition-colors animate-in fade-in"
            >
              <div className="mt-0.5 shrink-0">
                {ev.level === 'success' && <CheckCircle className="w-3.5 h-3.5 text-emerald-400" />}
                {ev.level === 'error' && <AlertCircle className="w-3.5 h-3.5 text-rose-400" />}
                {ev.level === 'warn' && <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />}
                {ev.level === 'info' && <Info className="w-3.5 h-3.5 text-blue-400" />}
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 flex-wrap mb-0.5">
                  <span className="text-[10px] text-gray-500 font-mono">{ev.timestamp}</span>
                  {ev.repo && (
                    <span className="text-[10px] px-1.5 py-0.2 rounded bg-blue-500/10 text-blue-300 border border-blue-500/20 font-mono">
                      {ev.repo}
                    </span>
                  )}
                  <span className="text-[10px] uppercase font-semibold text-gray-400">
                    {ev.type}
                  </span>
                </div>
                <div className="text-gray-300 leading-snug break-words font-mono text-[11px]">
                  {ev.message}
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </section>
  );
}
