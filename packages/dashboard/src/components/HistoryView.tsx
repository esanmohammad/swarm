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
        pipeline history ({entries.length})
      </div>

      {entries.map((entry) => {
        const hasError = Object.values(entry.stagesSummary).some((s) => s === 'error');

        return (
          <div
            key={entry.runId}
            className="border border-stone-800/60 rounded-md bg-[#111010] px-4 py-3 hover:border-stone-700/60 transition-colors"
          >
            {/* Top row: timestamp + project + stack */}
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
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

            {/* Feature request */}
            {entry.featureRequest && (
              <p className="text-[11px] text-stone-400 mb-2 truncate font-mono" title={entry.featureRequest}>
                {entry.featureRequest.length > 120
                  ? entry.featureRequest.slice(0, 120) + '...'
                  : entry.featureRequest}
              </p>
            )}

            {/* Bottom row: stage dots + cost + duration */}
            <div className="flex items-center justify-between">
              {/* Stage summary dots */}
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
