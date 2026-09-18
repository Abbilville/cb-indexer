'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  AiConfig,
  ChatMessage,
  AiProvider,
  PROVIDER_PRESETS,
  DetectedCredential,
  GitHubDeviceStartResponse,
} from '../../types/ai';
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
  Layers,
  Zap,
  KeyRound,
  ShieldCheck,
  X,
  RefreshCw,
  ExternalLink,
} from 'lucide-react';

interface AstAskTabProps {
  graphData: GraphPayload | null;
  selectedNode: GraphNode | null;
  onClearSelectedNode: () => void;
}

interface DeviceOAuthState {
  active: boolean;
  userCode?: string;
  verificationUri?: string;
  deviceCode?: string;
  isPolling?: boolean;
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
  const [showSessionToken, setShowSessionToken] = useState(false);
  const [detectedCreds, setDetectedCreds] = useState<DetectedCredential[]>([]);
  const [isLoadingCreds, setIsLoadingCreds] = useState(false);

  // Model Auto-Detection
  const [autoDetectedModels, setAutoDetectedModels] = useState<string[]>([]);
  const [isLoadingModels, setIsLoadingModels] = useState(false);

  // GitHub Device OAuth Flow
  const [deviceOAuth, setDeviceOAuth] = useState<DeviceOAuthState>({ active: false });
  const [hasCopiedCode, setHasCopiedCode] = useState(false);

  // Chat
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputText, setInputText] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const chatEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const pollTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Auto-scroll chat to bottom
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading]);

  // Clean up poll timer on unmount
  useEffect(() => {
    return () => {
      clearInterval(pollTimerRef.current as unknown as number);
    };
  }, []);

  // Fetch auto-detected models from the provider endpoint
  const loadModels = useCallback(async (provider: string, apiKey?: string, baseUrl?: string) => {
    setIsLoadingModels(true);
    try {
      const res = await AiService.fetchProviderModels(provider, apiKey, baseUrl);
      setAutoDetectedModels(res.models);
      if (res.defaultModel) {
        setConfig((prev) => {
          if (!prev.model || !res.models.includes(prev.model)) {
            const next = { ...prev, model: res.defaultModel };
            AiService.saveConfig(next);
            return next;
          }
          return prev;
        });
      }
    } finally {
      setIsLoadingModels(false);
    }
  }, []);

  // Load detected credentials from backend environment & CLI tools
  useEffect(() => {
    let isMounted = true;
    const fetchCreds = async () => {
      setIsLoadingCreds(true);
      try {
        const creds = await AiService.fetchDetectedCredentials();
        if (isMounted) {
          setDetectedCreds(creds);
        }
      } finally {
        if (isMounted) setIsLoadingCreds(false);
      }
    };
    fetchCreds();
    return () => {
      isMounted = false;
    };
  }, []);

  // Auto-detect models when provider or key changes
  useEffect(() => {
    const key = config.authMethod === 'session' ? config.sessionToken : config.apiKey;
    loadModels(config.provider, key, config.baseUrl);
  }, [config.provider, config.apiKey, config.sessionToken, config.baseUrl, config.authMethod, loadModels]);

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

  const handleApplyDetected = (cred: DetectedCredential) => {
    handleProviderChange(cred.provider);
    updateConfig({
      provider: cred.provider,
      authMethod: 'harness',
    });
    showToast(`Connected to ${cred.name} (${cred.source})`, 'success');
  };

  // Start GitHub Copilot / Codex Device Code flow
  const handleStartGitHubDeviceFlow = async () => {
    try {
      setDeviceOAuth({ active: true, isPolling: false });
      const res: GitHubDeviceStartResponse = await AiService.startGitHubDeviceFlow();
      setDeviceOAuth({
        active: true,
        userCode: res.user_code,
        verificationUri: res.verification_uri,
        deviceCode: res.device_code,
        isPolling: true,
      });

      clearInterval(pollTimerRef.current as unknown as number);

      const pollInterval = (res.interval || 5) * 1000;
      pollTimerRef.current = setInterval(async () => {
        try {
          const pollRes = await AiService.pollGitHubDeviceFlow(res.device_code);
          if (pollRes.access_token) {
            clearInterval(pollTimerRef.current as unknown as number);
            setDeviceOAuth({ active: false });
            updateConfig({
              provider: 'openai',
              authMethod: 'session',
              sessionToken: pollRes.access_token,
              model: 'gpt-4o',
            });
            showToast('✓ Successfully logged in with GitHub Copilot!', 'success');
            loadModels('openai', pollRes.access_token);
          } else if (pollRes.error && pollRes.error !== 'authorization_pending') {
            clearInterval(pollTimerRef.current as unknown as number);
            setDeviceOAuth({ active: false });
            showToast(`GitHub login: ${pollRes.error}`, 'error');
          }
        } catch {
          // Poll retry
        }
      }, pollInterval);
    } catch (err: unknown) {
      setDeviceOAuth({ active: false });
      const msg = err instanceof Error ? err.message : 'Failed to start GitHub login';
      showToast(msg, 'error');
    }
  };

  const handleCopyUserCode = (code: string) => {
    navigator.clipboard.writeText(code);
    setHasCopiedCode(true);
    setTimeout(() => setHasCopiedCode(false), 3000);
    showToast('Copied code to clipboard!', 'info');
  };

  const handleSendMessage = async (customPrompt?: string) => {
    const textToSend = customPrompt || inputText.trim();
    if (!textToSend || isLoading) return;

    if (config.authMethod === 'api_key' && config.provider !== 'custom' && !config.apiKey.trim()) {
      setIsSettingsOpen(true);
      showToast(`Please enter your ${PROVIDER_PRESETS[config.provider].name} API Key`, 'warn');
      return;
    }

    if (config.authMethod === 'session' && !config.sessionToken?.trim()) {
      setIsSettingsOpen(true);
      showToast(`Please paste your Web Subscription Session Token or click Login with GitHub`, 'warn');
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
        content: `Error: ${errorMsg}\n\nTip: You can switch between "Harness Auto-Detect", "Web Subscription", or "API Key" in the settings panel above.`,
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
  const modelsToDisplay = autoDetectedModels.length > 0 ? autoDetectedModels : currentPreset.models;

  return (
    <div className="flex flex-col h-full overflow-hidden text-xs bg-gray-950/60">
      {/* 1. Header & Provider Status Bar */}
      <div className="p-3 border-b border-white/10 bg-black/30 shrink-0">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <div className="p-1.5 rounded-lg bg-blue-500/10 border border-blue-500/20 text-blue-400">
              <Bot className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="font-bold text-gray-200 block truncate leading-tight">
                  {currentPreset.name}
                </span>
                <span
                  className={`text-[9px] px-1.5 py-0.2 rounded-full font-mono font-semibold border ${
                    config.authMethod === 'harness'
                      ? 'bg-purple-500/15 border-purple-500/30 text-purple-300'
                      : config.authMethod === 'session'
                      ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300'
                      : 'bg-blue-500/15 border-blue-500/30 text-blue-300'
                  }`}
                >
                  {config.authMethod === 'harness'
                    ? 'Harness'
                    : config.authMethod === 'session'
                    ? 'OAuth/Sub'
                    : 'API Key'}
                </span>
              </div>
              <span className="text-[10px] text-gray-400 font-mono block truncate mt-0.5">
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
              title="Configure AI Authentication & Provider"
            >
              <Settings className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Expandable Settings Drawer */}
        {isSettingsOpen && (
          <div className="mt-3 pt-3 border-t border-white/10 space-y-3.5 animate-in fade-in slide-in-from-top-2">
            {/* Authentication Mode Switcher */}
            <div className="space-y-1.5">
              <label className="text-[10px] uppercase font-semibold text-gray-400 tracking-wider block">
                Authentication Mode
              </label>
              <div className="grid grid-cols-3 gap-1 bg-black/50 p-1 rounded-xl border border-white/10">
                <button
                  onClick={() => updateConfig({ authMethod: 'harness' })}
                  className={`py-1.5 px-1 rounded-lg text-[10px] font-semibold flex flex-col items-center gap-1 transition-all ${
                    config.authMethod === 'harness'
                      ? 'bg-purple-600 text-white shadow-md'
                      : 'text-gray-400 hover:text-white'
                  }`}
                  title="Auto-detect from Oh My Pi, active CLI session, or environment"
                >
                  <Zap className="w-3 h-3" />
                  <span>Harness CLI</span>
                </button>
                <button
                  onClick={() => updateConfig({ authMethod: 'session' })}
                  className={`py-1.5 px-1 rounded-lg text-[10px] font-semibold flex flex-col items-center gap-1 transition-all ${
                    config.authMethod === 'session'
                      ? 'bg-emerald-600 text-white shadow-md'
                      : 'text-gray-400 hover:text-white'
                  }`}
                  title="OAuth login or Web subscription token"
                >
                  <ShieldCheck className="w-3 h-3" />
                  <span>OAuth / Sub</span>
                </button>
                <button
                  onClick={() => updateConfig({ authMethod: 'api_key' })}
                  className={`py-1.5 px-1 rounded-lg text-[10px] font-semibold flex flex-col items-center gap-1 transition-all ${
                    config.authMethod === 'api_key'
                      ? 'bg-blue-600 text-white shadow-md'
                      : 'text-gray-400 hover:text-white'
                  }`}
                  title="Direct developer console API key"
                >
                  <KeyRound className="w-3 h-3" />
                  <span>API Key</span>
                </button>
              </div>
            </div>

            {/* Mode 1: Harness / Auto-Detected Credentials */}
            {config.authMethod === 'harness' && (
              <div className="space-y-2 p-2.5 rounded-xl bg-purple-950/25 border border-purple-500/20">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-bold text-purple-300 uppercase tracking-wider flex items-center gap-1">
                    <Zap className="w-3 h-3 text-purple-400" />
                    Detected System Credentials
                  </span>
                  {isLoadingCreds && <Loader2 className="w-3 h-3 animate-spin text-purple-400" />}
                </div>

                <div className="space-y-1 max-h-32 overflow-y-auto pr-0.5">
                  {detectedCreds.length === 0 ? (
                    <div className="py-2 text-center text-gray-500 text-[10px]">
                      No active CLI sessions detected. You can use OAuth or API Key mode.
                    </div>
                  ) : (
                    detectedCreds.map((cred, idx) => (
                      <div
                        key={`${cred.provider}-${idx}`}
                        onClick={() => handleApplyDetected(cred)}
                        className={`p-1.5 rounded-lg border text-[10.5px] flex items-center justify-between gap-1.5 cursor-pointer transition-all ${
                          config.provider === cred.provider
                            ? 'bg-purple-600/20 border-purple-500/40 text-purple-200'
                            : 'bg-black/30 border-white/5 text-gray-300 hover:bg-white/5'
                        }`}
                      >
                        <div className="min-w-0">
                          <span className="font-bold block truncate">{cred.name}</span>
                          <span className="text-[9px] text-gray-400 font-mono block truncate">{cred.detail}</span>
                        </div>
                        <span className="text-[9px] px-1.5 py-0.2 rounded bg-white/10 text-emerald-300 shrink-0">
                          Connect
                        </span>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}

            {/* Mode 2: OAuth / Web Subscription Session Token */}
            {config.authMethod === 'session' && (
              <div className="space-y-2.5 p-2.5 rounded-xl bg-emerald-950/25 border border-emerald-500/20">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] uppercase font-bold text-emerald-300 tracking-wider">
                    OAuth & Subscription Login
                  </span>
                </div>

                {/* 1-Click GitHub Copilot Device Flow Button */}
                <button
                  type="button"
                  onClick={handleStartGitHubDeviceFlow}
                  className="w-full flex items-center justify-center gap-2 py-2 px-3 rounded-xl bg-gray-900 hover:bg-black border border-white/15 text-white font-semibold text-xs shadow-md transition-all active:scale-95"
                >
                  <svg className="w-4 h-4 text-white" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
                  </svg>
                  <span>1-Click Login with GitHub (Copilot)</span>
                </button>

                {/* Device Code Verification Popup / Box */}
                {deviceOAuth.active && (
                  <div className="p-3 rounded-xl bg-black/90 border border-emerald-500/40 space-y-2 animate-in fade-in">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] text-emerald-300 font-bold uppercase">Device Code Verification</span>
                      <button onClick={() => setDeviceOAuth({ active: false })} className="text-gray-400 hover:text-white">
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    <div className="flex items-center justify-between p-2 rounded-lg bg-emerald-950/40 border border-emerald-500/30">
                      <span className="font-mono text-base font-bold text-white tracking-widest">
                        {deviceOAuth.userCode || 'Generating...'}
                      </span>
                      {deviceOAuth.userCode && (
                        <button
                          onClick={() => handleCopyUserCode(deviceOAuth.userCode!)}
                          className="px-2 py-1 text-[10px] font-semibold text-emerald-200 bg-emerald-600/30 rounded border border-emerald-500/40 hover:bg-emerald-600/50"
                        >
                          {hasCopiedCode ? 'Copied!' : 'Copy Code'}
                        </button>
                      )}
                    </div>

                    <a
                      href={deviceOAuth.verificationUri || 'https://github.com/login/device'}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="w-full inline-flex items-center justify-center gap-1.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs transition-all"
                    >
                      <span>Open GitHub Authorization Page</span>
                      <ExternalLink className="w-3 h-3" />
                    </a>

                    {deviceOAuth.isPolling && (
                      <div className="flex items-center justify-center gap-1.5 text-[10px] text-gray-400 pt-1">
                        <Loader2 className="w-3 h-3 animate-spin text-emerald-400" />
                        <span>Waiting for your authorization on GitHub...</span>
                      </div>
                    )}
                  </div>
                )}

                {/* Direct Session Token Input */}
                <div className="space-y-1">
                  <label className="text-[10px] uppercase font-semibold text-gray-400 tracking-wider block">
                    Or Paste Web Subscription Session / Access Token
                  </label>
                  <div className="relative">
                    <input
                      type={showSessionToken ? 'text' : 'password'}
                      value={config.sessionToken || ''}
                      onChange={(e) => updateConfig({ sessionToken: e.target.value })}
                      placeholder="Paste ChatGPT Plus / Claude Pro session or Bearer token..."
                      className="w-full pl-2.5 pr-8 py-1.5 bg-black/60 border border-emerald-500/30 rounded-xl text-xs text-gray-200 font-mono focus:outline-none focus:border-emerald-400"
                    />
                    <button
                      type="button"
                      onClick={() => setShowSessionToken(!showSessionToken)}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white"
                    >
                      {showSessionToken ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Mode 3: Developer API Key */}
            {config.authMethod === 'api_key' && (
              <div className="space-y-1">
                <label className="text-[10px] uppercase font-semibold text-gray-400 tracking-wider flex items-center justify-between">
                  <span>Developer API Key</span>
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
            )}

            {/* Provider Selector */}
            <div className="space-y-1">
              <label className="text-[10px] uppercase font-semibold text-gray-400 tracking-wider">
                Model Provider
              </label>
              <select
                value={config.provider}
                onChange={(e) => handleProviderChange(e.target.value as AiProvider)}
                className="w-full pl-2.5 pr-7 py-1.5 bg-black/60 border border-white/10 rounded-xl text-xs text-gray-200 focus:outline-none focus:border-blue-500 cursor-pointer"
              >
                <option value="gemini">Google Gemini (Gemini 2.5 Flash, 1.5 Pro)</option>
                <option value="claude">Anthropic Claude (3.5 Sonnet, 3.5 Haiku)</option>
                <option value="openai">OpenAI / Codex / Copilot (GPT-4o, o1, mini)</option>
                <option value="custom">Custom / Oh My Pi (Ollama, DeepSeek, Groq)</option>
              </select>
            </div>

            {/* Auto-Detected Model Selector */}
            <div className="space-y-1">
              <div className="flex items-center justify-between text-[10px]">
                <span className="uppercase font-semibold text-gray-400 tracking-wider">
                  Model Selection
                </span>
                <div className="flex items-center gap-1.5">
                  {isLoadingModels ? (
                    <span className="inline-flex items-center gap-1 text-blue-400">
                      <Loader2 className="w-2.5 h-2.5 animate-spin" />
                      <span>Probing models...</span>
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        const key = config.authMethod === 'session' ? config.sessionToken : config.apiKey;
                        loadModels(config.provider, key, config.baseUrl);
                      }}
                      className="text-gray-400 hover:text-blue-300 flex items-center gap-0.5"
                      title="Re-probe provider models"
                    >
                      <RefreshCw className="w-2.5 h-2.5" />
                      <span>{autoDetectedModels.length > 0 ? `${autoDetectedModels.length} detected` : 'Detect'}</span>
                    </button>
                  )}
                </div>
              </div>

              {/* Model Dropdown populated dynamically */}
              <div className="relative">
                <select
                  value={config.model}
                  onChange={(e) => updateConfig({ model: e.target.value })}
                  className="w-full pl-2.5 pr-7 py-1.5 bg-black/60 border border-white/10 rounded-xl text-xs text-gray-200 font-mono focus:outline-none focus:border-blue-500 cursor-pointer truncate"
                >
                  {modelsToDisplay.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </div>

              {/* Custom model override */}
              <input
                type="text"
                value={config.model}
                onChange={(e) => updateConfig({ model: e.target.value })}
                placeholder="Or type custom model name..."
                className="w-full px-2.5 py-1 bg-black/40 border border-white/5 rounded-lg text-[10.5px] text-gray-300 font-mono focus:outline-none focus:border-blue-500"
              />
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
