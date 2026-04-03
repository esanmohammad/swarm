import { useEffect, useMemo } from 'react';
import {
  CheckCircle2, XCircle, Clock, DollarSign, RotateCcw,
  Sparkles, Wrench, GitPullRequest, Search, RefreshCw, Minimize2, Zap,
} from 'lucide-react';
import { OutputPanel } from '../output/OutputPanel';
import type { HistoryEntry, AgentActivity, WsCommand, Agent } from '../../types';

const TYPE_META: Record<string, { icon: typeof Sparkles; color: string; label: string }> = {
  pipeline: { icon: Sparkles, color: 'var(--activity-pipeline)', label: 'Build Feature' },
  fix: { icon: Wrench, color: 'var(--activity-fix)', label: 'Bug Fix' },
  review: { icon: GitPullRequest, color: 'var(--activity-review)', label: 'Code Review' },
  spike: { icon: Search, color: 'var(--activity-spike)', label: 'Research' },
  refactor: { icon: RefreshCw, color: 'var(--activity-refactor)', label: 'Refactor' },
  simplify: { icon: Minimize2, color: 'var(--activity-simplify)', label: 'Clean Up' },
};

interface HistoryCanvasProps {
  entry: HistoryEntry;
  agentOutputs: Map<string, string>;
  agentActivities: Map<string, AgentActivity[]>;
  sendCommand: (cmd: WsCommand) => void;
}

function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${m}m ${rem}s`;
}

export function HistoryCanvas({ entry, agentOutputs, agentActivities, sendCommand }: HistoryCanvasProps) {
  const agentId = entry.agentIds?.[0];

  // Request agent logs when viewing a history entry
  useEffect(() => {
    if (agentId) {
      sendCommand({ action: 'get-agent-log', agentId } as WsCommand);
    }
  }, [agentId, sendCommand]);

  const meta = TYPE_META[entry.activityType || 'pipeline'] || TYPE_META.pipeline;
  const Icon = meta.icon;
  const isSuccess = entry.activityStatus === 'success';
  const isError = entry.activityStatus === 'error';

  // Build a synthetic agent object for OutputPanel
  const syntheticAgent: Agent | null = useMemo(() => {
    if (!agentId) return null;
    return {
      id: agentId,
      name: entry.summary || entry.featureRequest || entry.projectName,
      persona: 'engineer' as const,
      stack: entry.stack,
      status: isError ? 'error' as const : 'done' as const,
      pid: null,
      sessionId: '',
      model: entry.model || 'unknown',
      permissionMode: 'auto' as const,
      startedAt: entry.timestamp,
      finishedAt: entry.timestamp + (entry.durationMs ?? 0),
      cost: entry.totalCost,
      output: agentOutputs.get(agentId) || '',
      error: null,
      parentId: null,
      childIds: [],
    };
  }, [agentId, entry, isError, agentOutputs]);

  const activities = agentId ? (agentActivities.get(agentId) || []) : [];
  const output = agentId ? (agentOutputs.get(agentId) || '') : '';

  return (
    <div className="flex flex-col h-full">
      {/* Status header */}
      <div
        className="px-4 py-3 shrink-0"
        style={{
          backgroundColor: 'var(--bg-surface)',
          borderBottom: '1px solid var(--border-muted)',
        }}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {/* Type badge */}
            <span
              className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium uppercase tracking-wider"
              style={{
                backgroundColor: isSuccess ? 'var(--status-success-bg)' : isError ? 'var(--status-error-bg)' : 'var(--bg-subtle)',
                color: isSuccess ? 'var(--status-success)' : isError ? 'var(--status-error)' : 'var(--text-tertiary)',
              }}
            >
              {isSuccess ? <CheckCircle2 size={10} /> : isError ? <XCircle size={10} /> : <Clock size={10} />}
              {isSuccess ? 'Success' : isError ? 'Error' : 'Done'}
            </span>
            {/* Activity type */}
            <span
              className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium"
              style={{ backgroundColor: 'var(--bg-subtle)', color: meta.color }}
            >
              <Icon size={10} />
              {meta.label}
            </span>
            {/* Name */}
            <span className="text-sm font-medium truncate max-w-md" style={{ color: 'var(--text-primary)' }}>
              {entry.summary || entry.featureRequest || entry.projectName}
            </span>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            {entry.totalCost?.totalUsd > 0 && (
              <span className="flex items-center gap-1 text-xs font-code tabular-nums" style={{ color: 'var(--text-secondary)' }}>
                <DollarSign size={10} />
                {entry.totalCost.totalUsd.toFixed(2)}
              </span>
            )}
            {entry.durationMs != null && entry.durationMs > 0 && (
              <span className="flex items-center gap-1 text-xs font-code tabular-nums" style={{ color: 'var(--text-tertiary)' }}>
                <Clock size={10} />
                {formatDuration(entry.durationMs)}
              </span>
            )}
            <span className="text-[10px] tabular-nums font-code" style={{ color: 'var(--text-disabled)' }}>
              {new Date(entry.timestamp).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
            </span>

            {/* Run Again button */}
            {entry.featureRequest && entry.activityType === 'pipeline' && (
              <button
                onClick={() => sendCommand({ action: 'run-mayday', prompt: entry.featureRequest! })}
                className="flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium transition-colors"
                style={{ backgroundColor: 'var(--accent-muted)', color: 'var(--accent)', border: '1px solid var(--border-muted)' }}
              >
                <RotateCcw size={10} />
                Run Again
              </button>
            )}
          </div>
        </div>

        {/* Stage summary for pipeline entries */}
        {entry.stageBreakdowns && entry.stageBreakdowns.length > 0 && (
          <div className="flex items-center gap-1 mt-2">
            {entry.stageBreakdowns.map((sb) => (
              <span
                key={sb.name}
                className="px-2 py-0.5 rounded text-[10px] capitalize"
                style={{
                  backgroundColor: sb.status === 'done' ? 'var(--status-success-bg)' : sb.status === 'error' ? 'var(--status-error-bg)' : 'var(--bg-subtle)',
                  color: sb.status === 'done' ? 'var(--status-success)' : sb.status === 'error' ? 'var(--status-error)' : 'var(--text-disabled)',
                }}
              >
                {sb.name}
                {sb.cost > 0 && <span className="ml-1 opacity-60">${sb.cost.toFixed(2)}</span>}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Output panel */}
      <div className="flex-1 min-h-0">
        {syntheticAgent ? (
          <OutputPanel
            agent={syntheticAgent}
            liveOutput={output}
            activities={activities}
            onSendInput={(id, text) => {
              sendCommand({ action: 'send-input', agentId: id, text });
            }}
          />
        ) : (
          <div className="flex items-center justify-center h-full">
            <div className="text-center space-y-2">
              <Zap size={28} className="mx-auto opacity-15" style={{ color: 'var(--text-tertiary)' }} />
              <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                No agent output available for this entry
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
