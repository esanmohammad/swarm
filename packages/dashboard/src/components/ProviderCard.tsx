import { useState } from 'react';
import { CheckCircle2, XCircle, Eye, EyeOff, Play, Loader2, Server } from 'lucide-react';
import type { ProviderStatus } from '../types';

interface ProviderCardProps {
  name: string;
  status: ProviderStatus;
  onTest: () => void;
  onSaveKey: (key: string) => void;
  onSaveUrl?: (url: string) => void;
  showUrlInput?: boolean;
  showModeToggle?: boolean;
}

export function ProviderCard({
  name,
  status,
  onTest,
  onSaveKey,
  onSaveUrl,
  showUrlInput,
  showModeToggle,
}: ProviderCardProps) {
  const [apiKey, setApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [baseUrl, setBaseUrl] = useState('');
  const [testing, setTesting] = useState(false);
  const [mode, setMode] = useState<'cli' | 'api'>('cli');

  const handleTest = () => {
    setTesting(true);
    onTest();
    // Reset testing state after a timeout (server response will update status)
    setTimeout(() => setTesting(false), 5000);
  };

  const handleSaveKey = () => {
    if (apiKey.trim()) {
      onSaveKey(apiKey.trim());
      setApiKey('');
    }
  };

  const handleSaveUrl = () => {
    if (baseUrl.trim() && onSaveUrl) {
      onSaveUrl(baseUrl.trim());
      setBaseUrl('');
    }
  };

  return (
    <div className="rounded-lg bg-stone-900/40 border border-stone-800/40 p-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Server size={14} className="text-stone-500" />
          <h3 className="text-sm font-medium text-stone-300">{name}</h3>
          {status.connected ? (
            <span className="flex items-center gap-1 text-[10px] text-green-400">
              <CheckCircle2 size={10} />
              Connected
            </span>
          ) : status.configured ? (
            <span className="flex items-center gap-1 text-[10px] text-amber-400">
              <XCircle size={10} />
              Disconnected
            </span>
          ) : (
            <span className="flex items-center gap-1 text-[10px] text-stone-600">
              <XCircle size={10} />
              Not configured
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {status.modelsAvailable > 0 && (
            <span className="text-[10px] text-stone-500 bg-stone-800/60 px-1.5 py-0.5 rounded">
              {status.modelsAvailable} models
            </span>
          )}
          {status.latencyMs != null && status.connected && (
            <span className="text-[10px] text-stone-500">
              {status.latencyMs}ms
            </span>
          )}
        </div>
      </div>

      {/* Error */}
      {status.error && (
        <div className="mb-3 px-3 py-2 rounded bg-red-900/20 border border-red-800/30 text-xs text-red-400">
          {status.error}
        </div>
      )}

      {/* Mode toggle (Anthropic only) */}
      {showModeToggle && (
        <div className="mb-3">
          <label className="text-[10px] text-stone-500 block mb-1">Mode</label>
          <div className="flex gap-1">
            {(['cli', 'api'] as const).map(m => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
                  mode === m
                    ? 'bg-blue-600/30 text-blue-300 border border-blue-600/40'
                    : 'bg-stone-800/60 text-stone-500 border border-stone-700/40 hover:text-stone-400'
                }`}
              >
                {m.toUpperCase()}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* API Key */}
      <div className="mb-3">
        <label className="text-[10px] text-stone-500 block mb-1">API Key</label>
        <div className="flex gap-1.5">
          <div className="relative flex-1">
            <input
              type={showKey ? 'text' : 'password'}
              value={apiKey}
              onChange={e => setApiKey(e.target.value)}
              placeholder={status.configured ? '••••••••••••••••' : 'Enter API key...'}
              className="w-full px-3 py-1.5 rounded-md text-xs bg-stone-800/60 border border-stone-700/50 text-stone-300 placeholder:text-stone-600 outline-none focus:border-stone-600/60"
            />
            <button
              onClick={() => setShowKey(!showKey)}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-stone-500 hover:text-stone-400"
            >
              {showKey ? <EyeOff size={12} /> : <Eye size={12} />}
            </button>
          </div>
          <button
            onClick={handleSaveKey}
            disabled={!apiKey.trim()}
            className="px-3 py-1.5 rounded-md text-xs font-medium bg-blue-600 hover:bg-blue-500 text-white disabled:bg-stone-700 disabled:text-stone-500 transition-colors"
          >
            Save
          </button>
        </div>
      </div>

      {/* Base URL (Ollama, custom) */}
      {showUrlInput && (
        <div className="mb-3">
          <label className="text-[10px] text-stone-500 block mb-1">Base URL</label>
          <div className="flex gap-1.5">
            <input
              type="text"
              value={baseUrl}
              onChange={e => setBaseUrl(e.target.value)}
              placeholder={name === 'Ollama' ? 'http://localhost:11434' : 'https://api.example.com/v1'}
              className="flex-1 px-3 py-1.5 rounded-md text-xs bg-stone-800/60 border border-stone-700/50 text-stone-300 placeholder:text-stone-600 outline-none focus:border-stone-600/60"
            />
            <button
              onClick={handleSaveUrl}
              disabled={!baseUrl.trim()}
              className="px-3 py-1.5 rounded-md text-xs font-medium bg-blue-600 hover:bg-blue-500 text-white disabled:bg-stone-700 disabled:text-stone-500 transition-colors"
            >
              Save
            </button>
          </div>
        </div>
      )}

      {/* Test button */}
      <button
        onClick={handleTest}
        disabled={testing}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium text-stone-300 bg-stone-800/60 border border-stone-700/40 hover:bg-stone-700/60 disabled:text-stone-600 transition-colors"
      >
        {testing ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />}
        Test Connection
      </button>
    </div>
  );
}
