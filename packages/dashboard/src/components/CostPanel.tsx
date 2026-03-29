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
      <h3 className="text-sm font-semibold text-gray-300 uppercase tracking-wider">Cost Summary</h3>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-2 text-sm text-gray-400">
            <DollarSign size={14} />
            Total Cost
          </span>
          <span className="text-lg font-bold text-amber-400">
            ${totalCost.totalUsd.toFixed(4)}
          </span>
        </div>

        <div className="flex items-center justify-between text-sm text-gray-500">
          <span className="flex items-center gap-2">
            <Hash size={12} />
            Tokens
          </span>
          <span>{totalCost.inputTokens.toLocaleString()} in / {totalCost.outputTokens.toLocaleString()} out</span>
        </div>

        {totalCost.cacheReadTokens > 0 && (
          <div className="text-xs text-gray-600 text-right">
            Cache: {totalCost.cacheReadTokens.toLocaleString()} read / {totalCost.cacheWriteTokens.toLocaleString()} write
          </div>
        )}

        <div className="flex items-center justify-between text-sm text-gray-500">
          <span className="flex items-center gap-2">
            <Clock size={12} />
            API Time
          </span>
          <span>{(totalCost.durationMs / 1000).toFixed(1)}s</span>
        </div>
      </div>

      {Object.keys(agentsByPersona).length > 0 && (
        <div className="space-y-2 pt-2 border-t border-gray-800">
          <h4 className="text-xs font-semibold text-gray-500 uppercase">By Persona</h4>
          {Object.entries(agentsByPersona).map(([persona, cost]) => (
            <div key={persona} className="space-y-1">
              <div className="flex justify-between text-xs">
                <span className="text-gray-400 capitalize">{persona}</span>
                <span className="text-gray-300">${cost.toFixed(4)}</span>
              </div>
              <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden">
                <div
                  className="h-full bg-amber-500 rounded-full transition-all"
                  style={{ width: `${(cost / maxCost) * 100}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="text-xs text-gray-600 pt-2 border-t border-gray-800">
        {agents.length} agent(s) total
      </div>
    </div>
  );
}
