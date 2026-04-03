import { useMemo } from 'react';
import { DollarSign, TrendingDown } from 'lucide-react';
import type { ModelInfo } from '../types';

interface CostEstimatorProps {
  stageModels: Record<string, string>;
  models: ModelInfo[];
}

// Rough estimate: tokens per stage for a typical pipeline run
const STAGE_TOKEN_ESTIMATES: Record<string, { input: number; output: number }> = {
  analyst:   { input: 8000,   output: 4000 },
  architect: { input: 12000,  output: 6000 },
  lead:      { input: 10000,  output: 5000 },
  engineer:  { input: 50000,  output: 20000 },
  tester:    { input: 20000,  output: 8000 },
};

function estimateCost(stageModels: Record<string, string>, models: ModelInfo[]): number {
  let total = 0;
  for (const [stage, modelId] of Object.entries(stageModels)) {
    const model = models.find(m => m.id === modelId || m.fullId === modelId);
    const tokens = STAGE_TOKEN_ESTIMATES[stage] ?? { input: 10000, output: 5000 };
    if (model) {
      total += (tokens.input / 1_000_000) * model.costPer1MInput;
      total += (tokens.output / 1_000_000) * model.costPer1MOutput;
    }
  }
  return total;
}

function findModelByTag(models: ModelInfo[], tag: string): ModelInfo | undefined {
  return models.find(m => m.tags.includes(tag)) || models.find(m => m.name.toLowerCase().includes(tag.toLowerCase()));
}

export function CostEstimator({ stageModels, models }: CostEstimatorProps) {
  const estimates = useMemo(() => {
    const current = estimateCost(stageModels, models);

    // All Sonnet scenario
    const sonnet = findModelByTag(models, 'sonnet') ?? models.find(m => m.name.toLowerCase().includes('sonnet'));
    const allSonnet: Record<string, string> = {};
    if (sonnet) {
      for (const stage of Object.keys(STAGE_TOKEN_ESTIMATES)) allSonnet[stage] = sonnet.id;
    }
    const sonnetCost = sonnet ? estimateCost(allSonnet, models) : null;

    // All local (free) scenario
    const local = models.find(m => m.costPer1MInput === 0 && m.costPer1MOutput === 0);
    const allLocal: Record<string, string> = {};
    if (local) {
      for (const stage of Object.keys(STAGE_TOKEN_ESTIMATES)) allLocal[stage] = local.id;
    }
    const localCost = local ? estimateCost(allLocal, models) : null;

    return { current, sonnetCost, localCost };
  }, [stageModels, models]);

  const formatCost = (n: number) => n < 0.01 ? '<$0.01' : `$${n.toFixed(2)}`;

  const scenarios = [
    { label: 'Current mix', cost: estimates.current, color: 'bg-blue-500' },
    ...(estimates.sonnetCost != null ? [{ label: 'All Claude Sonnet', cost: estimates.sonnetCost, color: 'bg-amber-500' }] : []),
    ...(estimates.localCost != null ? [{ label: 'All local (free)', cost: estimates.localCost, color: 'bg-green-500' }] : []),
  ];

  const maxCost = Math.max(...scenarios.map(s => s.cost), 0.01);

  const savings = estimates.localCost != null && estimates.current > 0
    ? Math.round(((estimates.current - estimates.localCost) / estimates.current) * 100)
    : null;

  return (
    <div className="rounded-lg bg-stone-900/40 border border-stone-800/40 p-4">
      <div className="flex items-center gap-2 mb-3">
        <DollarSign size={14} className="text-green-400" />
        <h3 className="text-xs font-medium text-stone-300">Cost Comparison</h3>
        <span className="text-[10px] text-stone-600">Estimated per pipeline run</span>
      </div>

      <div className="space-y-2.5">
        {scenarios.map(s => (
          <div key={s.label}>
            <div className="flex items-center justify-between mb-1">
              <span className="text-[10px] text-stone-400">{s.label}</span>
              <span className="text-xs font-medium text-stone-300">{formatCost(s.cost)}</span>
            </div>
            <div className="h-2 rounded-full bg-stone-800/60 overflow-hidden">
              <div
                className={`h-full rounded-full ${s.color} transition-all duration-300`}
                style={{ width: `${Math.max((s.cost / maxCost) * 100, 2)}%` }}
              />
            </div>
          </div>
        ))}
      </div>

      {savings != null && savings > 0 && (
        <div className="mt-3 flex items-center gap-1.5 text-[10px] text-green-400">
          <TrendingDown size={11} />
          <span>Switch to local models to save ~{savings}%</span>
        </div>
      )}
    </div>
  );
}
