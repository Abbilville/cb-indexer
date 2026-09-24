'use client';

import React, { useState, useEffect, useRef } from 'react';
import {
  AiConfig,
  ChatMessage,
  PROVIDER_PRESETS,
} from '../../types/ai';
import { GraphNode, GraphPayload } from '../../types/graph';
import { AiService } from '../../services/ai';
import { useToast } from '../ui/Toast';
import { AiSettingsModal } from '../modals/AiSettingsModal';
import { MarkdownRenderer } from '../ui/MarkdownRenderer';
import {
  Send,
  Settings,
  Bot,
  User,
  Trash2,
  Sparkles,
  Loader2,
  Check,
  Copy,
  Layers,
  X,
  Compass,
  GitFork,
  ShieldAlert,
  HelpCircle,
  Cpu,
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

  // Chat conversation state
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputText, setInputText] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [streamingText, setStreamingText] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const chatEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Auto-scroll chat to bottom
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingText, isLoading]);

  const handleSendMessage = async (promptOverride?: string) => {
    const textToSend = (promptOverride || inputText).trim();
    if (!textToSend || isLoading) return;

    const preset = PROVIDER_PRESETS[config.provider] || PROVIDER_PRESETS.gemini;
    if (preset.requiresKey && !config.apiKey.trim()) {
      setIsSettingsOpen(true);
      showToast(`Please enter your ${preset.name} API Key to start chatting`, 'warn');
      return;
    }

    const userMessage: ChatMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: textToSend,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      contextSummary: selectedNode ? `${selectedNode.name} (${selectedNode.label})` : undefined,
    };

    const newHistory = [...messages, userMessage];
    setMessages(newHistory);
    setInputText('');
    setIsLoading(true);
    setStreamingText('');

    let accumulated = '';
    try {
      await AiService.sendMessageStream(
        config,
        newHistory,
        graphData,
        selectedNode,
        (chunk: string) => {
          accumulated += chunk;
          setStreamingText(accumulated);
        }
      );

      const assistantMessage: ChatMessage = {
        id: `ai-${Date.now()}`,
        role: 'assistant',
        content: accumulated,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      };
      setMessages((prev) => [...prev, assistantMessage]);
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to query AI assistant';
      const errorMessage: ChatMessage = {
        id: `err-${Date.now()}`,
        role: 'assistant',
        content: `Error: ${errorMsg}\n\nTip: Click the Provider pill above to check your API key or endpoint settings.`,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        isError: true,
      };
      setMessages((prev) => [...prev, errorMessage]);
      showToast(errorMsg, 'error');
    } finally {
      setStreamingText(null);
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
    <div className="flex flex-col h-full overflow-hidden text-xs bg-gray-950/60 select-text selection:bg-blue-500/30 selection:text-white">
      {/* 1. Header & Provider Selector Pill */}
      <div className="p-3 border-b border-white/10 bg-black/40 shrink-0">
        <div className="flex items-center justify-between gap-2">
          {/* Provider Pill Button (Click to open settings modal) */}
          <button
            onClick={() => setIsSettingsOpen(true)}
            className="flex items-center gap-2 p-1.5 pr-3 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 hover:border-blue-500/40 transition-all text-left group min-w-0"
            title="Configure AI Provider and Model"
          >
            <div className="p-1.5 rounded-lg bg-blue-500/10 border border-blue-500/20 text-blue-400 group-hover:bg-blue-500/20 transition-colors">
              <Bot className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="font-bold text-gray-200 group-hover:text-blue-300 transition-colors truncate block text-xs">
                  {currentPreset.name}
                </span>
                <span
                  className={`text-[9px] px-1.5 py-0.2 rounded-full font-mono border ${
                    currentPreset.category === 'Open Source'
                      ? 'bg-purple-500/10 border-purple-500/30 text-purple-300'
                      : currentPreset.category === 'Local'
                      ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                      : 'bg-blue-500/10 border-blue-500/30 text-blue-300'
                  }`}
                >
                  {currentPreset.category}
                </span>
              </div>
              <span className="text-[10px] text-gray-400 font-mono block truncate mt-0.5">
                {config.model}
              </span>
            </div>
          </button>

          {/* Action buttons on header right */}
          <div className="flex items-center gap-1 shrink-0">
            {messages.length > 0 && (
              <button
                onClick={() => setMessages([])}
                className="p-2 rounded-xl text-gray-400 hover:text-rose-400 hover:bg-white/5 transition-colors"
                title="Clear Conversation"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            )}
            <button
              onClick={() => setIsSettingsOpen(true)}
              className="p-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-gray-300 hover:text-white transition-colors"
              title="Open AI Settings"
            >
              <Settings className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* 2. Target Symbol Context Bar (if node selected) */}
      {selectedNode && (
        <div className="px-3 py-1.5 bg-blue-950/40 border-b border-blue-500/20 flex items-center justify-between gap-2 shrink-0 animate-in fade-in">
          <div className="flex items-center gap-1.5 min-w-0">
            <Layers className="w-3.5 h-3.5 text-blue-400 shrink-0" />
            <span className="text-[11px] text-blue-300 truncate">
              Active Context: <strong className="text-white font-mono">{selectedNode.name}</strong>{' '}
              <span className="text-blue-400 text-[10px]">({selectedNode.label})</span>
            </span>
          </div>
          <button
            onClick={onClearSelectedNode}
            className="text-gray-400 hover:text-white p-0.5 rounded"
            title="Clear Node Context"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* 3. Message Stream / Empty State */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 select-text">
        {messages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center p-2 space-y-4 text-gray-400">
            <div className="p-3.5 rounded-2xl bg-gradient-to-br from-blue-500/20 to-indigo-600/20 border border-blue-500/30 text-blue-400 shadow-xl shadow-blue-500/10">
              <Sparkles className="w-7 h-7 text-blue-400" />
            </div>

            <div>
              <h3 className="font-bold text-gray-100 text-sm mb-1">
                Architecture AI Intelligence
              </h3>
              <p className="text-xs text-gray-400 max-w-xs leading-relaxed">
                Query repository topologies, microservice communications, dependencies, and code patterns grounded in your knowledge graph.
              </p>
            </div>

            {/* Suggested Starter Prompts */}
            <div className="w-full space-y-2 pt-1 text-left max-w-sm">
              <span className="text-[10px] uppercase font-semibold text-gray-500 tracking-wider block px-1">
                Suggested Prompts
              </span>

              <button
                onClick={() =>
                  handleSendMessage('Explain the overall repository architecture, microservice topology, and tech stacks.')
                }
                className="w-full p-2.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/5 hover:border-blue-500/30 text-xs text-gray-300 text-left transition-all flex items-center gap-2.5 group"
              >
                <Compass className="w-4 h-4 text-blue-400 shrink-0 group-hover:scale-110 transition-transform" />
                <span className="truncate">Explain overall architecture and services</span>
              </button>

              <button
                onClick={() =>
                  handleSendMessage('Which services make API calls to each other or share dependencies and ports?')
                }
                className="w-full p-2.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/5 hover:border-blue-500/30 text-xs text-gray-300 text-left transition-all flex items-center gap-2.5 group"
              >
                <GitFork className="w-4 h-4 text-purple-400 shrink-0 group-hover:scale-110 transition-transform" />
                <span className="truncate">Trace inter-service API and data links</span>
              </button>

              <button
                onClick={() =>
                  handleSendMessage('Analyze potential architectural bottlenecks, circular dependencies, or single points of failure.')
                }
                className="w-full p-2.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/5 hover:border-blue-500/30 text-xs text-gray-300 text-left transition-all flex items-center gap-2.5 group"
              >
                <ShieldAlert className="w-4 h-4 text-amber-400 shrink-0 group-hover:scale-110 transition-transform" />
                <span className="truncate">Detect architectural risks and bottlenecks</span>
              </button>

              {selectedNode && (
                <button
                  onClick={() =>
                    handleSendMessage(
                      `Analyze the selected symbol "${selectedNode.name}" (${selectedNode.label}): explain its role, dependencies, and connections.`
                    )
                  }
                  className="w-full p-2.5 rounded-xl bg-blue-600/15 hover:bg-blue-600/25 border border-blue-500/30 text-xs text-blue-200 text-left transition-all flex items-center gap-2.5 group"
                >
                  <Cpu className="w-4 h-4 text-blue-300 shrink-0 group-hover:scale-110 transition-transform" />
                  <span className="truncate">Analyze selected node &quot;{selectedNode.name}&quot;</span>
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
                  className={`w-7 h-7 rounded-xl flex items-center justify-center shrink-0 mt-0.5 ${
                    isUser
                      ? 'bg-blue-600 text-white shadow-md shadow-blue-600/20'
                      : m.isError
                      ? 'bg-rose-600 text-white shadow-md shadow-rose-600/20'
                      : 'bg-gradient-to-br from-blue-600 to-indigo-700 text-white shadow-md shadow-blue-500/20'
                  }`}
                >
                  {isUser ? <User className="w-4 h-4" /> : <Bot className="w-4 h-4" />}
                </div>

                <div
                  className={`max-w-[85%] rounded-2xl p-3.5 text-xs leading-relaxed ${
                    isUser
                      ? 'bg-blue-600/25 border border-blue-500/30 text-gray-100 rounded-tr-none'
                      : m.isError
                      ? 'bg-rose-950/40 border border-rose-500/30 text-rose-200 rounded-tl-none font-mono text-[11px]'
                      : 'bg-black/50 border border-white/10 text-gray-200 rounded-tl-none shadow-md'
                  }`}
                >
                  {m.contextSummary && (
                    <span className="text-[10px] px-2 py-0.5 rounded bg-blue-500/20 border border-blue-500/30 text-blue-300 inline-block mb-2 font-mono">
                      Target: {m.contextSummary}
                    </span>
                  )}

                  {isUser || m.isError ? (
                    <div className="whitespace-pre-wrap break-words">{m.content}</div>
                  ) : (
                    <MarkdownRenderer content={m.content} />
                  )}

                  <div className="flex items-center justify-between gap-2 mt-2 pt-1.5 border-t border-white/5 text-[10px] text-gray-500 font-mono">
                    <span>{m.timestamp}</span>
                    {!isUser && (
                      <button
                        onClick={() => handleCopy(m.id, m.content)}
                        className="text-gray-400 hover:text-white flex items-center gap-1 transition-colors"
                        title="Copy answer"
                      >
                        {isCopied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                        <span>{isCopied ? 'Copied' : 'Copy'}</span>
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}

        {/* Real-time streaming response bubble */}
        {streamingText !== null && (
          <div className="flex gap-2.5 animate-in fade-in flex-row">
            <div className="w-7 h-7 rounded-xl flex items-center justify-center shrink-0 mt-0.5 bg-gradient-to-br from-blue-600 to-indigo-700 text-white shadow-md shadow-blue-500/20">
              <Bot className="w-4 h-4 animate-pulse" />
            </div>

            <div className="max-w-[85%] rounded-2xl p-3.5 text-xs leading-relaxed bg-black/50 border border-blue-500/30 text-gray-200 rounded-tl-none shadow-md">
              <MarkdownRenderer content={streamingText} />
              <span className="inline-block w-2 h-3.5 bg-blue-400 ml-1 animate-pulse align-middle" />
              <div className="text-[10px] text-gray-500 font-mono mt-2 pt-1 border-t border-white/5 flex items-center gap-1.5">
                <Loader2 className="w-3 h-3 animate-spin text-blue-400" />
                <span>Streaming from {currentPreset.name}...</span>
              </div>
            </div>
          </div>
        )}

        <div ref={chatEndRef} />
      </div>

      {/* 4. Chat Input Bar */}
      <div className="p-3 border-t border-white/10 bg-black/40 shrink-0">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleSendMessage();
          }}
          className="flex items-end gap-2 bg-black/60 border border-white/10 rounded-2xl p-2 focus-within:border-blue-500 transition-colors shadow-inner"
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
            placeholder={`Ask about codebase architecture with ${currentPreset.name}...`}
            className="flex-1 bg-transparent text-xs text-gray-200 placeholder:text-gray-500 focus:outline-none resize-none px-2 py-1 leading-relaxed"
          />
          <button
            type="submit"
            disabled={isLoading || !inputText.trim()}
            className="p-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white transition-all disabled:opacity-30 disabled:pointer-events-none active:scale-95 shrink-0 shadow-lg shadow-blue-600/25"
            title="Send Message"
          >
            {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          </button>
        </form>
      </div>

      {/* AI Settings Modal */}
      <AiSettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        onSave={(newConfig) => setConfig(newConfig)}
      />
    </div>
  );
}
