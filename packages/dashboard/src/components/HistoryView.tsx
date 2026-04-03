import { useEffect } from 'react';
import { Clock, DollarSign, Timer } from 'lucide-react';
import type { HistoryEntry, WsCommand, StageName } from '../types';

const STAGE_ORDER: StageName[] = ['analyze', 'architect', 'plan', 'build', 'test', 'evaluate'];

const STATUS_COLORS: Record<string, string> = {
  done: 'bg-green-500',
  error: 'bg-red-500',
  skipped: 'bg-stone-600',
  pending: 'bg-stone-700',
};

function formatDuration(ms: number): string {
  const secs = Math.floor(ms / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  const remSecs = secs % 60;
  if (mins < 60) return `${mins}m ${remSecs}s`;
  const hours = Math.floor(mins / 60);
  const remMins = mins % 60;
  return `${hours}h ${remMins}m`;
}

function formatTimestamp(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

interface HistoryViewProps {
  entries: HistoryEntry[];
  sendCommand: (cmd: WsCommand) => void;
}

export function HistoryView({ entries, sendCommand }: HistoryViewProps) {
  // Request history on mount
  useEffect(() => {
    sendCommand({ action: 'get-history' });
  }, [sendCommand]);

  if (entries.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-stone-500">
        <div className="text-center">
          <Clock size={32} className="mx-auto mb-3 opacity-30" />
          <p className="text-xs font-mono">no pipeline history</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-2">
      <div className="text-xs font-ui text-stone-400 font-medium tracking-widest uppercase mb-3 px-1">
        activity history ({entries.length})
      </div>

      {entries.map((entry) => {
        const type = entry.activityType || 'pipeline';
        const isPipeline = type === 'pipeline';
        const hasError = entry.activityStatus === 'error' || (!entry.activityStatus && Object.values(entry.stagesSummary).some((s) => s === 'error'));
        const label = entry.summary || entry.featureRequest || `${type} run`;

        const TYPE_BADGE: Record<string, { label: string; color: string }> = {
          pipeline: { label: 'Pipeline', color: 'bg-blue-500/20 text-blue-300 border-blue-500/30' },
          fix: { label: 'Fix', color: 'bg-amber-500/20 text-amber-300 border-amber-500/30' },
          review: { label: 'Review', color: 'bg-purple-500/20 text-purple-300 border-purple-500/30' },
          spike: { label: 'Spike', color: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/30' },
          refactor: { label: 'Refactor', color: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30' },
          simplify: { label: 'Simplify', color: 'bg-teal-500/20 text-teal-300 border-teal-500/30' },
          'test-gen': { label: 'Test Gen', color: 'bg-pink-500/20 text-pink-300 border-pink-500/30' },
          learn: { label: 'Learn', color: 'bg-indigo-500/20 text-indigo-300 border-indigo-500/30' },
          pr: { label: 'PR', color: 'bg-orange-500/20 text-orange-300 border-orange-500/30' },
          check: { label: 'Check', color: 'bg-stone-500/20 text-stone-300 border-stone-500/30' },
        };
        const badge = TYPE_BADGE[type] || TYPE_BADGE.pipeline;

        return (
          <div
            key={entry.runId}
            className="border border-stone-800/60 rounded-md bg-[#111010] px-4 py-3 hover:border-stone-700/60 transition-colors"
          >
            {/* Top row: type badge + project + timestamp */}
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full border ${badge.color}`}>{badge.label}</span>
                <span className="text-xs text-stone-300 font-mono">
                  {entry.projectName}
                </span>
                <span className="text-[10px] text-stone-500 font-mono">
                  :{entry.stack}
                </span>
              </div>
              <span className="text-[10px] text-stone-500">
                {formatTimestamp(entry.timestamp)}
              </span>
            </div>

            {/* Summary / feature request */}
            <p className="text-[11px] text-stone-400 mb-2 truncate font-mono" title={label}>
              {label.length > 120 ? label.slice(0, 120) + '...' : label}
            </p>

            {/* Bottom row: stage dots (pipeline only) + cost + duration */}
            <div className="flex items-center justify-between">
              {/* Stage summary dots — only for pipeline runs */}
              {isPipeline ? (
                <div className="flex items-center gap-1.5">
                  {STAGE_ORDER.map((stage) => {
                    const status = entry.stagesSummary[stage] ?? 'pending';
                    return (
                      <div key={stage} className="flex items-center gap-0.5" title={`${stage}: ${status}`}>
                        <span
                          className={`w-2 h-2 rounded-full ${STATUS_COLORS[status] ?? STATUS_COLORS.pending}`}
                        />
                        <span className="text-[10px] text-stone-500">{stage.slice(0, 3)}</span>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="flex items-center gap-1">
                  {hasError ? (
                    <span className="text-[10px] text-red-400">Failed</span>
                  ) : (
                    <span className="text-[10px] text-green-400">Completed</span>
                  )}
                </div>
              )}

              {/* Cost + duration */}
              <div className="flex items-center gap-3">
                {hasError && (
                  <span className="text-[10px] text-red-500/80 font-mono">err</span>
                )}
                <div className="flex items-center gap-1 text-xs text-stone-400">
                  <DollarSign size={10} />
                  <span className="font-mono">{entry.totalCost.totalUsd.toFixed(2)}</span>
                </div>
                <div className="flex items-center gap-1 text-xs text-stone-400">
                  <Timer size={10} />
                  <span className="font-mono">{formatDuration(entry.durationMs)}</span>
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
