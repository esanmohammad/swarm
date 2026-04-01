import type { PipelineState } from '../types';

const EMPTY_COST = { totalUsd: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, durationMs: 0 };

export function CostPanel({ pipeline }: { pipeline: PipelineState }) {
  const totalCost = pipeline.totalCost ?? EMPTY_COST;
  const { agents } = pipeline;

  const agentsByPersona = agents.reduce((acc, a) => {
    acc[a.persona] = (acc[a.persona] ?? 0) + (a.cost?.totalUsd ?? 0);
    return acc;
  }, {} as Record<string, number>);

  const maxCost = Math.max(...Object.values(agentsByPersona), 0.001);

  const PERSONA_BAR_COLORS: Record<string, string> = {
    analyst: 'bg-purple-600/60',
    architect: 'bg-blue-600/60',
    lead: 'bg-amber-600/60',
    engineer: 'bg-red-600/60',
  };

  return (
    <div className="px-3 py-3 font-mono">
      {/* Total cost — prominent */}
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] text-stone-300 uppercase tracking-widest">cost</span>
        <span className="text-sm font-semibold text-amber-500 tabular-nums">
          ${totalCost.totalUsd.toFixed(4)}
        </span>
      </div>

      {/* Token breakdown */}
      <div className="text-[10px] text-stone-400 space-y-0.5 mb-3">
        <div className="flex justify-between">
          <span>in</span>
          <span className="text-stone-400 tabular-nums">{totalCost.inputTokens.toLocaleString()}</span>
        </div>
        <div className="flex justify-between">
          <span>out</span>
          <span className="text-stone-400 tabular-nums">{totalCost.outputTokens.toLocaleString()}</span>
        </div>
        {totalCost.cacheReadTokens > 0 && (
          <div className="flex justify-between">
            <span>cache</span>
            <span className="text-stone-400 tabular-nums">
              {totalCost.cacheReadTokens.toLocaleString()}r / {totalCost.cacheWriteTokens.toLocaleString()}w
            </span>
          </div>
        )}
        <div className="flex justify-between">
          <span>time</span>
          <span className="text-stone-400 tabular-nums">{(totalCost.durationMs / 1000).toFixed(1)}s</span>
        </div>
      </div>

      {/* Per-persona breakdown bars */}
      {Object.keys(agentsByPersona).length > 0 && (
        <div className="space-y-1.5 pt-2 border-t border-stone-800/40">
          {Object.entries(agentsByPersona).map(([persona, cost]) => (
            <div key={persona}>
              <div className="flex justify-between text-[10px] mb-0.5">
                <span className="text-stone-400">{persona}</span>
                <span className="text-stone-400 tabular-nums">${cost.toFixed(4)}</span>
              </div>
              <div className="h-1 bg-stone-800 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${PERSONA_BAR_COLORS[persona] ?? 'bg-stone-700'}`}
                  style={{ width: `${(cost / maxCost) * 100}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
