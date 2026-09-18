import { LiveEvent } from '../types/events';

export type EventListener = (event: LiveEvent) => void;

export class SseService {
  private static eventSource: EventSource | null = null;
  private static listeners: Set<EventListener> = new Set();
  private static reconnectTimer: NodeJS.Timeout | null = null;

  public static subscribe(listener: EventListener): () => void {
    this.listeners.add(listener);
    if (this.listeners.size === 1) {
      this.connect();
    }
    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0) {
        this.disconnect();
      }
    };
  }

  private static connect(): void {
    if (typeof window === 'undefined' || !window.EventSource) return;
    if (this.eventSource) return;

    try {
      const baseUrl = process.env.NEXT_PUBLIC_API_URL || '';
      const es = new EventSource(`${baseUrl}/api/events`);
      this.eventSource = es;

      es.onmessage = (e) => {
        try {
          const parsed = JSON.parse(e.data) as Record<string, unknown>;
          const type = typeof parsed.type === 'string' ? parsed.type : 'log';
          const message = typeof parsed.message === 'string' ? parsed.message : JSON.stringify(parsed);
          const timestamp = typeof parsed.timestamp === 'string' ? parsed.timestamp : new Date().toLocaleTimeString();
          const repo = typeof parsed.repo === 'string' ? parsed.repo : undefined;
          const project = typeof parsed.project === 'string' ? parsed.project : undefined;

          let level: 'info' | 'success' | 'warn' | 'error' = 'info';
          if (type.includes('success') || type.includes('complete') || type.includes('indexed')) {
            level = 'success';
          } else if (type.includes('error') || type.includes('fail')) {
            level = 'error';
          } else if (type.includes('warn')) {
            level = 'warn';
          }

          const liveEvent: LiveEvent = {
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            type,
            repo,
            project,
            message,
            timestamp,
            level,
            data: parsed,
          };

          this.listeners.forEach((listener) => {
            try {
              listener(liveEvent);
            } catch (err) {
              console.error('Error in SSE listener:', err);
            }
          });
        } catch (err) {
          console.error('Failed to parse SSE payload:', err);
        }
      };

      es.onerror = () => {
        this.disconnect();
        if (this.listeners.size > 0 && !this.reconnectTimer) {
          this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null;
            this.connect();
          }, 3500);
        }
      };
    } catch (err) {
      console.error('Failed to initialize SSE EventSource:', err);
    }
  }

  private static disconnect(): void {
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }
}
