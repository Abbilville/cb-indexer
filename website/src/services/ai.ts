import {
  AiConfig,
  ChatMessage,
  PROVIDER_PRESETS,
  AiProvider,
} from '../types/ai';
import { GraphNode, GraphPayload } from '../types/graph';
import { ApiService } from './api';
const AI_CONFIG_KEY = 'cb_ai_config';

export class AiService {
  public static loadConfig(): AiConfig {
    if (typeof window === 'undefined') {
      return {
        provider: 'gemini',
        apiKey: '',
        model: PROVIDER_PRESETS.gemini.defaultModel,
        temperature: 0.2,
        includeNodeContext: true,
        includeGraphContext: true,
      };
    }

    try {
      const raw = localStorage.getItem(AI_CONFIG_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<AiConfig>;
        const provider: AiProvider =
          parsed.provider && PROVIDER_PRESETS[parsed.provider]
            ? parsed.provider
            : 'gemini';
        const preset = PROVIDER_PRESETS[provider];

        let baseUrl = parsed.baseUrl || preset.defaultBaseUrl;
        if (provider === 'huggingface' && (!baseUrl || baseUrl.includes('hf-inference'))) {
          baseUrl = 'https://router.huggingface.co/v1';
        }

        return {
          provider,
          apiKey: parsed.apiKey || '',
          model: parsed.model || preset.defaultModel,
          baseUrl,
          temperature: parsed.temperature ?? 0.2,
          includeNodeContext: parsed.includeNodeContext ?? true,
          includeGraphContext: parsed.includeGraphContext ?? true,
        };
      }
    } catch {
      // Fallback
    }

    return {
      provider: 'gemini',
      apiKey: '',
      model: PROVIDER_PRESETS.gemini.defaultModel,
      baseUrl: PROVIDER_PRESETS.gemini.defaultBaseUrl,
      temperature: 0.2,
      includeNodeContext: true,
      includeGraphContext: true,
    };
  }

  public static saveConfig(config: AiConfig): void {
    if (typeof window === 'undefined') return;
    try {
      localStorage.setItem(AI_CONFIG_KEY, JSON.stringify(config));
    } catch {
      // Ignored
    }
  }

  private static parseErrorMessage(errData: unknown, status: number, providerName: string): string {
    if (typeof errData === 'string' && errData.trim()) {
      try {
        const parsed = JSON.parse(errData);
        return this.parseErrorMessage(parsed, status, providerName);
      } catch {
        return errData.trim();
      }
    }
    if (errData && typeof errData === 'object') {
      const obj = errData as Record<string, unknown>;
      if (typeof obj.error === 'string' && obj.error.trim()) {
        return obj.error.trim();
      }
      if (obj.error && typeof obj.error === 'object') {
        const nested = obj.error as Record<string, unknown>;
        if (typeof nested.message === 'string' && nested.message.trim()) {
          return nested.message.trim();
        }
      }
      if (typeof obj.message === 'string' && obj.message.trim()) {
        return obj.message.trim();
      }
    }
    return `${providerName} error (HTTP ${status})`;
  }

  // Format system prompt combining codebase architecture and selected symbol context
  public static buildSystemPrompt(
    config: AiConfig,
    graphData: GraphPayload | null,
    selectedNode: GraphNode | null
  ): string {
    const parts: string[] = [
      'You are an expert AI Codebase Architecture & Intelligence Assistant embedded in cb-indexer.',
      'Your job is to explain repository structure, service topology, inter-service API calls, database links, symbols, and architecture patterns.',
      'Always give direct, technical, and accurate answers based on the codebase graph facts provided below.',
    ];

    if (config.includeGraphContext && graphData) {
      parts.push(`\n--- ACTIVE CODEBASE TOPOLOGY & GRAPH METRICS ---`);
      parts.push(`Project / Scope: ${graphData.project || 'Global Workspace'}`);
      parts.push(`Total AST Nodes in Graph: ${graphData.returned_nodes}`);
      parts.push(`Total Connections / Edges: ${graphData.returned_edges}`);

      // Map nodes by id for link resolution
      const nodeMap = new Map<string | number, GraphNode>();
      const serviceNodes: GraphNode[] = [];
      const symbolsByProject = new Map<string, { endpoints: string[]; classes: string[]; functions: string[] }>();

      (graphData.nodes || []).forEach((n) => {
        nodeMap.set(n.id, n);
        const pKey = n.project || 'default';
        if (!symbolsByProject.has(pKey)) {
          symbolsByProject.set(pKey, { endpoints: [], classes: [], functions: [] });
        }
        const bucket = symbolsByProject.get(pKey)!;

        const lbl = (n.label || '').toLowerCase();
        if (lbl === 'service' || lbl === 'repository') {
          serviceNodes.push(n);
        } else if (lbl.includes('endpoint') || lbl.includes('route') || lbl.includes('api') || lbl.includes('http')) {
          bucket.endpoints.push(`${n.name}${n.file_path ? ` [${n.file_path}]` : ''}`);
        } else if (lbl.includes('class') || lbl.includes('interface') || lbl.includes('struct') || lbl.includes('model')) {
          bucket.classes.push(`${n.name}${n.file_path ? ` [${n.file_path}]` : ''}`);
        } else if (lbl.includes('function') || lbl.includes('method')) {
          bucket.functions.push(n.name);
        }
      });

      // Output discovered services
      if (serviceNodes.length > 0) {
        parts.push(`\n--- DISCOVERED SERVICES & REPOSITORIES ---`);
        serviceNodes.slice(0, 30).forEach((s) => {
          const props = s.properties || {};
          const tech = Array.isArray(props.tech_stack) ? props.tech_stack.join(', ') : props.tech_stack || '';
          const port = props.port ? `Port: ${props.port}` : '';
          const entry = props.entry_point ? `Entry: ${props.entry_point}` : '';
          const desc = props.description ? `Description: ${props.description}` : '';
          const details = [tech, port, entry, desc].filter(Boolean).join(' | ');
          parts.push(`- **${s.name}** [${s.label}]: ${details || s.file_path || 'active service'}`);
        });
      }

      // Output structural components per service/project
      parts.push(`\n--- STRUCTURAL COMPONENTS & SYMBOLS ---`);
      symbolsByProject.forEach((bucket, proj) => {
        const lines: string[] = [];
        if (bucket.endpoints.length > 0) {
          lines.push(`  - Endpoints / Routes: ${bucket.endpoints.slice(0, 10).join('; ')}`);
        }
        if (bucket.classes.length > 0) {
          lines.push(`  - Key Classes / Types: ${bucket.classes.slice(0, 10).join('; ')}`);
        }
        if (bucket.functions.length > 0) {
          lines.push(`  - Functions: ${bucket.functions.slice(0, 15).join(', ')}`);
        }
        if (lines.length > 0) {
          parts.push(`Service / Module "${proj}":\n${lines.join('\n')}`);
        }
      });

      // Output topology connections & relationships
      if (graphData.links && graphData.links.length > 0) {
        parts.push(`\n--- TOPOLOGY CONNECTIONS & RELATIONSHIPS ---`);
        const sampleLinks = graphData.links.slice(0, 50);
        sampleLinks.forEach((l) => {
          const srcNode = typeof l.source === 'object' && l.source !== null ? (l.source as GraphNode) : nodeMap.get(l.source);
          const dstNode = typeof l.target === 'object' && l.target !== null ? (l.target as GraphNode) : nodeMap.get(l.target);
          const srcName = srcNode ? srcNode.name : String(l.source);
          const dstName = dstNode ? dstNode.name : String(l.target);
          const desc = l.properties?.description ? ` (${l.properties.description})` : '';
          parts.push(`- ${srcName} --[${l.type}]--> ${dstName}${desc}`);
        });
      }
    }

    if (config.includeNodeContext && selectedNode) {
      parts.push(`\n--- CURRENTLY SELECTED SYMBOL / ENTITY ---`);
      parts.push(`Name: ${selectedNode.name}`);
      parts.push(`Type / Label: ${selectedNode.label}`);
      if (selectedNode.project) {
        parts.push(`Project / Service: ${selectedNode.project}`);
      }
      if (selectedNode.qualified_name) {
        parts.push(`Qualified Name: ${selectedNode.qualified_name}`);
      }
      if (selectedNode.file_path) {
        parts.push(`File Path: ${selectedNode.file_path}:${selectedNode.start_line || 1}`);
      }
      if (selectedNode.properties && Object.keys(selectedNode.properties).length > 0) {
        parts.push(`Properties: ${JSON.stringify(selectedNode.properties)}`);
      }

      // Trace connected incoming & outgoing edges for selected node
      if (graphData && graphData.links) {
        const inLinks: string[] = [];
        const outLinks: string[] = [];
        graphData.links.forEach((l) => {
          const sId = typeof l.source === 'object' && l.source !== null ? (l.source as GraphNode).id : l.source;
          const tId = typeof l.target === 'object' && l.target !== null ? (l.target as GraphNode).id : l.target;
          if (String(sId) === String(selectedNode.id)) {
            const tgt = typeof l.target === 'object' && l.target !== null ? (l.target as GraphNode).name : l.target;
            outLinks.push(`calls/depends on ${tgt} [${l.type}]`);
          } else if (String(tId) === String(selectedNode.id)) {
            const src = typeof l.source === 'object' && l.source !== null ? (l.source as GraphNode).name : l.source;
            inLinks.push(`called by ${src} [${l.type}]`);
          }
        });
        if (inLinks.length > 0) {
          parts.push(`Incoming Connections: ${inLinks.slice(0, 10).join(', ')}`);
        }
        if (outLinks.length > 0) {
          parts.push(`Outgoing Connections: ${outLinks.slice(0, 10).join(', ')}`);
        }
      }
    }

    return parts.join('\n');
  }

  // Real-time streaming conversation handler
  public static async sendMessageStream(
    config: AiConfig,
    messages: ChatMessage[],
    graphData: GraphPayload | null,
    selectedNode: GraphNode | null,
    onChunk: (chunk: string) => void
  ): Promise<string> {
    const preset = PROVIDER_PRESETS[config.provider] || PROVIDER_PRESETS.gemini;
    if (preset.requiresKey && !config.apiKey.trim()) {
      throw new Error(`Please enter your ${preset.name} API Key in settings.`);
    }

    const systemPrompt = this.buildSystemPrompt(config, graphData, selectedNode);

    try {
      if (config.provider === 'gemini') {
        return await this.streamGemini(config, messages, systemPrompt, onChunk);
      } else if (config.provider === 'claude') {
        return await this.streamClaude(config, messages, systemPrompt, onChunk);
      } else {
        return await this.streamOpenAiCompatible(config, messages, systemPrompt, onChunk);
      }
    } catch (err: unknown) {
      // Fallback via backend proxy if direct browser fetch encountered CORS or network barrier
      return await this.callProxy(config, messages, systemPrompt, err, onChunk);
    }
  }

  public static async sendMessage(
    config: AiConfig,
    messages: ChatMessage[],
    graphData: GraphPayload | null,
    selectedNode: GraphNode | null
  ): Promise<string> {
    let full = '';
    return this.sendMessageStream(config, messages, graphData, selectedNode, (chunk) => {
      full += chunk;
    });
  }

  // 1. Google Gemini Streaming API
  private static async streamGemini(
    config: AiConfig,
    messages: ChatMessage[],
    systemPrompt: string,
    onChunk: (chunk: string) => void
  ): Promise<string> {
    const model = config.model || PROVIDER_PRESETS.gemini.defaultModel;
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
      model
    )}:streamGenerateContent?alt=sse&key=${encodeURIComponent(config.apiKey.trim())}`;

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
        temperature: config.temperature ?? 0.2,
      },
    };

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      let parsed: unknown = null;
      try {
        parsed = JSON.parse(errText);
      } catch {
        parsed = errText;
      }
      throw new Error(this.parseErrorMessage(parsed, res.status, 'Gemini'));
    }

    if (!res.body) {
      throw new Error('ReadableStream not supported by response');
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let accumulated = '';
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line.startsWith('data:')) continue;
        const dataStr = line.replace(/^data:\s*/, '').trim();
        if (!dataStr || dataStr === '[DONE]') continue;

        try {
          const parsed = JSON.parse(dataStr) as {
            candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
          };
          const piece = parsed.candidates?.[0]?.content?.parts?.[0]?.text;
          if (piece) {
            accumulated += piece;
            onChunk(piece);
          }
        } catch {
          // Ignore partial line
        }
      }
    }

    return accumulated;
  }

  // 2. OpenAI-Compatible Streaming API (OpenAI, Groq, DeepSeek, OpenRouter, Hugging Face, Ollama, Custom)
  private static async streamOpenAiCompatible(
    config: AiConfig,
    messages: ChatMessage[],
    systemPrompt: string,
    onChunk: (chunk: string) => void
  ): Promise<string> {
    const preset = PROVIDER_PRESETS[config.provider] || PROVIDER_PRESETS.openai;
    let baseUrl = config.baseUrl?.trim() || preset.defaultBaseUrl || 'https://api.openai.com/v1';
    if (config.provider === 'huggingface' && baseUrl.includes('hf-inference')) {
      baseUrl = 'https://router.huggingface.co/v1';
    }
    const endpoint = `${baseUrl.replace(/\/+$/, '')}/chat/completions`;

    const formattedMessages = [
      { role: 'system', content: systemPrompt },
      ...messages.map((m) => ({ role: m.role, content: m.content })),
    ];

    const payload = {
      model: config.model || preset.defaultModel,
      messages: formattedMessages,
      temperature: config.temperature ?? 0.2,
      stream: true,
    };

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (config.apiKey.trim()) {
      headers['Authorization'] = `Bearer ${config.apiKey.trim()}`;
    }

    const res = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      let parsed: unknown = null;
      try {
        parsed = JSON.parse(errText);
      } catch {
        parsed = errText;
      }
      const rawMsg = this.parseErrorMessage(parsed, res.status, preset.name);
      if (config.provider === 'huggingface' && res.status === 403) {
        throw new Error(
          `${rawMsg} — Hugging Face 403: (1) Ensure your HF token has "Make calls to the serverless Inference API" enabled on huggingface.co/settings/tokens. (2) Models >10B require a Pro account; switch to free serverless models like Qwen/Qwen2.5-Coder-7B-Instruct or Llama-3.2-3B.`
        );
      }
      throw new Error(rawMsg);
    }

    if (!res.body) {
      throw new Error('ReadableStream not supported by response');
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let accumulated = '';
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line.startsWith('data:')) continue;
        const dataStr = line.replace(/^data:\s*/, '').trim();
        if (!dataStr || dataStr === '[DONE]') continue;

        try {
          const parsed = JSON.parse(dataStr) as {
            choices?: Array<{ delta?: { content?: string } }>;
          };
          const piece = parsed.choices?.[0]?.delta?.content;
          if (piece) {
            accumulated += piece;
            onChunk(piece);
          }
        } catch {
          // Ignore partial line
        }
      }
    }

    return accumulated;
  }

  // 3. Anthropic Claude Streaming API
  private static async streamClaude(
    config: AiConfig,
    messages: ChatMessage[],
    systemPrompt: string,
    onChunk: (chunk: string) => void
  ): Promise<string> {
    const endpoint = 'https://api.anthropic.com/v1/messages';
    const payload = {
      model: config.model || PROVIDER_PRESETS.claude.defaultModel,
      max_tokens: 4096,
      system: systemPrompt,
      messages: messages.map((m) => ({
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content: m.content,
      })),
      temperature: config.temperature ?? 0.2,
      stream: true,
    };

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
      const errText = await res.text().catch(() => '');
      let parsed: unknown = null;
      try {
        parsed = JSON.parse(errText);
      } catch {
        parsed = errText;
      }
      throw new Error(this.parseErrorMessage(parsed, res.status, 'Claude'));
    }

    if (!res.body) {
      throw new Error('ReadableStream not supported by response');
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let accumulated = '';
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line.startsWith('data:')) continue;
        const dataStr = line.replace(/^data:\s*/, '').trim();
        if (!dataStr) continue;

        try {
          const parsed = JSON.parse(dataStr) as {
            type?: string;
            delta?: { type?: string; text?: string };
          };
          if (parsed.type === 'content_block_delta' && parsed.delta?.text) {
            const piece = parsed.delta.text;
            accumulated += piece;
            onChunk(piece);
          }
        } catch {
          // Ignore partial line
        }
      }
    }

    return accumulated;
  }

  // 4. Backend Proxy fallback (eliminates browser CORS limitations)
  private static async callProxy(
    config: AiConfig,
    messages: ChatMessage[],
    systemPrompt: string,
    originalError: unknown,
    onChunk: (chunk: string) => void
  ): Promise<string> {
    const baseUrl = process.env.NEXT_PUBLIC_API_URL || '';
    let proxyRes: Response;
    try {
      proxyRes = await fetch(`${baseUrl}/api/ai/chat`, {
        method: 'POST',
        headers: ApiService.getHeaders(),
        body: JSON.stringify({
          provider: config.provider,
          api_key: config.apiKey,
          model: config.model,
          base_url: config.baseUrl,
          temperature: config.temperature,
          system_prompt: systemPrompt,
          messages: messages.map((m) => ({ role: m.role, content: m.content })),
        }),
      });
    } catch {
      const origMsg = originalError instanceof Error ? originalError.message : String(originalError);
      throw new Error(origMsg);
    }

    if (!proxyRes.ok) {
      const errText = await proxyRes.text().catch(() => '');
      let parsed: unknown = null;
      try {
        parsed = JSON.parse(errText);
      } catch {
        parsed = errText;
      }
      const proxyMsg = this.parseErrorMessage(parsed, proxyRes.status, config.provider);
      if (config.provider === 'huggingface' && proxyRes.status === 403) {
        throw new Error(
          `${proxyMsg} — Hugging Face 403: (1) Ensure your HF token has "Make calls to the serverless Inference API" enabled on huggingface.co/settings/tokens. (2) Models >10B require a Pro account; switch to free serverless models like Qwen/Qwen2.5-Coder-7B-Instruct or Llama-3.2-3B.`
        );
      }
      throw new Error(proxyMsg);
    }

    const data = (await proxyRes.json()) as Record<string, unknown>;
    const text = String(data.response || '');
    onChunk(text);
    return text;
  }
}
