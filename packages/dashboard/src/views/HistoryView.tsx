import { useEffect } from 'react';
import { Clock, DollarSign, Timer } from 'lucide-react';
import type { HistoryEntry, WsCommand, StageName } from '../types';

const STAGE_ORDER: StageName[] = ['analyze', 'architect', 'plan', 'build', 'test'];

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

const STATUS_DOT: Record<string, string> = {
  done: 'bg-green-500',
  error: 'bg-red-500',
  skipped: 'bg-stone-600',
  pending: 'bg-stone-700',
};

interface HistoryViewProps {
  entries: HistoryEntry[];
  sendCommand: (cmd: WsCommand) => void;
}

export function HistoryView({ entries, sendCommand }: HistoryViewProps) {
  useEffect(() => {
    sendCommand({ action: 'get-history' });
  }, [sendCommand]);

  if (entries.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center text-stone-500">
          <Clock size={36} className="mx-auto mb-3 opacity-20" />
          <p className="text-sm">No pipeline runs yet</p>
          <p className="text-xs text-stone-600 mt-1">Start a build to see history here</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="max-w-3xl mx-auto space-y-3">
        <h2 className="text-sm font-semibold text-stone-300 mb-4">Pipeline History</h2>

        {entries.map((entry) => {
          const hasError = Object.values(entry.stagesSummary).some((s) => s === 'error');
          const allDone = STAGE_ORDER.every(
            (s) => entry.stagesSummary[s] === 'done' || entry.stagesSummary[s] === 'skipped'
          );

          return (
            <div
              key={entry.runId}
              className="border border-stone-800/50 rounded-lg bg-stone-900/30 px-5 py-4 hover:border-stone-700/50 transition-colors"
            >
              {/* Top row */}
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-3">
                  <div className={`w-2.5 h-2.5 rounded-full ${hasError ? 'bg-red-500' : allDone ? 'bg-green-500' : 'bg-stone-600'}`} />
                  <span className="text-sm text-stone-200">{entry.projectName}</span>
                  <span className="text-xs text-stone-500">:{entry.stack}</span>
                </div>
                <span className="text-xs text-stone-500">{formatTimestamp(entry.timestamp)}</span>
              </div>

              {/* Feature request */}
              {entry.featureRequest && (
                <p className="text-xs text-stone-400 mb-3 ml-5.5" title={entry.featureRequest}>
                  {entry.featureRequest.length > 150
                    ? entry.featureRequest.slice(0, 150) + '...'
                    : entry.featureRequest}
                </p>
              )}

              {/* Bottom row: stages + stats */}
              <div className="flex items-center justify-between ml-5.5">
                <div className="flex items-center gap-2">
                  {STAGE_ORDER.map((stage) => {
                    const status = entry.stagesSummary[stage] ?? 'pending';
                    return (
                      <div key={stage} className="flex items-center gap-1" title={`${stage}: ${status}`}>
                        <span className={`w-2 h-2 rounded-full ${STATUS_DOT[status] ?? STATUS_DOT.pending}`} />
                        <span className="text-[10px] text-stone-600">{stage.slice(0, 3)}</span>
                      </div>
                    );
                  })}
                </div>

                <div className="flex items-center gap-4 text-[11px] text-stone-500">
                  <span className="flex items-center gap-1 font-mono">
                    <DollarSign size={11} />
                    {entry.totalCost.totalUsd.toFixed(2)}
                  </span>
                  <span className="flex items-center gap-1 font-mono">
                    <Timer size={11} />
                    {formatDuration(entry.durationMs)}
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
