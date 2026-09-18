export type AiProvider = 'gemini' | 'claude' | 'openai' | 'custom';
export type AuthMethod = 'harness' | 'session' | 'api_key';

export interface AiConfig {
  provider: AiProvider;
  authMethod: AuthMethod;
  apiKey: string;
  sessionToken?: string;
  model: string;
  baseUrl?: string;
  temperature?: number;
  includeNodeContext?: boolean;
  includeGraphContext?: boolean;
}

export interface DetectedCredential {
  provider: AiProvider;
  name: string;
  source: string;
  available: boolean;
  detail?: string;
}

export interface CredentialsResponse {
  detected: DetectedCredential[];
}

export interface ModelsResponse {
  provider: string;
  models: string[];
  default: string;
}

export interface GitHubDeviceStartResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
}

export interface GitHubTokenResponse {
  access_token?: string;
  token_type?: string;
  scope?: string;
  error?: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
  contextSummary?: string;
  isError?: boolean;
}

export interface ProviderPreset {
  id: AiProvider;
  name: string;
  defaultModel: string;
  models: string[];
  placeholderKey: string;
  defaultBaseUrl?: string;
}

export const PROVIDER_PRESETS: Record<AiProvider, ProviderPreset> = {
  gemini: {
    id: 'gemini',
    name: 'Google Gemini',
    defaultModel: 'gemini-2.5-flash',
    models: ['gemini-2.5-flash', 'gemini-1.5-pro', 'gemini-1.5-flash'],
    placeholderKey: 'AIzaSy...',
  },
  claude: {
    id: 'claude',
    name: 'Anthropic Claude',
    defaultModel: 'claude-3-5-sonnet-20241022',
    models: ['claude-3-5-sonnet-20241022', 'claude-3-5-haiku-20241022', 'claude-3-opus-20240229'],
    placeholderKey: 'sk-ant-api03-...',
  },
  openai: {
    id: 'openai',
    name: 'OpenAI / Codex',
    defaultModel: 'gpt-4o',
    models: ['gpt-4o', 'o1-mini', 'gpt-4o-mini', 'gpt-4-turbo'],
    placeholderKey: 'sk-proj-...',
  },
  custom: {
    id: 'custom',
    name: 'Custom / Oh My Pi (Ollama, DeepSeek)',
    defaultModel: 'deepseek-chat',
    models: ['deepseek-chat', 'deepseek-coder', 'llama3.3:70b', 'qwen2.5-coder:32b', 'custom'],
    placeholderKey: 'Enter API key (or leave blank for local Ollama)...',
    defaultBaseUrl: 'https://api.deepseek.com/v1',
  },
};
