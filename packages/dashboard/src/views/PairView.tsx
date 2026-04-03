import { useState, useEffect } from 'react';
import {
  Users, Play, Square, Eye, EyeOff, Bell, CheckCircle, XCircle,
  FileCode, Clock, AlertTriangle, MessageCircle,
} from 'lucide-react';
import { FeatureGuide } from '../components/FeatureGuide';
import { StateView } from '../components/StateView';
import type { WsCommand } from '../types';

interface PairSuggestion {
  id: string;
  type: string;
  file: string;
  line?: number;
  message: string;
  severity: string;
  timestamp: number;
  accepted?: boolean;
}

interface PairSession {
  id: string;
  startedAt: number;
  mode: string;
  focusDir?: string;
  filesWatched: number;
  suggestions: PairSuggestion[];
  changedFiles: string[];
}

interface PairViewProps {
  sendCommand: (cmd: WsCommand) => void;
  pairSession: PairSession | null;
}

const SEVERITY_COLORS: Record<string, string> = {
  info: 'text-blue-400',
  warning: 'text-yellow-400',
  critical: 'text-red-400',
};

const SEVERITY_BG: Record<string, string> = {
  info: 'bg-blue-950/30 border-blue-800/20',
  warning: 'bg-yellow-950/30 border-yellow-800/20',
  critical: 'bg-red-950/30 border-red-800/20',
};

const TYPE_LABELS: Record<string, string> = {
  bug: 'BUG',
  pattern: 'PATTERN',
  'test-gap': 'TEST GAP',
  security: 'SECURITY',
  import: 'IMPORT',
  'co-change': 'CO-CHANGE',
};

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}

export function PairView({ sendCommand, pairSession }: PairViewProps) {
  const [mode, setMode] = useState<string>('suggest');
  const [focusDir, setFocusDir] = useState('');
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    sendCommand({ action: 'get-pair-session' } as WsCommand);
  }, []);

  // Update elapsed time every second when session is active
  useEffect(() => {
    if (!pairSession) return;
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [pairSession]);

  const handleStart = () => {
    sendCommand({
      action: 'pair-start',
      mode,
      focusDir: focusDir || undefined,
    } as WsCommand);
  };

  const handleStop = () => {
    sendCommand({ action: 'pair-stop' } as WsCommand);
  };

  const handleAccept = (_id: string) => {
    sendCommand({ action: 'get-pair-session' } as WsCommand);
  };

  const handleDismiss = (_id: string) => {
    sendCommand({ action: 'get-pair-session' } as WsCommand);
  };

  const isActive = !!pairSession;
  const suggestions = pairSession?.suggestions || [];
  const changedFiles = pairSession?.changedFiles || [];
  const accepted = suggestions.filter(s => s.accepted === true).length;
  const total = suggestions.length;
  const acceptRate = total > 0 ? Math.round((accepted / total) * 100) : 0;
  const elapsed = pairSession ? now - pairSession.startedAt : 0;

  return (
    <div className="flex-1 flex flex-col p-6 overflow-hidden">
      <div className="max-w-4xl w-full mx-auto flex flex-col flex-1 min-h-0">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Users size={18} className="text-violet-400" />
            <h2 className="text-lg font-semibold text-stone-200">Pair Mode</h2>
            {isActive && (
              <span className="ml-2 px-2 py-0.5 rounded-full text-[10px] font-medium bg-violet-600/20 text-violet-300 border border-violet-500/30">
                ACTIVE
              </span>
            )}
          </div>
          {isActive ? (
            <button
              onClick={handleStop}
              className="flex items-center gap-1.5 px-4 py-1.5 rounded-md text-xs font-medium text-white bg-red-600 hover:bg-red-500 transition-colors"
            >
              <Square size={12} />
              Stop Session
            </button>
          ) : (
            <button
              onClick={handleStart}
              className="flex items-center gap-1.5 px-4 py-1.5 rounded-md text-xs font-medium text-white bg-violet-600 hover:bg-violet-500 transition-colors"
            >
              <Play size={12} />
              Start Pairing
            </button>
          )}
        </div>

        <FeatureGuide
          featureId="pair"
          title="Pair Programming"
          description="Real-time AI pair programming. Start a session and get context-aware suggestions as you code."
          cliCommands={[
            { command: 'swarm pair', description: 'Start a pair programming session' },
          ]}
          hasData={!!pairSession}
        />

        <p className="text-xs text-stone-500 mb-4">
          Real-time collaboration mode — watches files and provides live suggestions for bugs, patterns, security issues, and more.
        </p>

        {/* Controls (when not active) */}
        {!isActive && (
          <div className="grid grid-cols-2 gap-3 mb-4">
            <div>
              <label className="block text-[10px] text-stone-500 uppercase mb-1">Mode</label>
              <div className="flex gap-1">
                {['suggest', 'assist', 'silent'].map(m => (
                  <button
                    key={m}
                    onClick={() => setMode(m)}
                    className={`flex items-center gap-1 px-3 py-1.5 rounded text-xs font-medium transition-colors ${
                      mode === m
                        ? 'bg-violet-600/20 text-violet-300 border border-violet-500/30'
                        : 'bg-stone-900/40 text-stone-400 border border-stone-800/40 hover:border-stone-700/40'
                    }`}
                  >
                    {m === 'suggest' && <Bell size={10} />}
                    {m === 'assist' && <Eye size={10} />}
                    {m === 'silent' && <EyeOff size={10} />}
                    {m.charAt(0).toUpperCase() + m.slice(1)}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="block text-[10px] text-stone-500 uppercase mb-1">Focus Directory</label>
              <input
                type="text"
                value={focusDir}
                onChange={e => setFocusDir(e.target.value)}
                placeholder="e.g. src/core"
                className="w-full px-3 py-1.5 rounded text-xs bg-stone-900/60 border border-stone-800/40 text-stone-300 placeholder-stone-600 focus:outline-none focus:border-violet-500/50"
              />
            </div>
          </div>
        )}

        {/* Session Stats */}
        {isActive && (
          <div className="grid grid-cols-5 gap-3 mb-4">
            <div className="p-3 rounded-lg bg-stone-900/40 border border-stone-800/40 text-center">
              <div className="flex items-center justify-center gap-1 mb-1">
                <Clock size={10} className="text-stone-500" />
              </div>
              <div className="text-sm font-semibold text-stone-200">{formatDuration(elapsed)}</div>
              <div className="text-[10px] text-stone-500 uppercase">Duration</div>
            </div>
            <div className="p-3 rounded-lg bg-stone-900/40 border border-stone-800/40 text-center">
              <div className="text-sm font-semibold text-stone-200">{pairSession.filesWatched}</div>
              <div className="text-[10px] text-stone-500 uppercase">Watched</div>
            </div>
            <div className="p-3 rounded-lg bg-stone-900/40 border border-stone-800/40 text-center">
              <div className="text-sm font-semibold text-violet-400">{total}</div>
              <div className="text-[10px] text-stone-500 uppercase">Suggestions</div>
            </div>
            <div className="p-3 rounded-lg bg-green-950/30 border border-green-800/20 text-center">
              <div className="text-sm font-semibold text-green-400">{accepted}</div>
              <div className="text-[10px] text-stone-500 uppercase">Accepted</div>
            </div>
            <div className="p-3 rounded-lg bg-stone-900/40 border border-stone-800/40 text-center">
              <div className="text-sm font-semibold text-stone-200">{acceptRate}%</div>
              <div className="text-[10px] text-stone-500 uppercase">Accept Rate</div>
            </div>
          </div>
        )}

        {/* Main content area */}
        <div className="flex-1 min-h-0 flex gap-4">
          {/* Suggestions feed */}
          <div className="flex-1 min-h-0 flex flex-col">
            <div className="flex items-center gap-2 mb-2">
              <MessageCircle size={12} className="text-stone-500" />
              <h3 className="text-xs font-medium text-stone-400 uppercase">Suggestions</h3>
              {total > 0 && (
                <span className="text-[10px] text-stone-600">({total})</span>
              )}
            </div>
            <div className="flex-1 min-h-0 overflow-auto space-y-2">
              {suggestions.length === 0 ? (
                <StateView
                  status="empty"
                  title={isActive ? 'No suggestions yet' : 'No active pairing session'}
                  message={isActive
                    ? 'Edit some files and suggestions will appear here in real time.'
                    : 'Start one to get AI-assisted coding help. Click "Start Pairing" to begin watching files and receiving live suggestions.'}
                />
              ) : (
                [...suggestions].reverse().map(suggestion => (
                  <div
                    key={suggestion.id}
                    className={`p-3 rounded-lg border transition-colors ${
                      suggestion.accepted === true
                        ? 'bg-green-950/20 border-green-800/20 opacity-60'
                        : suggestion.accepted === false
                        ? 'bg-stone-900/20 border-stone-800/20 opacity-40'
                        : SEVERITY_BG[suggestion.severity] || 'bg-stone-900/40 border-stone-800/40'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          {suggestion.severity === 'critical' && <AlertTriangle size={12} className="text-red-400 shrink-0" />}
                          <span className={`text-[10px] font-bold uppercase ${SEVERITY_COLORS[suggestion.severity] || 'text-stone-400'}`}>
                            {TYPE_LABELS[suggestion.type] || suggestion.type}
                          </span>
                          <span className="text-[10px] text-stone-600">
                            {new Date(suggestion.timestamp).toLocaleTimeString()}
                          </span>
                        </div>
                        <p className="text-xs text-stone-300 mb-1">{suggestion.message}</p>
                        <div className="flex items-center gap-1.5">
                          <FileCode size={10} className="text-stone-600" />
                          <span className="text-[10px] text-stone-500 font-mono truncate">
                            {suggestion.file}{suggestion.line ? `:${suggestion.line}` : ''}
                          </span>
                        </div>
                      </div>
                      {suggestion.accepted === undefined && (
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            onClick={() => handleAccept(suggestion.id)}
                            className="p-1 rounded hover:bg-green-600/20 transition-colors"
                            title="Accept"
                          >
                            <CheckCircle size={14} className="text-green-500" />
                          </button>
                          <button
                            onClick={() => handleDismiss(suggestion.id)}
                            className="p-1 rounded hover:bg-red-600/20 transition-colors"
                            title="Dismiss"
                          >
                            <XCircle size={14} className="text-stone-600 hover:text-red-400" />
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Changed files sidebar */}
          {isActive && changedFiles.length > 0 && (
            <div className="w-56 shrink-0 flex flex-col">
              <div className="flex items-center gap-2 mb-2">
                <FileCode size={12} className="text-stone-500" />
                <h3 className="text-xs font-medium text-stone-400 uppercase">Changed Files</h3>
                <span className="text-[10px] text-stone-600">({changedFiles.length})</span>
              </div>
              <div className="flex-1 min-h-0 overflow-auto space-y-1">
                {changedFiles.map(file => (
                  <div
                    key={file}
                    className="px-2 py-1.5 rounded bg-stone-900/40 border border-stone-800/40 text-[10px] text-stone-400 font-mono truncate"
                    title={file}
                  >
                    {file}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
