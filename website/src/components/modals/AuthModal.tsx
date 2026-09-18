'use client';

import React, { useState } from 'react';
import { KeyRound, X } from 'lucide-react';
import { ApiService } from '../../services/api';
import { useToast } from '../ui/Toast';

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAuthChange: () => void;
}

export function AuthModal({ isOpen, onClose, onAuthChange }: AuthModalProps) {
  const { showToast } = useToast();
  const [tokenInput, setTokenInput] = useState('');

  if (!isOpen) return null;

  const handleSave = () => {
    ApiService.setAuthToken(tokenInput);
    showToast(tokenInput.trim() ? 'API Auth Token saved' : 'Auth Token cleared', 'success');
    onAuthChange();
    onClose();
  };

  const handleClear = () => {
    ApiService.setAuthToken('');
    setTokenInput('');
    showToast('API Auth Token removed', 'info');
    onAuthChange();
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="relative w-full max-w-md p-6 bg-gray-900/95 border border-white/10 rounded-2xl shadow-2xl backdrop-blur-xl">
        <div className="flex items-center justify-between pb-4 mb-4 border-b border-white/10">
          <div className="flex items-center gap-2.5 text-blue-400 font-semibold text-base">
            <KeyRound className="w-5 h-5" />
            <span>API Auth Token Configuration</span>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white p-1 rounded-lg hover:bg-white/5 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <p className="text-xs text-gray-400 mb-4 leading-relaxed">
          If <code className="text-blue-300 bg-black/40 px-1.5 py-0.5 rounded font-mono">OSS_INDEXER_AUTH_TOKEN</code> is enabled on the server, enter the secret token below to authenticate dashboard requests.
        </p>

        <div className="space-y-2 mb-6">
          <label className="text-xs font-medium text-gray-300">Secret Auth Token</label>
          <input
            type="password"
            value={tokenInput}
            onChange={(e) => setTokenInput(e.target.value)}
            placeholder="Enter Bearer token..."
            className="w-full px-3.5 py-2.5 bg-black/50 border border-white/10 rounded-xl text-sm text-gray-100 placeholder:text-gray-600 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/50"
          />
        </div>

        <div className="flex items-center justify-between gap-3 pt-2">
          <button
            onClick={handleClear}
            className="px-3 py-2 text-xs font-medium text-gray-400 hover:text-rose-400 transition-colors"
          >
            Clear Token
          </button>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2 text-xs font-medium text-gray-300 hover:text-white bg-white/5 hover:bg-white/10 rounded-xl transition-all"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              className="px-4 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-500 active:scale-95 rounded-xl shadow-lg shadow-blue-600/25 transition-all"
            >
              Save & Apply
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
