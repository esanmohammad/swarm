import { useState, useEffect } from 'react';
import { Database, Search, RefreshCw, AlertTriangle, GitBranch, FileCode, Layers, Clock } from 'lucide-react';
import type { WsCommand } from '../types';

interface ContextIndex {
  totalFiles: number;
  totalSymbols: number;
  modules: Array<{ path: string; purpose: string; fileCount: number }>;
  fragileFiles: Array<{ path: string; failureRate: number; reason: string }>;
  coChangePatterns: Array<{ fileA: string; fileB: string; frequency: number }>;
  builtAt: number;
  queryResult?: string;
}

interface ContextViewProps {
  sendCommand: (cmd: WsCommand) => void;
  contextIndex: ContextIndex | null;
}

function formatAge(timestamp: number): string {
  const age = Date.now() - timestamp;
  if (age < 3600000) return `${Math.round(age / 60000)}m ago`;
  if (age < 86400000) return `${Math.round(age / 3600000)}h ago`;
  return `${Math.round(age / 86400000)}d ago`;
}

function riskColor(rate: number): string {
  if (rate > 0.7) return 'text-red-400';
  if (rate > 0.4) return 'text-amber-400';
  return 'text-stone-400';
}

function riskBg(rate: number): string {
  if (rate > 0.7) return 'bg-red-500/20 border-red-500/30';
  if (rate > 0.4) return 'bg-amber-500/20 border-amber-500/30';
  return 'bg-stone-700/30 border-stone-600/30';
}

export function ContextView({ sendCommand, contextIndex }: ContextViewProps) {
  const [query, setQuery] = useState('');
  const [rebuilding, setRebuilding] = useState(false);

  useEffect(() => {
    sendCommand({ action: 'get-context-index' } as WsCommand);
  }, []);

  const handleRebuild = () => {
    setRebuilding(true);
    sendCommand({ action: 'run-context-build' } as WsCommand);
    setTimeout(() => setRebuilding(false), 3000);
  };

  const handleQuery = (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;
    sendCommand({ action: 'run-context-query', query: query.trim() } as WsCommand);
  };

  if (!contextIndex) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center">
          <Database size={36} className="text-stone-600 mx-auto mb-3" />
          <p className="text-sm text-stone-400">Loading codebase index...</p>
          <p className="text-xs text-stone-500 mt-1">Run <code className="text-stone-400">swarm context build</code> if no index exists.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col p-6 overflow-auto">
      <div className="max-w-5xl w-full mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Database size={18} className="text-blue-400" />
            <h2 className="text-lg font-semibold text-stone-200">Codebase Context</h2>
          </div>
          <button
            onClick={handleRebuild}
            disabled={rebuilding}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium border border-stone-700/40 text-stone-300 hover:border-blue-500/40 hover:text-blue-300 transition-colors disabled:opacity-50"
          >
            <RefreshCw size={12} className={rebuilding ? 'animate-spin' : ''} />
            {rebuilding ? 'Rebuilding...' : 'Rebuild Index'}
          </button>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-4 gap-3">
          <div className="bg-stone-800/50 border border-stone-700/40 rounded-lg p-3">
            <div className="flex items-center gap-1.5 mb-1">
              <FileCode size={12} className="text-cyan-400" />
              <span className="text-[10px] uppercase tracking-wider text-stone-500">Files</span>
            </div>
            <p className="text-xl font-semibold text-stone-200">{contextIndex.totalFiles}</p>
          </div>
          <div className="bg-stone-800/50 border border-stone-700/40 rounded-lg p-3">
            <div className="flex items-center gap-1.5 mb-1">
              <Layers size={12} className="text-purple-400" />
              <span className="text-[10px] uppercase tracking-wider text-stone-500">Symbols</span>
            </div>
            <p className="text-xl font-semibold text-stone-200">{contextIndex.totalSymbols}</p>
          </div>
          <div className="bg-stone-800/50 border border-stone-700/40 rounded-lg p-3">
            <div className="flex items-center gap-1.5 mb-1">
              <GitBranch size={12} className="text-green-400" />
              <span className="text-[10px] uppercase tracking-wider text-stone-500">Modules</span>
            </div>
            <p className="text-xl font-semibold text-stone-200">{contextIndex.modules.length}</p>
          </div>
          <div className="bg-stone-800/50 border border-stone-700/40 rounded-lg p-3">
            <div className="flex items-center gap-1.5 mb-1">
              <Clock size={12} className="text-amber-400" />
              <span className="text-[10px] uppercase tracking-wider text-stone-500">Last Built</span>
            </div>
            <p className="text-sm font-medium text-stone-300 mt-0.5">{formatAge(contextIndex.builtAt)}</p>
          </div>
        </div>

        {/* Search Bar */}
        <form onSubmit={handleQuery} className="flex gap-2">
          <div className="flex-1 relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-500" />
            <input
              type="text"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search codebase... (e.g. 'pipeline', 'WebSocket', 'agent')"
              className="w-full pl-9 pr-3 py-2 bg-stone-800/50 border border-stone-700/40 rounded-lg text-sm text-stone-200 placeholder-stone-500 focus:outline-none focus:border-blue-500/50"
            />
          </div>
          <button
            type="submit"
            className="px-4 py-2 bg-blue-600/20 border border-blue-500/40 rounded-lg text-xs font-medium text-blue-300 hover:bg-blue-600/30 transition-colors"
          >
            Search
          </button>
        </form>

        {/* Query Results */}
        {contextIndex.queryResult && (
          <div className="bg-stone-800/50 border border-stone-700/40 rounded-lg p-4">
            <h3 className="text-xs font-semibold text-stone-400 uppercase tracking-wider mb-3">Search Results</h3>
            <pre className="text-xs text-stone-300 whitespace-pre-wrap font-mono leading-relaxed">
              {contextIndex.queryResult}
            </pre>
          </div>
        )}

        {/* Modules List */}
        <div className="bg-stone-800/50 border border-stone-700/40 rounded-lg p-4">
          <h3 className="text-xs font-semibold text-stone-400 uppercase tracking-wider mb-3 flex items-center gap-1.5">
            <Layers size={12} />
            Modules
          </h3>
          {contextIndex.modules.length === 0 ? (
            <p className="text-xs text-stone-500">No modules indexed.</p>
          ) : (
            <div className="space-y-1.5">
              {contextIndex.modules.map((m, i) => (
                <div key={i} className="flex items-center justify-between py-1.5 px-2 rounded hover:bg-stone-700/20">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-mono text-cyan-400">{m.path}</span>
                    <span className="text-xs text-stone-500">{m.purpose}</span>
                  </div>
                  <span className="text-[10px] text-stone-500 bg-stone-700/30 px-1.5 py-0.5 rounded">
                    {m.fileCount} files
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Fragile Files */}
        <div className="bg-stone-800/50 border border-stone-700/40 rounded-lg p-4">
          <h3 className="text-xs font-semibold text-stone-400 uppercase tracking-wider mb-3 flex items-center gap-1.5">
            <AlertTriangle size={12} className="text-amber-400" />
            Fragile Files
          </h3>
          {contextIndex.fragileFiles.length === 0 ? (
            <p className="text-xs text-stone-500">No fragile files detected.</p>
          ) : (
            <table className="w-full text-xs">
              <thead>
                <tr className="text-stone-500 text-left">
                  <th className="pb-2 font-medium">File</th>
                  <th className="pb-2 font-medium w-20 text-center">Risk</th>
                  <th className="pb-2 font-medium">Reason</th>
                </tr>
              </thead>
              <tbody>
                {contextIndex.fragileFiles.map((f, i) => (
                  <tr key={i} className="border-t border-stone-700/30 hover:bg-stone-700/20">
                    <td className="py-2 font-mono text-stone-300">{f.path}</td>
                    <td className="py-2 text-center">
                      <span className={`inline-block px-1.5 py-0.5 rounded border text-[10px] font-semibold ${riskBg(f.failureRate)} ${riskColor(f.failureRate)}`}>
                        {(f.failureRate * 100).toFixed(0)}%
                      </span>
                    </td>
                    <td className="py-2 text-stone-500">{f.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Co-Change Patterns */}
        <div className="bg-stone-800/50 border border-stone-700/40 rounded-lg p-4">
          <h3 className="text-xs font-semibold text-stone-400 uppercase tracking-wider mb-3 flex items-center gap-1.5">
            <GitBranch size={12} className="text-green-400" />
            Co-Change Patterns
          </h3>
          {contextIndex.coChangePatterns.length === 0 ? (
            <p className="text-xs text-stone-500">No co-change patterns detected.</p>
          ) : (
            <div className="space-y-1.5">
              {contextIndex.coChangePatterns.map((p, i) => (
                <div key={i} className="flex items-center gap-2 py-1.5 px-2 rounded hover:bg-stone-700/20">
                  <span className="text-xs font-mono text-stone-300">{p.fileA}</span>
                  <span className="text-stone-600 text-[10px]">&harr;</span>
                  <span className="text-xs font-mono text-stone-300">{p.fileB}</span>
                  <span className="ml-auto text-[10px] text-stone-500 bg-stone-700/30 px-1.5 py-0.5 rounded">
                    {p.frequency}x
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
