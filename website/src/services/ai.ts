import { AiConfig, ChatMessage, PROVIDER_PRESETS, DetectedCredential, CredentialsResponse } from '../types/ai';
import { GraphNode, GraphPayload } from '../types/graph';

const AI_CONFIG_KEY = 'cb_ai_config';

export class AiService {
  public static loadConfig(): AiConfig {
    if (typeof window === 'undefined') {
      return {
        provider: 'gemini',
        authMethod: 'harness',
        apiKey: '',
        sessionToken: '',
        model: PROVIDER_PRESETS.gemini.defaultModel,
        temperature: 0.4,
        includeNodeContext: true,
        includeGraphContext: true,
      };
    }

    try {
      const raw = localStorage.getItem(AI_CONFIG_KEY);
      if (raw) {
        return JSON.parse(raw) as AiConfig;
      }
    } catch {
      // Ignored
    }

    return {
      provider: 'gemini',
      authMethod: 'harness',
      apiKey: '',
      sessionToken: '',
      model: PROVIDER_PRESETS.gemini.defaultModel,
      temperature: 0.4,
      includeNodeContext: true,
      includeGraphContext: true,
    };
  }

  public static async fetchDetectedCredentials(): Promise<DetectedCredential[]> {
    try {
      const baseUrl = process.env.NEXT_PUBLIC_API_URL || '';
      const res = await fetch(`${baseUrl}/api/ai/credentials`);
      if (!res.ok) return [];
      const data = (await res.json()) as CredentialsResponse;
      return data.detected || [];
    } catch {
      return [];
    }
  }
  public static saveConfig(config: AiConfig): void {
    if (typeof window === 'undefined') return;
    try {
      localStorage.setItem(AI_CONFIG_KEY, JSON.stringify(config));
    } catch {
      // Ignored
    }
  }

  // Format system prompt combining codebase architecture and selected symbol context
  public static buildSystemPrompt(
    config: AiConfig,
    graphData: GraphPayload | null,
    selectedNode: GraphNode | null
  ): string {
    const parts: string[] = [
      'You are an expert AI Codebase Architecture & Intelligence Assistant embedded in cb-indexer.',
      'Your job is to explain repository structure, service topology, call chains, symbols, and architecture patterns.',
      'Answer concisely, grounded in the provided codebase knowledge graph facts.',
    ];

    if (config.includeGraphContext && graphData) {
      parts.push(`\n--- ACTIVE REPOSITORY & GRAPH METRICS ---`);
      parts.push(`Project / Ecosystem: ${graphData.project || 'Global Workspace'}`);
      parts.push(`Total AST Nodes in Graph: ${graphData.returned_nodes}`);
      parts.push(`Total Connections / Links: ${graphData.returned_edges}`);
      parts.push(`Discovered Symbol Types: ${graphData.available_labels?.join(', ') || 'N/A'}`);
      parts.push(`Discovered Relationship Types: ${graphData.available_types?.join(', ') || 'N/A'}`);
    }

    if (config.includeNodeContext && selectedNode) {
      parts.push(`\n--- CURRENTLY SELECTED SYMBOL / ENTITY ---`);
      parts.push(`Name: ${selectedNode.name}`);
      parts.push(`Type / Label: ${selectedNode.label}`);
      if (selectedNode.qualified_name) {
        parts.push(`Qualified Name: ${selectedNode.qualified_name}`);
      }
      if (selectedNode.file_path) {
        parts.push(`File Path: ${selectedNode.file_path}:${selectedNode.start_line || 1}`);
      }
      if (selectedNode.properties && Object.keys(selectedNode.properties).length > 0) {
        parts.push(`Properties: ${JSON.stringify(selectedNode.properties)}`);
      }
    }

    return parts.join('\n');
  }

  // Send conversational prompt to chosen AI provider
  public static async sendMessage(
    config: AiConfig,
    messages: ChatMessage[],
    graphData: GraphPayload | null,
    selectedNode: GraphNode | null
  ): Promise<string> {
    const systemPrompt = this.buildSystemPrompt(config, graphData, selectedNode);

    // If in Harness auto-detect mode or Session token mode, route directly through Go backend proxy
    if (config.authMethod === 'harness' || config.authMethod === 'session') {
      return this.callProxy(config, messages, systemPrompt, new Error('Proxy mode'));
    }

    switch (config.provider) {
      case 'gemini':
        return this.callGemini(config, messages, systemPrompt);
      case 'claude':
        return this.callClaude(config, messages, systemPrompt);
      case 'openai':
      case 'custom':
        return this.callOpenAiCompatible(config, messages, systemPrompt);
      default:
        throw new Error(`Unsupported AI provider: ${config.provider}`);
    }
  }

  // 1. Google Gemini API Call
  private static async callGemini(
    config: AiConfig,
    messages: ChatMessage[],
    systemPrompt: string
  ): Promise<string> {
    if (!config.apiKey.trim()) {
      throw new Error('Please configure your Google Gemini API Key in the Ask settings.');
    }

    const model = config.model || PROVIDER_PRESETS.gemini.defaultModel;
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
      model
    )}:generateContent?key=${encodeURIComponent(config.apiKey.trim())}`;

    // Map conversation history to Gemini contents
    const contents = messages.map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }));

    const payload = {
      systemInstruction: {
        parts: [{ text: systemPrompt }],
      },
      contents,
      generationConfig: {
        temperature: config.temperature ?? 0.4,
        maxOutputTokens: 2048,
      },
    };

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const errJson = (await res.json().catch(() => ({}))) as Record<string, unknown>;
        const errObj = (errJson.error as Record<string, unknown>) || {};
        throw new Error(String(errObj.message || `HTTP ${res.status}`));
      }

      const data = (await res.json()) as Record<string, unknown>;
      const candidates = data.candidates as Array<{ content?: { parts?: Array<{ text?: string }> } }>;
      const text = candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) {
        throw new Error('No response text received from Gemini');
      }
      return text;
    } catch (err: unknown) {
      // Fallback through backend proxy if direct browser fetch hits CORS or network issues
      return this.callProxy(config, messages, systemPrompt, err);
    }
  }

  // 2. OpenAI / Compatible (DeepSeek, Ollama, OpenRouter, Groq)
  private static async callOpenAiCompatible(
    config: AiConfig,
    messages: ChatMessage[],
    systemPrompt: string
  ): Promise<string> {
    const isCustom = config.provider === 'custom';
    const baseUrl = config.baseUrl?.trim() || (isCustom ? 'https://api.deepseek.com/v1' : 'https://api.openai.com/v1');
    const endpoint = `${baseUrl.replace(/\/+$/, '')}/chat/completions`;

    if (!isCustom && !config.apiKey.trim()) {
      throw new Error('Please configure your OpenAI API Key in the settings.');
    }

    const formattedMessages = [
      { role: 'system', content: systemPrompt },
      ...messages.map((m) => ({ role: m.role, content: m.content })),
    ];

    const payload = {
      model: config.model || (isCustom ? 'deepseek-chat' : 'gpt-4o'),
      messages: formattedMessages,
      temperature: config.temperature ?? 0.4,
    };

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (config.apiKey.trim()) {
      headers['Authorization'] = `Bearer ${config.apiKey.trim()}`;
    }

    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const errJson = (await res.json().catch(() => ({}))) as Record<string, unknown>;
        const errObj = (errJson.error as Record<string, unknown>) || {};
        throw new Error(String(errObj.message || `HTTP ${res.status}`));
      }

      const data = (await res.json()) as Record<string, unknown>;
      const choices = data.choices as Array<{ message?: { content?: string } }>;
      const text = choices?.[0]?.message?.content;
      if (!text) {
        throw new Error('Empty response from AI endpoint');
      }
      return text;
    } catch (err: unknown) {
      return this.callProxy(config, messages, systemPrompt, err);
    }
  }

  // 3. Anthropic Claude API Call
  private static async callClaude(
    config: AiConfig,
    messages: ChatMessage[],
    systemPrompt: string
  ): Promise<string> {
    if (!config.apiKey.trim()) {
      throw new Error('Please configure your Anthropic Claude API Key in the settings.');
    }

    const endpoint = 'https://api.anthropic.com/v1/messages';
    const payload = {
      model: config.model || PROVIDER_PRESETS.claude.defaultModel,
      max_tokens: 2048,
      system: systemPrompt,
      messages: messages.map((m) => ({
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content: m.content,
      })),
      temperature: config.temperature ?? 0.4,
    };

    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': config.apiKey.trim(),
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const errJson = (await res.json().catch(() => ({}))) as Record<string, unknown>;
        const errObj = (errJson.error as Record<string, unknown>) || {};
        throw new Error(String(errObj.message || `HTTP ${res.status}`));
      }

      const data = (await res.json()) as Record<string, unknown>;
      const contentList = data.content as Array<{ text?: string }>;
      const text = contentList?.[0]?.text;
      if (!text) {
        throw new Error('No text returned by Claude');
      }
      return text;
    } catch (err: unknown) {
      return this.callProxy(config, messages, systemPrompt, err);
    }
  }

  // 4. Backend Proxy fallback (eliminates browser CORS limitations)
  private static async callProxy(
    config: AiConfig,
    messages: ChatMessage[],
    systemPrompt: string,
    originalError: unknown
  ): Promise<string> {
    try {
      const baseUrl = process.env.NEXT_PUBLIC_API_URL || '';
      const res = await fetch(`${baseUrl}/api/ai/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: config.provider,
          auth_mode: config.authMethod,
          api_key: config.apiKey,
          session_token: config.sessionToken,
          model: config.model,
          base_url: config.baseUrl,
          temperature: config.temperature,
          system_prompt: systemPrompt,
          messages: messages.map((m) => ({ role: m.role, content: m.content })),
        }),
      });

      if (!res.ok) {
        const errData = (await res.json().catch(() => ({}))) as Record<string, unknown>;
        throw new Error(String(errData.error || `Proxy error HTTP ${res.status}`));
      }

      const data = (await res.json()) as Record<string, unknown>;
      return String(data.response || '');
    } catch {
      const origMsg = originalError instanceof Error ? originalError.message : String(originalError);
      throw new Error(origMsg);
    }
  }
}
