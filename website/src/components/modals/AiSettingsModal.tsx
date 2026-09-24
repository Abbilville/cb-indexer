'use client';

import React, { useState, useEffect } from 'react';
import {
  AiConfig,
  AiProvider,
  PROVIDER_PRESETS,
} from '../../types/ai';
import { AiService } from '../../services/ai';
import { useToast } from '../ui/Toast';
import {
  X,
  KeyRound,
  Sparkles,
  ExternalLink,
  Eye,
  EyeOff,
  Sliders,
  Check,
  Zap,
  Globe,
  HardDrive,
  Cpu,
} from 'lucide-react';

interface AiSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (config: AiConfig) => void;
}

export function AiSettingsModal({ isOpen, onClose, onSave }: AiSettingsModalProps) {
  const { showToast } = useToast();

  const [currentConfig, setCurrentConfig] = useState<AiConfig>(AiService.loadConfig);
  const [showKey, setShowKey] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setCurrentConfig(AiService.loadConfig());
      setShowKey(false);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const activePreset = PROVIDER_PRESETS[currentConfig.provider] || PROVIDER_PRESETS.gemini;

  const handleSelectProvider = (providerId: AiProvider) => {
    const preset = PROVIDER_PRESETS[providerId];
    setCurrentConfig((prev) => ({
      ...prev,
      provider: providerId,
      model: preset.defaultModel,
      baseUrl: preset.defaultBaseUrl || '',
    }));
  };

  const handleSave = () => {
    if (activePreset.requiresKey && !currentConfig.apiKey.trim()) {
      showToast(`Please enter an API key for ${activePreset.name}`, 'warn');
      return;
    }
    AiService.saveConfig(currentConfig);
    showToast(`AI settings updated (${activePreset.name} • ${currentConfig.model})`, 'success');
    onSave(currentConfig);
    onClose();
  };

  const providersList = Object.values(PROVIDER_PRESETS);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-200">
      <div className="relative w-full max-w-2xl max-h-[90vh] flex flex-col bg-gray-900/95 border border-white/10 rounded-2xl shadow-2xl backdrop-blur-xl overflow-hidden">
        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10 shrink-0">
          <div className="flex items-center gap-2.5 text-blue-400 font-semibold text-base">
            <Sparkles className="w-5 h-5 text-blue-400" />
            <span>AI Provider & Model Settings</span>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white p-1 rounded-lg hover:bg-white/5 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Scrollable Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
          {/* 1. Step 1: Select Provider */}
          <div>
            <label className="text-xs font-semibold uppercase tracking-wider text-gray-300 block mb-2.5">
              1. Choose Model Provider
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              {providersList.map((preset) => {
                const isSelected = currentConfig.provider === preset.id;
                return (
                  <div
                    key={preset.id}
                    onClick={() => handleSelectProvider(preset.id)}
                    className={`p-3 rounded-xl border text-left cursor-pointer transition-all flex flex-col justify-between ${
                      isSelected
                        ? 'bg-blue-600/20 border-blue-500/50 text-white shadow-lg shadow-blue-500/10'
                        : 'bg-black/30 border-white/10 text-gray-300 hover:bg-white/5 hover:border-white/20'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-1 mb-1">
                      <span className="font-bold text-xs truncate">{preset.name}</span>
                      <span
                        className={`text-[9px] px-1.5 py-0.2 rounded-full font-mono shrink-0 border ${
                          preset.category === 'Open Source'
                            ? 'bg-purple-500/10 border-purple-500/20 text-purple-300'
                            : preset.category === 'Local'
                            ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-300'
                            : preset.category === 'Aggregator'
                            ? 'bg-amber-500/10 border-amber-500/20 text-amber-300'
                            : 'bg-blue-500/10 border-blue-500/20 text-blue-300'
                        }`}
                      >
                        {preset.category}
                      </span>
                    </div>
                    <p className="text-[10.5px] text-gray-400 line-clamp-2 leading-relaxed">
                      {preset.description}
                    </p>
                  </div>
                );
              })}
            </div>
          </div>

          {/* 2. Step 2: API Key Configuration */}
          <div className="space-y-1.5 pt-1">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold uppercase tracking-wider text-gray-300 flex items-center gap-1.5">
                <KeyRound className="w-3.5 h-3.5 text-blue-400" />
                <span>2. {activePreset.name} API Key</span>
              </label>
              {activePreset.apiKeyDocsUrl && (
                <a
                  href={activePreset.apiKeyDocsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[11px] text-blue-400 hover:text-blue-300 inline-flex items-center gap-1 transition-colors"
                >
                  <span>Get API key</span>
                  <ExternalLink className="w-3 h-3" />
                </a>
              )}
            </div>

            {activePreset.requiresKey ? (
              <div className="relative">
                <input
                  type={showKey ? 'text' : 'password'}
                  value={currentConfig.apiKey}
                  onChange={(e) => setCurrentConfig((prev) => ({ ...prev, apiKey: e.target.value }))}
                  placeholder={activePreset.placeholderKey}
                  className="w-full pl-3.5 pr-10 py-2.5 bg-black/50 border border-white/10 rounded-xl text-sm text-gray-100 placeholder:text-gray-600 focus:outline-none focus:border-blue-500 font-mono"
                />
                <button
                  type="button"
                  onClick={() => setShowKey(!showKey)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white p-1"
                >
                  {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            ) : (
              <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-xs text-emerald-300 flex items-center gap-2">
                <Check className="w-4 h-4 text-emerald-400 shrink-0" />
                <span>No API key required for {activePreset.name}. Uses local inference directly.</span>
              </div>
            )}
            <span className="text-[10px] text-gray-500 block">
              Stored client-side in browser storage. Never transferred or logged.
            </span>
          </div>

          {/* 3. Step 3: Model Selection (Populated based on chosen provider) */}
          <div className="space-y-1.5 pt-1">
            <label className="text-xs font-semibold uppercase tracking-wider text-gray-300 flex items-center gap-1.5">
              <Cpu className="w-3.5 h-3.5 text-purple-400" />
              <span>3. Model Selection ({activePreset.name})</span>
            </label>

            <select
              value={currentConfig.model}
              onChange={(e) => setCurrentConfig((prev) => ({ ...prev, model: e.target.value }))}
              className="w-full px-3.5 py-2.5 bg-black/50 border border-white/10 rounded-xl text-sm text-gray-100 font-mono focus:outline-none focus:border-blue-500 cursor-pointer"
            >
              {activePreset.models.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>

            <div className="pt-1">
              <input
                type="text"
                value={currentConfig.model}
                onChange={(e) => setCurrentConfig((prev) => ({ ...prev, model: e.target.value }))}
                placeholder="Or specify custom model ID..."
                className="w-full px-3 py-1.5 bg-black/30 border border-white/5 rounded-lg text-xs text-gray-300 font-mono focus:outline-none focus:border-blue-500"
              />
            </div>
          </div>

          {/* 4. Custom Endpoint URL (for Ollama, Custom, or Proxies) */}
          {(currentConfig.provider === 'ollama' ||
            currentConfig.provider === 'custom' ||
            currentConfig.baseUrl) && (
            <div className="space-y-1.5 pt-1">
              <label className="text-xs font-semibold uppercase tracking-wider text-gray-300 flex items-center gap-1.5">
                <Globe className="w-3.5 h-3.5 text-cyan-400" />
                <span>Base URL Endpoint</span>
              </label>
              <input
                type="text"
                value={currentConfig.baseUrl || ''}
                onChange={(e) => setCurrentConfig((prev) => ({ ...prev, baseUrl: e.target.value }))}
                placeholder={activePreset.defaultBaseUrl || 'http://localhost:11434/v1'}
                className="w-full px-3.5 py-2 bg-black/50 border border-white/10 rounded-xl text-xs text-gray-100 font-mono focus:outline-none focus:border-blue-500"
              />
            </div>
          )}

          {/* 5. Context Inclusion Toggles */}
          <div className="pt-3 border-t border-white/10 space-y-2">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-400 block">
              Architectural Context Grounding
            </span>
            <div className="flex flex-col sm:flex-row gap-3 sm:gap-6">
              <label className="flex items-center gap-2 cursor-pointer select-none text-xs text-gray-300">
                <input
                  type="checkbox"
                  checked={currentConfig.includeGraphContext ?? true}
                  onChange={(e) =>
                    setCurrentConfig((prev) => ({ ...prev, includeGraphContext: e.target.checked }))
                  }
                  className="w-4 h-4 rounded accent-blue-500 bg-black/50"
                />
                <span>Include Knowledge Graph topology metrics</span>
              </label>

              <label className="flex items-center gap-2 cursor-pointer select-none text-xs text-gray-300">
                <input
                  type="checkbox"
                  checked={currentConfig.includeNodeContext ?? true}
                  onChange={(e) =>
                    setCurrentConfig((prev) => ({ ...prev, includeNodeContext: e.target.checked }))
                  }
                  className="w-4 h-4 rounded accent-blue-500 bg-black/50"
                />
                <span>Include selected AST node code context</span>
              </label>
            </div>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="flex items-center justify-between px-6 py-3.5 border-t border-white/10 bg-black/40 shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-xs font-medium text-gray-300 hover:text-white bg-white/5 hover:bg-white/10 rounded-xl transition-all"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            className="inline-flex items-center gap-2 px-5 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-500 active:scale-95 rounded-xl shadow-lg shadow-blue-600/25 transition-all"
          >
            <Check className="w-4 h-4" />
            <span>Save & Apply Settings</span>
          </button>
        </div>
      </div>
    </div>
  );
}
