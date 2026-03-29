import { Bot, DollarSign, Clock, FileText, AlertTriangle } from 'lucide-react';
import type { PipelineState, StageName } from '../types';

const STAGES: { key: StageName; label: string; artifact: string }[] = [
  { key: 'analyze', label: 'Analyze', artifact: 'REQUIREMENTS.md' },
  { key: 'architect', label: 'Architect', artifact: 'SPEC.md' },
  { key: 'plan', label: 'Plan', artifact: 'TASKS.md' },
  { key: 'build', label: 'Build', artifact: 'Code' },
  { key: 'evaluate', label: 'Evaluate', artifact: 'Report' },
];

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
    <div className="px-5 py-4 border-b border-stone-800/60 bg-[#0c0c0c]">
      {/* Stage pipeline */}
      <div className="flex items-center gap-1 mb-3">
        {STAGES.map((stage, i) => {
          const s = stages[stage.key];
          const isActive = s.status === 'running';

          return (
            <div key={stage.key} className="flex items-center">
              <div
                className={`px-4 py-2 rounded-md transition-all select-none ${
                  isActive
                    ? 'bg-red-950/40 ring-1 ring-red-700/50 gothic-glow'
                    : 'bg-transparent'
                }`}
              >
                <div className="flex items-center gap-2">
                  {isActive && <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />}
                  <span
                    className={`text-sm font-semibold tracking-wide uppercase ${
                      isActive ? 'text-red-400' : 'text-stone-500'
                    }`}
                  >
                    {stage.label}
                  </span>
                </div>
                {isActive && s.artifact && (
                  <div className="flex items-center gap-1 mt-0.5">
                    <FileText size={9} className="text-red-500/50" />
                    <span className="text-[10px] text-red-500/50">{s.artifact}</span>
                  </div>
                )}
              </div>
              {i < STAGES.length - 1 && (
                <div className="w-6 h-px mx-1 bg-stone-800/40" />
              )}
            </div>
          );
        })}

        {/* Spacer */}
        <div className="flex-1" />

        {/* Violations */}
        {violationCount > 0 && (
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-amber-950/20 ring-1 ring-amber-800/30">
            <AlertTriangle size={14} className="text-amber-600" />
            <span className="text-xs font-medium text-amber-500">{violationCount}</span>
          </div>
        )}
      </div>

      {/* Bottom stats row */}
      <div className="flex items-center gap-5 text-xs">
        <div className="flex items-center gap-2">
          <Bot size={13} className="text-stone-400" />
          {running > 0 && <span className="font-mono text-red-400">{running} running</span>}
          {done > 0 && <span className="font-mono text-stone-500">{done} done</span>}
          {errored > 0 && <span className="font-mono text-red-600">{errored} failed</span>}
          {agents.length === 0 && <span className="text-stone-500">no agents</span>}
        </div>

        <div className="w-px h-3 bg-stone-800/50" />

        <span className="flex items-center gap-1 font-mono text-amber-700" title="Total cost">
          <DollarSign size={11} />
          {totalCost.totalUsd.toFixed(4)}
        </span>

        {(totalCost.inputTokens > 0 || totalCost.outputTokens > 0) && (
          <span className="font-mono text-stone-400" title={`${totalCost.inputTokens.toLocaleString()} in / ${totalCost.outputTokens.toLocaleString()} out`}>
            {formatTokens(totalCost.inputTokens)}/{formatTokens(totalCost.outputTokens)}
          </span>
        )}

        {totalCost.durationMs > 0 && (
          <span className="flex items-center gap-1 font-mono text-stone-400" title="Total API time">
            <Clock size={10} />
            {formatDuration(totalCost.durationMs)}
          </span>
        )}
      </div>
    </div>
  );
}
