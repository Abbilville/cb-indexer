export type AiProvider =
  | 'gemini'
  | 'openai'
  | 'claude'
  | 'groq'
  | 'deepseek'
  | 'openrouter'
  | 'huggingface'
  | 'ollama'
  | 'custom';

export interface AiConfig {
  provider: AiProvider;
  apiKey: string;
  model: string;
  baseUrl?: string;
  temperature?: number;
  includeNodeContext?: boolean;
  includeGraphContext?: boolean;
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
  category: 'Flagship' | 'Open Source' | 'Local' | 'Aggregator';
  defaultModel: string;
  models: string[];
  placeholderKey: string;
  defaultBaseUrl?: string;
  apiKeyDocsUrl?: string;
  requiresKey: boolean;
  description: string;
}

export const PROVIDER_PRESETS: Record<AiProvider, ProviderPreset> = {
  gemini: {
    id: 'gemini',
    name: 'Google Gemini',
    category: 'Flagship',
    defaultModel: 'gemini-2.5-flash',
    models: ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-1.5-pro', 'gemini-1.5-flash'],
    placeholderKey: 'AIzaSy...',
    apiKeyDocsUrl: 'https://aistudio.google.com/app/apikey',
    requiresKey: true,
    description: 'Ultra-fast multimodal reasoning with massive context window from Google.',
  },
  openai: {
    id: 'openai',
    name: 'OpenAI',
    category: 'Flagship',
    defaultModel: 'gpt-4o',
    models: ['gpt-4o', 'gpt-4o-mini', 'o3-mini', 'o1', 'gpt-4-turbo'],
    placeholderKey: 'sk-proj-...',
    defaultBaseUrl: 'https://api.openai.com/v1',
    apiKeyDocsUrl: 'https://platform.openai.com/api-keys',
    requiresKey: true,
    description: 'Industry-standard general reasoning and code intelligence.',
  },
  claude: {
    id: 'claude',
    name: 'Anthropic Claude',
    category: 'Flagship',
    defaultModel: 'claude-3-7-sonnet-20250219',
    models: [
      'claude-3-7-sonnet-20250219',
      'claude-3-5-sonnet-20241022',
      'claude-3-5-haiku-20241022',
      'claude-3-opus-20240229',
    ],
    placeholderKey: 'sk-ant-api03-...',
    defaultBaseUrl: 'https://api.anthropic.com/v1',
    apiKeyDocsUrl: 'https://console.anthropic.com/settings/keys',
    requiresKey: true,
    description: 'SOTA code architecture analysis and nuanced technical reasoning.',
  },
  groq: {
    id: 'groq',
    name: 'Groq (LPU)',
    category: 'Open Source',
    defaultModel: 'llama-3.3-70b-versatile',
    models: [
      'llama-3.3-70b-versatile',
      'deepseek-r1-distill-llama-70b',
      'llama-3.1-8b-instant',
      'mixtral-8x7b-32768',
      'gemma2-9b-it',
    ],
    placeholderKey: 'gsk_...',
    defaultBaseUrl: 'https://api.groq.com/openai/v1',
    apiKeyDocsUrl: 'https://console.groq.com/keys',
    requiresKey: true,
    description: 'Instantaneous inference speeds running top open-weights models.',
  },
  deepseek: {
    id: 'deepseek',
    name: 'DeepSeek',
    category: 'Open Source',
    defaultModel: 'deepseek-chat',
    models: ['deepseek-chat', 'deepseek-reasoner'],
    placeholderKey: 'sk-...',
    defaultBaseUrl: 'https://api.deepseek.com/v1',
    apiKeyDocsUrl: 'https://platform.deepseek.com/api_keys',
    requiresKey: true,
    description: 'Exceptional coding and mathematical reasoning at affordable scale.',
  },
  openrouter: {
    id: 'openrouter',
    name: 'OpenRouter',
    category: 'Aggregator',
    defaultModel: 'deepseek/deepseek-r1',
    models: [
      'deepseek/deepseek-r1',
      'anthropic/claude-3.5-sonnet',
      'openai/gpt-4o',
      'meta-llama/llama-3.3-70b-instruct',
      'google/gemini-2.0-flash-001',
      'qwen/qwen-2.5-coder-32b-instruct',
    ],
    placeholderKey: 'sk-or-v1-...',
    defaultBaseUrl: 'https://openrouter.ai/api/v1',
    apiKeyDocsUrl: 'https://openrouter.ai/keys',
    requiresKey: true,
    description: 'Unified router supporting hundreds of open and proprietary LLMs.',
  },
  huggingface: {
    id: 'huggingface',
    name: 'Hugging Face',
    category: 'Open Source',
    defaultModel: 'Qwen/Qwen2.5-Coder-7B-Instruct',
    models: [
      'Qwen/Qwen2.5-Coder-7B-Instruct',
      'deepseek-ai/DeepSeek-R1',
      'meta-llama/Llama-3.2-3B-Instruct',
      'meta-llama/Llama-3.1-8B-Instruct',
      'mistralai/Mistral-7B-Instruct-v0.3',
      'Qwen/Qwen2.5-Coder-32B-Instruct',
    ],
    placeholderKey: 'hf_...',
    defaultBaseUrl: 'https://router.huggingface.co/v1',
    apiKeyDocsUrl: 'https://huggingface.co/settings/tokens',
    requiresKey: true,
    description: 'Hugging Face Inference Router. Fast open-source models with read access token.',
  },
  ollama: {
    id: 'ollama',
    name: 'Ollama (Local)',
    category: 'Local',
    defaultModel: 'qwen2.5-coder:latest',
    models: [
      'qwen2.5-coder:latest',
      'deepseek-r1:latest',
      'llama3.3:latest',
      'codellama:latest',
      'mistral:latest',
      'phi4:latest',
    ],
    placeholderKey: 'No API key needed for local Ollama',
    defaultBaseUrl: 'http://localhost:11434/v1',
    apiKeyDocsUrl: 'https://ollama.com',
    requiresKey: false,
    description: 'Run fully private open-source models offline on your own machine.',
  },
  custom: {
    id: 'custom',
    name: 'Custom Endpoint',
    category: 'Local',
    defaultModel: 'custom-model',
    models: ['custom-model', 'vllm-model', 'local-model'],
    placeholderKey: 'Optional Bearer token / API key...',
    defaultBaseUrl: 'http://localhost:8000/v1',
    requiresKey: false,
    description: 'Connect to any OpenAI-compatible server (vLLM, LM Studio, LocalAI, etc.).',
  },
};
