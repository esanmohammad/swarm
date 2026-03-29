import { Bot, DollarSign, Clock, FileText, AlertTriangle, CheckCircle, Loader2, XCircle, Circle } from 'lucide-react';
import type { PipelineState, StageName } from '../types';

const STAGES: { key: StageName; label: string; artifact: string }[] = [
  { key: 'analyze', label: 'Analyze', artifact: 'REQUIREMENTS.md' },
  { key: 'architect', label: 'Architect', artifact: 'SPEC.md' },
  { key: 'plan', label: 'Plan', artifact: 'TASKS.md' },
  { key: 'build', label: 'Build', artifact: 'Code' },
  { key: 'evaluate', label: 'Evaluate', artifact: 'Report' },
];

const STATUS_ICON = {
  pending: { Icon: Circle, color: 'text-gray-600', glow: '' },
  running: { Icon: Loader2, color: 'text-cyan-400', glow: 'drop-shadow-[0_0_6px_rgba(34,211,238,0.4)]' },
  done: { Icon: CheckCircle, color: 'text-green-400', glow: '' },
  error: { Icon: XCircle, color: 'text-red-400', glow: '' },
  skipped: { Icon: Circle, color: 'text-gray-700', glow: '' },
};

function formatTokens(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
  return `${(n / 1_000_000).toFixed(2)}M`;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(0)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

export function TopBar({ pipeline, violationCount }: { pipeline: PipelineState; violationCount: number }) {
  const { agents, totalCost, stages } = pipeline;

  const running = agents.filter((a) => a.status === 'running').length;
  const done = agents.filter((a) => a.status === 'done').length;
  const errored = agents.filter((a) => a.status === 'error').length;

  return (
    <div className="px-4 py-2.5 border-b border-gray-800 bg-gray-900/80 backdrop-blur">
      <div className="flex items-center gap-4">

        {/* Stage indicators — always visible */}
        <div className="flex items-center gap-1">
          {STAGES.map((stage, i) => {
            const s = stages[stage.key];
            const { Icon, color, glow } = STATUS_ICON[s.status];
            const isRunning = s.status === 'running';
            const isDone = s.status === 'done';
            const isPending = s.status === 'pending';

            return (
              <div key={stage.key} className="flex items-center">
                <div
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md transition-all ${
                    isRunning ? 'bg-cyan-950/50 ring-1 ring-cyan-500/30' :
                    isDone ? 'bg-green-950/30' :
                    'bg-transparent'
                  }`}
                  title={`${stage.label}: ${s.status}${s.artifact ? ` → ${s.artifact}` : ''}`}
                >
                  <Icon
                    size={13}
                    className={`${color} ${glow} ${isRunning ? 'animate-spin' : ''}`}
                  />
                  <span className={`text-xs font-medium ${
                    isRunning ? 'text-cyan-300' :
                    isDone ? 'text-green-400' :
                    isPending ? 'text-gray-600' :
                    color
                  }`}>
                    {stage.label}
                  </span>
                </div>
                {i < STAGES.length - 1 && (
                  <div className={`w-3 h-px mx-0.5 ${
                    isDone ? 'bg-green-700' : 'bg-gray-800'
                  }`} />
                )}
              </div>
            );
          })}
        </div>

        {/* Divider */}
        <div className="w-px h-5 bg-gray-700" />

        {/* Agent counts */}
        <div className="flex items-center gap-2.5">
          <div className="flex items-center gap-1" title={`${agents.length} total agents`}>
            <Bot size={13} className={running > 0 ? 'text-cyan-400' : 'text-gray-600'} />
            {running > 0 && <span className="text-xs font-mono text-cyan-400">{running}</span>}
            {done > 0 && <span className="text-xs font-mono text-green-500">{done}</span>}
            {errored > 0 && <span className="text-xs font-mono text-red-400">{errored}</span>}
            {agents.length === 0 && <span className="text-xs text-gray-600">0</span>}
          </div>
        </div>

        {/* Divider */}
        <div className="w-px h-5 bg-gray-700" />

        {/* Cost + tokens + time */}
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1 text-xs font-mono text-amber-400" title="Total cost">
            <DollarSign size={12} />
            {totalCost.totalUsd.toFixed(4)}
          </span>
          {(totalCost.inputTokens > 0 || totalCost.outputTokens > 0) && (
            <span className="text-xs font-mono text-gray-500" title={`${totalCost.inputTokens.toLocaleString()} in / ${totalCost.outputTokens.toLocaleString()} out`}>
              {formatTokens(totalCost.inputTokens)}/{formatTokens(totalCost.outputTokens)}
            </span>
          )}
          {totalCost.durationMs > 0 && (
            <span className="flex items-center gap-1 text-xs font-mono text-gray-500" title="Total API time">
              <Clock size={10} />
              {formatDuration(totalCost.durationMs)}
            </span>
          )}
        </div>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Artifacts produced */}
        {Object.values(stages).some((s) => s.artifact) && (
          <div className="flex items-center gap-1.5">
            {STAGES.map((stage) => {
              const a = stages[stage.key].artifact;
              if (!a) return null;
              return (
                <span
                  key={a}
                  className="flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded bg-gray-800/80 text-gray-400 border border-gray-700/50"
                >
                  <FileText size={9} />
                  {a}
                </span>
              );
            })}
          </div>
        )}

        {/* Violations badge */}
        {violationCount > 0 && (
          <div className="flex items-center gap-1 text-amber-400" title={`${violationCount} guardrail violations`}>
            <AlertTriangle size={13} />
            <span className="text-xs font-medium">{violationCount}</span>
          </div>
        )}
      </div>
    </div>
  );
}
