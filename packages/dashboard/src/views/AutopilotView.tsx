import { useState, useEffect } from 'react';
import { Bot, Play, Square, CheckCircle, XCircle, Clock, ExternalLink, GitPullRequest, Loader2 } from 'lucide-react';
import type { WsCommand, AutopilotState, AutopilotIssue } from '../types';

interface AutopilotViewProps {
  sendCommand: (cmd: WsCommand) => void;
  autopilotState: AutopilotState | null;
}

const STATUS_STYLES: Record<string, { icon: typeof CheckCircle; color: string; bg: string }> = {
  done: { icon: CheckCircle, color: 'text-green-400', bg: 'bg-green-500/15 border-green-500/30' },
  failed: { icon: XCircle, color: 'text-red-400', bg: 'bg-red-500/15 border-red-500/30' },
  running: { icon: Loader2, color: 'text-blue-400', bg: 'bg-blue-500/15 border-blue-500/30' },
  pending: { icon: Clock, color: 'text-yellow-400', bg: 'bg-yellow-500/15 border-yellow-500/30' },
};

function formatDuration(ms: number | undefined): string {
  if (!ms) return '-';
  const minutes = Math.floor(ms / 60000);
  if (minutes < 1) return '<1m';
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

export function AutopilotView({ sendCommand, autopilotState }: AutopilotViewProps) {
  const [label, setLabel] = useState('swarm');
  const [interval, setInterval] = useState('10');
  const [budget, setBudget] = useState('10');
  const [maxConcurrent, setMaxConcurrent] = useState('1');
  const [expandedIssue, setExpandedIssue] = useState<number | null>(null);

  useEffect(() => {
    sendCommand({ action: 'autopilot-status' } as WsCommand);
  }, []);

  useEffect(() => {
    if (autopilotState) {
      setLabel(autopilotState.label);
      setInterval(String(autopilotState.pollInterval));
      setBudget(String(autopilotState.budgetPerIssue));
      setMaxConcurrent(String(autopilotState.maxConcurrent));
    }
  }, [autopilotState]);

  const isRunning = autopilotState?.running ?? false;

  const handleStart = () => {
    sendCommand({
      action: 'autopilot-start',
      label: label.trim() || 'swarm',
      interval: parseInt(interval) || 10,
      maxConcurrent: parseInt(maxConcurrent) || 1,
      budget: parseFloat(budget) || 10,
    } as WsCommand);
  };

  const handleStop = () => {
    sendCommand({ action: 'autopilot-stop' } as WsCommand);
  };

  const stats = autopilotState?.stats ?? { totalProcessed: 0, successful: 0, failed: 0, totalCost: 0 };
  const successRate = stats.totalProcessed > 0 ? ((stats.successful / stats.totalProcessed) * 100).toFixed(0) : '-';
  const allIssues = [
    ...(autopilotState?.queue ?? []),
    ...(autopilotState?.processedIssues ?? []).slice().reverse(),
  ];

  return (
    <div className="flex-1 overflow-auto p-4 sm:p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Bot size={20} className="text-violet-400" />
          <div>
            <h2 className="text-sm font-semibold text-stone-200">Autopilot</h2>
            <p className="text-xs text-stone-500">Issue-to-PR automation — watches GitHub issues and builds features</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${isRunning ? 'bg-green-500/15 text-green-400 border border-green-500/30' : 'bg-stone-800 text-stone-500 border border-stone-700/50'}`}>
            {isRunning ? 'Running' : 'Stopped'}
          </span>
        </div>
      </div>

      {/* Config + Controls */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="p-4 rounded-lg bg-stone-900/50 border border-stone-800/50 space-y-3">
          <h3 className="text-xs font-semibold text-stone-400 uppercase tracking-wider">Configuration</h3>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[10px] text-stone-500 mb-1">GitHub Label</label>
              <input
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                className="w-full px-2.5 py-1.5 text-xs rounded-md bg-stone-800/80 border border-stone-700/50 text-stone-200 focus:outline-none focus:border-violet-500/50"
                placeholder="swarm"
                disabled={isRunning}
              />
            </div>
            <div>
              <label className="block text-[10px] text-stone-500 mb-1">Poll Interval (min)</label>
              <input
                value={interval}
                onChange={(e) => setInterval(e.target.value)}
                type="number"
                min="1"
                className="w-full px-2.5 py-1.5 text-xs rounded-md bg-stone-800/80 border border-stone-700/50 text-stone-200 focus:outline-none focus:border-violet-500/50"
                disabled={isRunning}
              />
            </div>
            <div>
              <label className="block text-[10px] text-stone-500 mb-1">Budget per Issue ($)</label>
              <input
                value={budget}
                onChange={(e) => setBudget(e.target.value)}
                type="number"
                min="1"
                className="w-full px-2.5 py-1.5 text-xs rounded-md bg-stone-800/80 border border-stone-700/50 text-stone-200 focus:outline-none focus:border-violet-500/50"
                disabled={isRunning}
              />
            </div>
            <div>
              <label className="block text-[10px] text-stone-500 mb-1">Max Concurrent</label>
              <input
                value={maxConcurrent}
                onChange={(e) => setMaxConcurrent(e.target.value)}
                type="number"
                min="1"
                max="5"
                className="w-full px-2.5 py-1.5 text-xs rounded-md bg-stone-800/80 border border-stone-700/50 text-stone-200 focus:outline-none focus:border-violet-500/50"
                disabled={isRunning}
              />
            </div>
          </div>
          <button
            onClick={isRunning ? handleStop : handleStart}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
              isRunning
                ? 'bg-red-500/15 text-red-400 border border-red-500/30 hover:bg-red-500/25'
                : 'bg-violet-500/15 text-violet-400 border border-violet-500/30 hover:bg-violet-500/25'
            }`}
          >
            {isRunning ? <Square size={12} /> : <Play size={12} />}
            {isRunning ? 'Stop Autopilot' : 'Start Autopilot'}
          </button>
        </div>

        {/* Stats */}
        <div className="p-4 rounded-lg bg-stone-900/50 border border-stone-800/50 space-y-3">
          <h3 className="text-xs font-semibold text-stone-400 uppercase tracking-wider">Stats</h3>
          <div className="grid grid-cols-2 gap-3">
            <div className="p-3 rounded-md bg-stone-800/40">
              <div className="text-lg font-semibold text-stone-200">{stats.totalProcessed}</div>
              <div className="text-[10px] text-stone-500">Total Processed</div>
            </div>
            <div className="p-3 rounded-md bg-stone-800/40">
              <div className="text-lg font-semibold text-green-400">{successRate}%</div>
              <div className="text-[10px] text-stone-500">Success Rate</div>
            </div>
            <div className="p-3 rounded-md bg-stone-800/40">
              <div className="text-lg font-semibold text-stone-200">{stats.successful} / {stats.failed}</div>
              <div className="text-[10px] text-stone-500">Success / Failed</div>
            </div>
            <div className="p-3 rounded-md bg-stone-800/40">
              <div className="text-lg font-semibold text-amber-400">${stats.totalCost.toFixed(2)}</div>
              <div className="text-[10px] text-stone-500">Total Cost</div>
            </div>
          </div>
        </div>
      </div>

      {/* Issue Queue / History */}
      <div className="space-y-2">
        <h3 className="text-xs font-semibold text-stone-400 uppercase tracking-wider">
          Issues ({allIssues.length})
        </h3>
        {allIssues.length === 0 ? (
          <div className="text-center py-8 text-stone-500">
            <Bot size={28} className="mx-auto mb-2 opacity-30" />
            <p className="text-xs">No issues processed yet.</p>
            <p className="text-[10px] text-stone-600 mt-1">
              Label issues with "{label}" on GitHub to queue them for autopilot.
            </p>
          </div>
        ) : (
          <div className="space-y-1">
            {allIssues.map((issue) => (
              <IssueRow
                key={`${issue.number}-${issue.updatedAt}`}
                issue={issue}
                expanded={expandedIssue === issue.number}
                onToggle={() => setExpandedIssue(expandedIssue === issue.number ? null : issue.number)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function IssueRow({ issue, expanded, onToggle }: { issue: AutopilotIssue; expanded: boolean; onToggle: () => void }) {
  const style = STATUS_STYLES[issue.status] || STATUS_STYLES.pending;
  const Icon = style.icon;

  return (
    <div className="rounded-lg bg-stone-900/30 border border-stone-800/50 overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-stone-800/20 transition-colors"
      >
        <Icon size={14} className={`shrink-0 ${style.color} ${issue.status === 'running' ? 'animate-spin' : ''}`} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-stone-300 truncate">#{issue.number} {issue.title}</span>
            <span className={`text-[10px] px-1.5 py-0.5 rounded border ${style.bg}`}>{issue.status}</span>
          </div>
          <div className="text-[10px] text-stone-500 mt-0.5">
            by @{issue.author}
            {issue.cost != null && <span> &middot; ${issue.cost.toFixed(2)}</span>}
            {issue.duration != null && <span> &middot; {formatDuration(issue.duration)}</span>}
          </div>
        </div>
        {issue.prUrl && (
          <a
            href={issue.prUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="flex items-center gap-1 text-[10px] text-violet-400 hover:text-violet-300 shrink-0"
          >
            <GitPullRequest size={11} />
            PR
            <ExternalLink size={9} />
          </a>
        )}
      </button>
      {expanded && (
        <div className="px-3 pb-3 space-y-2 border-t border-stone-800/30">
          {issue.body && (
            <div className="mt-2">
              <div className="text-[10px] text-stone-500 mb-1">Description</div>
              <pre className="text-[10px] text-stone-400 whitespace-pre-wrap font-mono bg-stone-800/30 p-2 rounded max-h-32 overflow-auto">
                {issue.body.slice(0, 1000)}
              </pre>
            </div>
          )}
          {issue.error && (
            <div>
              <div className="text-[10px] text-red-500 mb-1">Error</div>
              <pre className="text-[10px] text-red-400 whitespace-pre-wrap font-mono bg-red-950/20 p-2 rounded">
                {issue.error}
              </pre>
            </div>
          )}
          <div className="flex flex-wrap gap-1">
            {issue.labels.map((l) => (
              <span key={l} className="text-[10px] px-1.5 py-0.5 rounded bg-stone-800/60 text-stone-400 border border-stone-700/30">{l}</span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
