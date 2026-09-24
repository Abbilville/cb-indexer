'use client';

import React, { useState, useEffect } from 'react';
import { KeyRound, X, CheckCircle2, AlertTriangle, Eye, EyeOff, ShieldCheck, ShieldAlert, Loader2 } from 'lucide-react';
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
  const [showPassword, setShowPassword] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [serverAuthInfo, setServerAuthInfo] = useState<{
    authRequired: boolean;
    authenticated: boolean;
    message: string;
  } | null>(null);

  useEffect(() => {
    if (isOpen) {
      const current = ApiService.getAuthToken();
      setTokenInput(current);
      setIsVerifying(true);
      ApiService.verifyAuth(current)
        .then((res) => {
          setServerAuthInfo({
            authRequired: res.auth_required,
            authenticated: res.authenticated,
            message: res.message,
          });
        })
        .finally(() => {
          setIsVerifying(false);
        });
    }
  }, [isOpen]);

  const handleSave = async () => {
    try {
      setIsVerifying(true);
      const verification = await ApiService.verifyAuth(tokenInput);
      ApiService.setAuthToken(tokenInput);

      if (verification.auth_required && !verification.authenticated) {
        showToast('Warning: Token was rejected by the server (Invalid token)', 'error');
      } else if (verification.auth_required && verification.authenticated) {
        showToast('API Auth Token verified and saved', 'success');
      } else {
        showToast(tokenInput.trim() ? 'Token saved (Server does not require auth)' : 'Token cleared', 'info');
      }
      onAuthChange();
      onClose();
    } catch {
      ApiService.setAuthToken(tokenInput);
      showToast('Token saved', 'info');
      onAuthChange();
      onClose();
    } finally {
      setIsVerifying(false);
    }
  };

  if (!isOpen) return null;
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
        <div className="mb-4">
          {serverAuthInfo ? (
            serverAuthInfo.authRequired ? (
              serverAuthInfo.authenticated ? (
                <div className="flex items-start gap-2.5 p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-xs text-emerald-300">
                  <ShieldCheck className="w-4 h-4 shrink-0 text-emerald-400 mt-0.5" />
                  <div>
                    <div className="font-semibold text-emerald-200">Server Auth: Required & Verified</div>
                    <div className="text-emerald-300/80 text-[11px] mt-0.5">
                      Server has authentication enabled (<code className="font-mono">OSS_INDEXER_AUTH_TOKEN</code>) and your current token is valid.
                    </div>
                  </div>
                </div>
              ) : (
                <div className="flex items-start gap-2.5 p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-xs text-rose-300">
                  <ShieldAlert className="w-4 h-4 shrink-0 text-rose-400 mt-0.5" />
                  <div>
                    <div className="font-semibold text-rose-200">Server Auth: Required (Not Authenticated)</div>
                    <div className="text-rose-300/80 text-[11px] mt-0.5">
                      Server has authentication enabled. Please enter the matching secret token from your server&apos;s <code className="font-mono text-rose-200">.env</code> file.
                    </div>
                  </div>
                </div>
              )
            ) : (
              <div className="flex items-start gap-2.5 p-3 rounded-xl bg-blue-500/10 border border-blue-500/20 text-xs text-blue-300">
                <CheckCircle2 className="w-4 h-4 shrink-0 text-blue-400 mt-0.5" />
                <div>
                  <div className="font-semibold text-blue-200">Server Auth: Disabled (Open Mode)</div>
                  <div className="text-blue-300/80 text-[11px] mt-0.5">
                    The backend server does not require an auth token for local development requests.
                  </div>
                </div>
              </div>
            )
          ) : (
            <div className="p-3 rounded-xl bg-white/5 border border-white/10 text-xs text-gray-400 flex items-center gap-2">
              <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-400" />
              <span>Checking server auth status...</span>
            </div>
          )}
        </div>

        <div className="space-y-2 mb-6">
          <label className="text-xs font-medium text-gray-300">Secret Auth Token</label>
          <div className="relative">
            <input
              type={showPassword ? 'text' : 'password'}
              value={tokenInput}
              onChange={(e) => setTokenInput(e.target.value)}
              placeholder="Enter server auth token..."
              className="w-full pl-3.5 pr-10 py-2.5 bg-black/50 border border-white/10 rounded-xl text-sm text-gray-100 placeholder:text-gray-600 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/50 font-mono"
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white p-1"
              title={showPassword ? 'Hide token' : 'Show token'}
            >
              {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
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
