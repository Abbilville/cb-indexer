export interface LiveEvent {
  id?: string;
  type: string;
  repo?: string;
  project?: string;
  message: string;
  timestamp: string;
  level?: 'info' | 'success' | 'warn' | 'error';
  data?: Record<string, unknown>;
}
