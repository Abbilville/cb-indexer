'use client';

import React, { useState, useEffect, useRef } from 'react';
import { AiConfig, ChatMessage, AiProvider, PROVIDER_PRESETS } from '../../types/ai';
import { GraphNode, GraphPayload } from '../../types/graph';
import { AiService } from '../../services/ai';
import { useToast } from '../ui/Toast';
import {
  Send,
  Settings,
  Bot,
  User,
  Trash2,
  Sparkles,
  Loader2,
  Eye,
  EyeOff,
  Check,
  Copy,
  ChevronDown,
  Layers,
  ChevronUp,
} from 'lucide-react';

interface AstAskTabProps {
  graphData: GraphPayload | null;
  selectedNode: GraphNode | null;
  onClearSelectedNode: () => void;
}

export function AstAskTab({
  graphData,
  selectedNode,
  onClearSelectedNode,
}: AstAskTabProps) {
  const { showToast } = useToast();

  const [config, setConfig] = useState<AiConfig>(AiService.loadConfig);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [showApiKey, setShowApiKey] = useState(false);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputText, setInputText] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const chatEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Auto-scroll chat to bottom
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading]);

  // Persist config changes
  const updateConfig = (patch: Partial<AiConfig>) => {
    setConfig((prev) => {
      const next = { ...prev, ...patch };
      AiService.saveConfig(next);
      return next;
    });
  };

  const handleProviderChange = (provider: AiProvider) => {
    const preset = PROVIDER_PRESETS[provider];
    updateConfig({
      provider,
      model: preset.defaultModel,
      baseUrl: preset.defaultBaseUrl || '',
    });
  };

  const handleSendMessage = async (customPrompt?: string) => {
    const textToSend = customPrompt || inputText.trim();
    if (!textToSend || isLoading) return;

    // Validate API key if not a custom local endpoint
    if (config.provider !== 'custom' && !config.apiKey.trim()) {
      setIsSettingsOpen(true);
      showToast(`Please enter your ${PROVIDER_PRESETS[config.provider].name} API Key`, 'warn');
      return;
    }

    const userMessage: ChatMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: textToSend,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      contextSummary: selectedNode ? `${selectedNode.name} (${selectedNode.label})` : undefined,
    };

    const newMessages = [...messages, userMessage];
    setMessages(newMessages);
    setInputText('');
    setIsLoading(true);

    try {
      const answerText = await AiService.sendMessage(config, newMessages, graphData, selectedNode);
      const assistantMessage: ChatMessage = {
        id: `ai-${Date.now()}`,
        role: 'assistant',
        content: answerText,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      };
      setMessages((prev) => [...prev, assistantMessage]);
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to query AI assistant';
      const errorMessage: ChatMessage = {
        id: `err-${Date.now()}`,
        role: 'assistant',
        content: `Error: ${errorMsg}\n\nCheck your API key, model name, or network settings in the settings panel above.`,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        isError: true,
      };
      setMessages((prev) => [...prev, errorMessage]);
      showToast(errorMsg, 'error');
    } finally {
      setIsLoading(false);
    }
  };

  const handleCopy = (id: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const currentPreset = PROVIDER_PRESETS[config.provider] || PROVIDER_PRESETS.gemini;

  return (
    <div className="flex flex-col h-full overflow-hidden text-xs bg-gray-950/60">
      {/* 1. Header & Provider Bar */}
      <div className="p-3 border-b border-white/10 bg-black/30 shrink-0">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <div className="p-1.5 rounded-lg bg-blue-500/10 border border-blue-500/20 text-blue-400">
              <Bot className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <span className="font-bold text-gray-200 block truncate leading-tight">
                {currentPreset.name}
              </span>
              <span className="text-[10px] text-gray-500 font-mono block truncate">
                {config.model}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            {messages.length > 0 && (
              <button
                onClick={() => setMessages([])}
                className="p-1.5 rounded-lg text-gray-400 hover:text-rose-400 hover:bg-white/5 transition-colors"
                title="Clear Conversation"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            )}
            <button
              onClick={() => setIsSettingsOpen(!isSettingsOpen)}
              className={`p-1.5 rounded-lg border transition-all ${
                isSettingsOpen
                  ? 'bg-blue-600/20 border-blue-500/40 text-blue-300'
                  : 'bg-white/5 border-white/10 text-gray-400 hover:text-white'
              }`}
              title="Configure AI Provider & API Key"
            >
              <Settings className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Expandable Settings Drawer */}
        {isSettingsOpen && (
          <div className="mt-3 pt-3 border-t border-white/10 space-y-3 animate-in fade-in slide-in-from-top-2">
            {/* Provider Selector */}
            <div className="space-y-1">
              <label className="text-[10px] uppercase font-semibold text-gray-400 tracking-wider">
                AI Provider
              </label>
              <select
                value={config.provider}
                onChange={(e) => handleProviderChange(e.target.value as AiProvider)}
                className="w-full pl-2.5 pr-7 py-1.5 bg-black/60 border border-white/10 rounded-xl text-xs text-gray-200 focus:outline-none focus:border-blue-500 cursor-pointer"
              >
                <option value="gemini">Google Gemini (Gemini 2.5 Flash, 1.5 Pro)</option>
                <option value="claude">Anthropic Claude (3.5 Sonnet, 3.5 Haiku)</option>
                <option value="openai">OpenAI / Codex (GPT-4o, o1, mini)</option>
                <option value="custom">Custom / Oh My Pi (Ollama, DeepSeek, Groq)</option>
              </select>
            </div>

            {/* Model Selector */}
            <div className="space-y-1">
              <label className="text-[10px] uppercase font-semibold text-gray-400 tracking-wider">
                Model Name
              </label>
              <div className="flex gap-1.5">
                <input
                  type="text"
                  value={config.model}
                  onChange={(e) => updateConfig({ model: e.target.value })}
                  placeholder={currentPreset.defaultModel}
                  className="flex-1 px-2.5 py-1.5 bg-black/60 border border-white/10 rounded-xl text-xs text-gray-200 font-mono focus:outline-none focus:border-blue-500"
                />
              </div>
              <div className="flex flex-wrap gap-1 mt-1">
                {currentPreset.models.map((m) => (
                  <button
                    key={m}
                    onClick={() => updateConfig({ model: m })}
                    className={`text-[9.5px] px-1.5 py-0.2 rounded font-mono border transition-all ${
                      config.model === m
                        ? 'bg-blue-500/20 border-blue-500/40 text-blue-300'
                        : 'bg-white/5 border-white/5 text-gray-400 hover:text-white'
                    }`}
                  >
                    {m}
                  </button>
                ))}
              </div>
            </div>

            {/* API Key Input */}
            <div className="space-y-1">
              <label className="text-[10px] uppercase font-semibold text-gray-400 tracking-wider flex items-center justify-between">
                <span>Secret API Key</span>
                <span className="text-[9px] text-gray-500">Stored in browser localStorage</span>
              </label>
              <div className="relative">
                <input
                  type={showApiKey ? 'text' : 'password'}
                  value={config.apiKey}
                  onChange={(e) => updateConfig({ apiKey: e.target.value })}
                  placeholder={currentPreset.placeholderKey}
                  className="w-full pl-2.5 pr-8 py-1.5 bg-black/60 border border-white/10 rounded-xl text-xs text-gray-200 font-mono focus:outline-none focus:border-blue-500"
                />
                <button
                  type="button"
                  onClick={() => setShowApiKey(!showApiKey)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white"
                >
                  {showApiKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                </button>
              </div>
            </div>

            {/* Custom Base URL (if custom or custom provider) */}
            {(config.provider === 'custom' || config.provider === 'openai') && (
              <div className="space-y-1">
                <label className="text-[10px] uppercase font-semibold text-gray-400 tracking-wider">
                  Custom Base URL (OpenAI-Compatible)
                </label>
                <input
                  type="text"
                  value={config.baseUrl || ''}
                  onChange={(e) => updateConfig({ baseUrl: e.target.value })}
                  placeholder={currentPreset.defaultBaseUrl || 'https://api.openai.com/v1'}
                  className="w-full px-2.5 py-1.5 bg-black/60 border border-white/10 rounded-xl text-xs text-gray-200 font-mono focus:outline-none focus:border-blue-500"
                />
                <span className="text-[9.5px] text-gray-500 block">
                  Works with Ollama (`http://localhost:11434/v1`), DeepSeek, Groq, OpenRouter
                </span>
              </div>
            )}

            {/* Context Switches */}
            <div className="pt-2 border-t border-white/5 space-y-1.5">
              <label className="flex items-center gap-2 cursor-pointer select-none text-[11px] text-gray-300">
                <input
                  type="checkbox"
                  checked={config.includeGraphContext ?? true}
                  onChange={(e) => updateConfig({ includeGraphContext: e.target.checked })}
                  className="w-3.5 h-3.5 rounded accent-blue-500 bg-black/50"
                />
                <span>Include Knowledge Graph topology metrics</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer select-none text-[11px] text-gray-300">
                <input
                  type="checkbox"
                  checked={config.includeNodeContext ?? true}
                  onChange={(e) => updateConfig({ includeNodeContext: e.target.checked })}
                  className="w-3.5 h-3.5 rounded accent-blue-500 bg-black/50"
                />
                <span>Include currently selected symbol context</span>
              </label>
            </div>
          </div>
        )}
      </div>

      {/* 2. Active Node Context Pill */}
      {selectedNode && (
        <div className="px-3 py-1.5 bg-blue-950/40 border-b border-blue-500/20 flex items-center justify-between gap-2 shrink-0 animate-in fade-in">
          <div className="flex items-center gap-1.5 min-w-0">
            <Layers className="w-3.5 h-3.5 text-blue-400 shrink-0" />
            <span className="text-[10px] text-blue-300 truncate">
              Context: <strong className="text-white">{selectedNode.name}</strong> ({selectedNode.label})
            </span>
          </div>
          <button
            onClick={onClearSelectedNode}
            className="text-gray-400 hover:text-white p-0.5 rounded"
            title="Clear Node Context"
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      )}

      {/* 3. Message Stream / Empty State */}
      <div className="flex-1 overflow-y-auto p-3.5 space-y-3.5">
        {messages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center p-4 space-y-3 text-gray-500">
            <div className="p-3 rounded-2xl bg-blue-500/10 border border-blue-500/20 text-blue-400">
              <Sparkles className="w-6 h-6" />
            </div>
            <div>
              <h3 className="font-bold text-gray-200 text-xs mb-1">Ask Codebase AI</h3>
              <p className="text-[11px] text-gray-400 max-w-xs leading-relaxed">
                Ask architectural, call chain, or dependency questions grounded in the knowledge graph.
              </p>
            </div>

            {/* Quick Starters */}
            <div className="w-full space-y-1.5 pt-2 text-left">
              <button
                onClick={() => handleSendMessage('Explain the architecture and main microservices of this repository.')}
                className="w-full p-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/5 text-[11px] text-gray-300 text-left transition-all"
              >
                Explain the architecture and main microservices
              </button>
              <button
                onClick={() => handleSendMessage('List all API routes and entry points discovered in this codebase.')}
                className="w-full p-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/5 text-[11px] text-gray-300 text-left transition-all"
              >
                List all API routes and entry points
              </button>
              {selectedNode && (
                <button
                  onClick={() =>
                    handleSendMessage(`Explain the role of the selected symbol "${selectedNode.name}" (${selectedNode.label}) and its dependencies.`)
                  }
                  className="w-full p-2 rounded-xl bg-blue-500/10 hover:bg-blue-500/20 border border-blue-500/25 text-[11px] text-blue-200 text-left transition-all"
                >
                  Explain selected symbol &quot;{selectedNode.name}&quot;
                </button>
              )}
            </div>
          </div>
        ) : (
          messages.map((m) => {
            const isUser = m.role === 'user';
            const isCopied = copiedId === m.id;

            return (
              <div
                key={m.id}
                className={`flex gap-2.5 animate-in fade-in ${
                  isUser ? 'flex-row-reverse' : 'flex-row'
                }`}
              >
                <div
                  className={`w-6 h-6 rounded-lg flex items-center justify-center shrink-0 mt-0.5 ${
                    isUser
                      ? 'bg-blue-600 text-white'
                      : m.isError
                      ? 'bg-rose-600 text-white'
                      : 'bg-purple-600 text-white'
                  }`}
                >
                  {isUser ? <User className="w-3.5 h-3.5" /> : <Bot className="w-3.5 h-3.5" />}
                </div>

                <div
                  className={`max-w-[85%] rounded-2xl p-3 text-xs leading-relaxed ${
                    isUser
                      ? 'bg-blue-600/30 border border-blue-500/30 text-gray-100 rounded-tr-none'
                      : m.isError
                      ? 'bg-rose-950/40 border border-rose-500/30 text-rose-200 rounded-tl-none font-mono text-[11px]'
                      : 'bg-black/50 border border-white/10 text-gray-200 rounded-tl-none shadow-md'
                  }`}
                >
                  {/* Context chip on user message if present */}
                  {m.contextSummary && (
                    <span className="text-[9.5px] px-1.5 py-0.2 rounded bg-white/10 text-blue-300 block w-fit mb-1.5 font-mono">
                      {m.contextSummary}
                    </span>
                  )}

                  <div className="whitespace-pre-wrap break-words">{m.content}</div>

                  <div className="flex items-center justify-between gap-2 mt-1.5 pt-1 border-t border-white/5 text-[9.5px] text-gray-500 font-mono">
                    <span>{m.timestamp}</span>
                    {!isUser && (
                      <button
                        onClick={() => handleCopy(m.id, m.content)}
                        className="text-gray-400 hover:text-white flex items-center gap-1 transition-colors"
                        title="Copy answer"
                      >
                        {isCopied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                        <span>{isCopied ? 'Copied' : 'Copy'}</span>
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}

        {isLoading && (
          <div className="flex items-center gap-2 text-xs text-gray-400 animate-in fade-in p-2">
            <Loader2 className="w-4 h-4 animate-spin text-purple-400" />
            <span className="font-mono text-[11px]">Thinking with {currentPreset.name}...</span>
          </div>
        )}
        <div ref={chatEndRef} />
      </div>

      {/* 4. Chat Input */}
      <div className="p-3 border-t border-white/10 bg-black/40 shrink-0">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleSendMessage();
          }}
          className="flex items-end gap-2 bg-black/60 border border-white/10 rounded-xl p-1.5 focus-within:border-blue-500 transition-colors"
        >
          <textarea
            ref={inputRef}
            rows={2}
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSendMessage();
              }
            }}
            placeholder="Ask about this codebase... (Enter to send, Shift+Enter for newline)"
            className="flex-1 bg-transparent text-xs text-gray-200 placeholder:text-gray-500 focus:outline-none resize-none px-2 py-1 leading-relaxed"
          />
          <button
            type="submit"
            disabled={isLoading || !inputText.trim()}
            className="p-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white transition-all disabled:opacity-30 disabled:pointer-events-none active:scale-95 shrink-0 shadow-md"
            title="Send Question"
          >
            {isLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
          </button>
        </form>
      </div>
    </div>
  );
}
