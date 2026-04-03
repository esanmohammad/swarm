import { useState, useEffect } from 'react';
import { GitBranch, Play, Merge, CheckCircle, XCircle, Clock, DollarSign, Layers, ArrowRight, Settings } from 'lucide-react';
import { FeatureGuide } from '../components/FeatureGuide';
import { StateView } from '../components/StateView';
import type { WsCommand } from '../types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DelegateState {
  featureRequest: string;
  workstreams: Array<{
    id: string;
    name: string;
    tasks: string[];
    branch: string;
    status: string;
    cost: number;
    startedAt?: number;
    completedAt?: number;
    error?: string;
    prUrl?: string;
    dependsOn: string[];
  }>;
  totalBudget: number;
  totalCost: number;
  status: string;
  startedAt: number;
}

interface DelegateViewProps {
  sendCommand: (cmd: WsCommand) => void;
  delegateState: DelegateState | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const STATUS_STYLES: Record<string, { icon: typeof CheckCircle; color: string; bg: string; label: string }> = {
  pending: { icon: Clock, color: 'text-yellow-400', bg: 'bg-yellow-500/15 border-yellow-500/30', label: 'Pending' },
  running: { icon: Play, color: 'text-blue-400', bg: 'bg-blue-500/15 border-blue-500/30', label: 'Running' },
  done: { icon: CheckCircle, color: 'text-green-400', bg: 'bg-green-500/15 border-green-500/30', label: 'Done' },
  failed: { icon: XCircle, color: 'text-red-400', bg: 'bg-red-500/15 border-red-500/30', label: 'Failed' },
  merging: { icon: Merge, color: 'text-violet-400', bg: 'bg-violet-500/15 border-violet-500/30', label: 'Merging' },
  decomposing: { icon: Layers, color: 'text-cyan-400', bg: 'bg-cyan-500/15 border-cyan-500/30', label: 'Decomposing' },
};

function formatDuration(startMs: number, endMs?: number): string {
  const elapsed = (endMs ?? Date.now()) - startMs;
  const mins = Math.floor(elapsed / 60000);
  if (mins < 1) return '<1m';
  if (mins < 60) return `${mins}m`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function DelegateView({ sendCommand, delegateState }: DelegateViewProps) {
  const [feature, setFeature] = useState('');
  const [maxParallel, setMaxParallel] = useState('3');
  const [budget, setBudget] = useState('50');
  const [showConfig, setShowConfig] = useState(false);

  useEffect(() => {
    sendCommand({ action: 'get-delegate-status' } as WsCommand);
  }, []);

  const handleDelegate = () => {
    if (!feature.trim()) return;
    sendCommand({
      action: 'run-delegate',
      feature: feature.trim(),
      maxParallel: parseInt(maxParallel) || 3,
      budget: parseFloat(budget) || 50,
    } as WsCommand);
  };

  const handleMergeAll = () => {
    sendCommand({ action: 'run-delegate-merge' } as WsCommand);
  };

  const isActive = delegateState && ['decomposing', 'running', 'merging'].includes(delegateState.status);
  const budgetPct = delegateState ? Math.min((delegateState.totalCost / delegateState.totalBudget) * 100, 100) : 0;
  const doneCount = delegateState?.workstreams.filter((ws) => ws.status === 'done').length ?? 0;
  const totalCount = delegateState?.workstreams.length ?? 0;

  return (
    <div className="flex-1 overflow-auto p-4 sm:p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Layers size={20} className="text-violet-400" />
          <div>
            <h2 className="text-sm font-semibold text-stone-200">Delegate</h2>
            <p className="text-xs text-stone-500">Multi-agent task decomposition with parallel workstreams</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {delegateState && (
            <span className={`text-xs font-medium px-2 py-0.5 rounded-full border ${(STATUS_STYLES[delegateState.status] ?? STATUS_STYLES.pending).bg}`}>
              {(STATUS_STYLES[delegateState.status] ?? STATUS_STYLES.pending).label}
            </span>
          )}
          <button
            onClick={() => setShowConfig(!showConfig)}
            className="p-1.5 rounded-md hover:bg-stone-800/50 text-stone-500 hover:text-stone-300 transition-colors"
          >
            <Settings size={14} />
          </button>
        </div>
      </div>

      <FeatureGuide
        featureId="delegate"
        title="Delegation"
        description="Break complex tasks into sub-tasks and delegate to specialized AI agents. Each sub-agent works independently, then results are merged."
        cliCommands={[
          { command: 'swarm delegate "Refactor auth module"', description: 'Delegate a feature to parallel workstreams' },
        ]}
        hasData={!!delegateState && delegateState.workstreams.length > 0}
      />

      {/* Feature Input */}
      <div className="p-4 rounded-lg bg-stone-900/50 border border-stone-800/50 space-y-3">
        <label className="block text-[10px] text-stone-500 uppercase tracking-wider font-semibold">Feature Request</label>
        <textarea
          value={feature}
          onChange={(e) => setFeature(e.target.value)}
          placeholder="Describe the large feature to decompose into parallel workstreams..."
          className="w-full px-3 py-2 text-xs rounded-md bg-stone-800/80 border border-stone-700/50 text-stone-200 focus:outline-none focus:border-violet-500/50 resize-none h-20"
          disabled={!!isActive}
        />

        {/* Config panel */}
        {showConfig && (
          <div className="grid grid-cols-2 gap-3 pt-2 border-t border-stone-800/30">
            <div>
              <label className="block text-[10px] text-stone-500 mb-1">Max Parallel</label>
              <input
                value={maxParallel}
                onChange={(e) => setMaxParallel(e.target.value)}
                type="number"
                min="1"
                max="10"
                className="w-full px-2.5 py-1.5 text-xs rounded-md bg-stone-800/80 border border-stone-700/50 text-stone-200 focus:outline-none focus:border-violet-500/50"
                disabled={!!isActive}
              />
            </div>
            <div>
              <label className="block text-[10px] text-stone-500 mb-1">Budget ($)</label>
              <input
                value={budget}
                onChange={(e) => setBudget(e.target.value)}
                type="number"
                min="1"
                className="w-full px-2.5 py-1.5 text-xs rounded-md bg-stone-800/80 border border-stone-700/50 text-stone-200 focus:outline-none focus:border-violet-500/50"
                disabled={!!isActive}
              />
            </div>
          </div>
        )}

        <div className="flex items-center gap-2">
          <button
            onClick={handleDelegate}
            disabled={!feature.trim() || !!isActive}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-violet-500/15 text-violet-400 border border-violet-500/30 hover:bg-violet-500/25 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Play size={12} />
            Delegate
          </button>
          {delegateState && doneCount > 0 && delegateState.status !== 'merging' && (
            <button
              onClick={handleMergeAll}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-green-500/15 text-green-400 border border-green-500/30 hover:bg-green-500/25 transition-colors"
            >
              <Merge size={12} />
              Merge All
            </button>
          )}
        </div>
      </div>

      {/* Budget Bar */}
      {delegateState && (
        <div className="p-4 rounded-lg bg-stone-900/50 border border-stone-800/50 space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-xs text-stone-400">
              <DollarSign size={12} />
              <span>Budget</span>
            </div>
            <span className="text-xs text-stone-300">
              ${delegateState.totalCost.toFixed(2)} / ${delegateState.totalBudget.toFixed(2)}
            </span>
          </div>
          <div className="w-full h-2 rounded-full bg-stone-800/80 overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-500 ${
                budgetPct > 90 ? 'bg-red-500' : budgetPct > 70 ? 'bg-amber-500' : 'bg-violet-500'
              }`}
              style={{ width: `${budgetPct}%` }}
            />
          </div>
          <div className="flex items-center justify-between text-[10px] text-stone-500">
            <span>{doneCount}/{totalCount} workstreams complete</span>
            <span>{formatDuration(delegateState.startedAt)}</span>
          </div>
        </div>
      )}

      {/* Workstream Swimlanes */}
      {delegateState && delegateState.workstreams.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-xs font-semibold text-stone-400 uppercase tracking-wider">
            Workstreams ({delegateState.workstreams.length})
          </h3>
          <div className="space-y-2">
            {delegateState.workstreams.map((ws) => {
              const style = STATUS_STYLES[ws.status] ?? STATUS_STYLES.pending;
              const Icon = style.icon;

              return (
                <div key={ws.id} className="rounded-lg bg-stone-900/30 border border-stone-800/50 overflow-hidden">
                  <div className="flex items-center gap-3 px-4 py-3">
                    <Icon size={14} className={`shrink-0 ${style.color} ${ws.status === 'running' ? 'animate-pulse' : ''}`} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-medium text-stone-200 truncate">{ws.name}</span>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded border ${style.bg}`}>{style.label}</span>
                      </div>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="flex items-center gap-1 text-[10px] text-stone-500">
                          <GitBranch size={10} />
                          {ws.branch}
                        </span>
                        {ws.cost > 0 && (
                          <span className="text-[10px] text-amber-400">${ws.cost.toFixed(2)}</span>
                        )}
                        {ws.startedAt && (
                          <span className="text-[10px] text-stone-500">{formatDuration(ws.startedAt, ws.completedAt)}</span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Tasks */}
                  <div className="px-4 pb-3 space-y-1">
                    {ws.tasks.map((task, i) => (
                      <div key={i} className="flex items-start gap-2 text-[10px] text-stone-400">
                        <span className="text-stone-600 mt-px">-</span>
                        <span>{task}</span>
                      </div>
                    ))}
                  </div>

                  {/* Dependencies */}
                  {ws.dependsOn.length > 0 && (
                    <div className="px-4 pb-3 flex items-center gap-1.5 text-[10px] text-stone-500">
                      <ArrowRight size={10} />
                      <span>Depends on: {ws.dependsOn.join(', ')}</span>
                    </div>
                  )}

                  {/* Error */}
                  {ws.error && (
                    <div className="px-4 pb-3">
                      <div className="text-[10px] text-red-400 bg-red-950/20 p-2 rounded font-mono">
                        {ws.error}
                      </div>
                    </div>
                  )}

                  {/* PR Link */}
                  {ws.prUrl && (
                    <div className="px-4 pb-3">
                      <a
                        href={ws.prUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[10px] text-violet-400 hover:text-violet-300"
                      >
                        View Pull Request
                      </a>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Empty State */}
      {(!delegateState || delegateState.workstreams.length === 0) && !isActive && (
        <StateView
          status="empty"
          title="No active delegation"
          message="Describe a large feature above to decompose it into parallel workstreams. Each workstream gets its own branch and agent, then results are merged back together."
        />
      )}
    </div>
  );
}
