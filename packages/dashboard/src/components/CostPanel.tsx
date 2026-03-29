import { DollarSign, Hash, Clock } from 'lucide-react';
import type { PipelineState } from '../types';

export function CostPanel({ pipeline }: { pipeline: PipelineState }) {
  const { totalCost, agents } = pipeline;

  const agentsByPersona = agents.reduce((acc, a) => {
    acc[a.persona] = (acc[a.persona] ?? 0) + a.cost.totalUsd;
    return acc;
  }, {} as Record<string, number>);

  const maxCost = Math.max(...Object.values(agentsByPersona), 0.001);

  return (
    <div className="p-4 space-y-4">
      <h3 className="text-[11px] font-semibold text-stone-400 uppercase tracking-widest">Cost</h3>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-2 text-sm text-stone-400">
            <DollarSign size={13} />
            Total
          </span>
          <span className="text-lg font-bold font-mono text-amber-700">
            ${totalCost.totalUsd.toFixed(4)}
          </span>
        </div>

        <div className="flex items-center justify-between text-xs text-stone-400">
          <span className="flex items-center gap-2">
            <Hash size={11} />
            Tokens
          </span>
          <span className="font-mono">{totalCost.inputTokens.toLocaleString()} / {totalCost.outputTokens.toLocaleString()}</span>
        </div>

        {totalCost.cacheReadTokens > 0 && (
          <div className="text-[10px] text-stone-400 text-right font-mono">
            Cache: {totalCost.cacheReadTokens.toLocaleString()} r / {totalCost.cacheWriteTokens.toLocaleString()} w
          </div>
        )}

        <div className="flex items-center justify-between text-xs text-stone-400">
          <span className="flex items-center gap-2">
            <Clock size={11} />
            API Time
          </span>
          <span className="font-mono">{(totalCost.durationMs / 1000).toFixed(1)}s</span>
        </div>
      </div>

      {Object.keys(agentsByPersona).length > 0 && (
        <div className="space-y-2 pt-3 border-t border-stone-800/40">
          <h4 className="text-[10px] font-semibold text-stone-400 uppercase tracking-widest">By Persona</h4>
          {Object.entries(agentsByPersona).map(([persona, cost]) => (
            <div key={persona} className="space-y-1">
              <div className="flex justify-between text-[10px]">
                <span className="text-stone-400 capitalize">{persona}</span>
                <span className="text-stone-400 font-mono">${cost.toFixed(4)}</span>
              </div>
              <div className="h-1 bg-stone-900 rounded-full overflow-hidden">
                <div
                  className="h-full bg-red-900/60 rounded-full transition-all"
                  style={{ width: `${(cost / maxCost) * 100}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="text-[10px] text-stone-400 pt-2 border-t border-stone-800/40 font-mono">
        {agents.length} agent{agents.length !== 1 ? 's' : ''} total
      </div>
    </div>
  );
}
