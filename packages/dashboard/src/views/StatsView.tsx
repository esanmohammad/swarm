import { useState, useEffect } from 'react';
import { TrendingUp, AlertTriangle } from 'lucide-react';
import type { WsCommand } from '../types';
import { FeatureGuide } from '../components/FeatureGuide';
import { StateView } from '../components/StateView';

interface StatsData {
  totalRuns: number;
  passed: number;
  failed: number;
  successRate: number;
  totalCost: number;
  avgCostPerRun: number;
  avgDurationMs: number;
  avgFixIterations: number;
  stageCosts: Array<{ stage: string; totalCost: number; avgCost: number; avgDurationMs: number; count: number }>;
  weeklySpend: Array<{ week: string; cost: number; runs: number }>;
  recommendations: string[];
}

interface StatsViewProps {
  sendCommand: (cmd: WsCommand) => void;
  stats: StatsData | null;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(0)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

export function StatsView({ sendCommand, stats }: StatsViewProps) {
  const [period, setPeriod] = useState(30);

  useEffect(() => {
    sendCommand({ action: 'get-stats', period } as WsCommand);
  }, [period]);

  if (!stats) {
    return (
      <div className="flex-1 flex flex-col p-6">
        <FeatureGuide
          featureId="stats"
          title="Cost Intelligence"
          description="Track spending across pipeline runs. See cost breakdown by stage, weekly trends, and get optimization recommendations."
          hasData={false}
          cliCommands={[
            { command: 'swarm stats', description: 'View pipeline cost statistics' },
            { command: 'swarm stats --period 7', description: 'View stats for the last 7 days' },
          ]}
        />
        <div className="flex-1 flex items-center justify-center">
          <StateView
            status="loading"
            title="Loading stats"
            message="Fetching pipeline statistics..."
          />
        </div>
      </div>
    );
  }

  if (stats.totalRuns === 0) {
    return (
      <div className="flex-1 flex flex-col p-6">
        <FeatureGuide
          featureId="stats"
          title="Cost Intelligence"
          description="Track spending across pipeline runs. See cost breakdown by stage, weekly trends, and get optimization recommendations."
          hasData={false}
          cliCommands={[
            { command: 'swarm stats', description: 'View pipeline cost statistics' },
            { command: 'swarm stats --period 7', description: 'View stats for the last 7 days' },
          ]}
        />
        <div className="flex-1 flex items-center justify-center">
          <StateView
            status="empty"
            title="No stats yet"
            message="No stats yet. Run a pipeline first — costs and performance are tracked automatically."
          />
        </div>
      </div>
    );
  }

  const maxStageCost = Math.max(...stats.stageCosts.map(s => s.totalCost), 0.01);
  const maxWeeklyCost = Math.max(...stats.weeklySpend.map(w => w.cost), 0.01);

  return (
    <div className="flex-1 flex flex-col p-6 overflow-auto">
      <div className="max-w-5xl w-full mx-auto space-y-6">
        <FeatureGuide
          featureId="stats"
          title="Cost Intelligence"
          description="Track spending across pipeline runs. See cost breakdown by stage, weekly trends, and get optimization recommendations."
          hasData={true}
          cliCommands={[
            { command: 'swarm stats', description: 'View pipeline cost statistics' },
            { command: 'swarm stats --period 7', description: 'View stats for the last 7 days' },
          ]}
        />

        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <TrendingUp size={18} className="text-amber-400" />
            <h2 className="text-lg font-semibold text-stone-200">Cost Intelligence</h2>
          </div>
          <div className="flex items-center gap-1.5">
            {[7, 30, 90].map(d => (
              <button
                key={d}
                onClick={() => setPeriod(d)}
                className={`px-2.5 py-1 rounded text-[10px] font-medium border transition-colors ${
                  period === d
                    ? 'bg-blue-600/20 text-blue-300 border-blue-500/40'
                    : 'text-stone-400 border-stone-700/40 hover:border-stone-600/50'
                }`}
              >
                {d}d
              </button>
            ))}
          </div>
        </div>

        {/* Overview cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Card label="Total Runs" value={String(stats.totalRuns)} sub={`${stats.successRate}% success`} color="text-stone-200" />
          <Card label="Total Spend" value={`$${stats.totalCost.toFixed(2)}`} sub={`$${stats.avgCostPerRun.toFixed(2)} avg/run`} color="text-amber-400" />
          <Card label="Avg Duration" value={formatDuration(stats.avgDurationMs)} sub={`${stats.passed} passed, ${stats.failed} failed`} color="text-blue-400" />
          <Card label="Fix Iterations" value={stats.avgFixIterations.toFixed(1)} sub="avg per run" color="text-purple-400" />
        </div>

        {/* Stage costs */}
        {stats.stageCosts.length > 0 && (
          <div className="p-4 rounded-lg bg-stone-900/40 border border-stone-800/40">
            <h3 className="text-xs font-medium text-stone-400 uppercase tracking-wider mb-3">Cost by Stage</h3>
            <div className="space-y-2.5">
              {stats.stageCosts.map(sc => {
                const pct = stats.totalCost > 0 ? (sc.totalCost / stats.totalCost * 100) : 0;
                return (
                  <div key={sc.stage} className="flex items-center gap-3">
                    <span className="text-xs text-stone-300 w-20 shrink-0">{sc.stage}</span>
                    <div className="flex-1 h-4 bg-stone-800/60 rounded overflow-hidden">
                      <div
                        className="h-full bg-blue-500/40 rounded"
                        style={{ width: `${(sc.totalCost / maxStageCost) * 100}%` }}
                      />
                    </div>
                    <span className="text-xs text-amber-400 font-mono w-16 text-right">${sc.totalCost.toFixed(2)}</span>
                    <span className="text-[10px] text-stone-500 w-12 text-right">{pct.toFixed(0)}%</span>
                    <span className="text-[10px] text-stone-500 w-16 text-right">{formatDuration(sc.avgDurationMs)}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Weekly trend */}
        {stats.weeklySpend.length > 1 && (
          <div className="p-4 rounded-lg bg-stone-900/40 border border-stone-800/40">
            <h3 className="text-xs font-medium text-stone-400 uppercase tracking-wider mb-3">Weekly Spend</h3>
            <div className="space-y-2">
              {stats.weeklySpend.map(w => (
                <div key={w.week} className="flex items-center gap-3">
                  <span className="text-[10px] text-stone-400 font-mono w-20 shrink-0">{w.week}</span>
                  <div className="flex-1 h-3 bg-stone-800/60 rounded overflow-hidden">
                    <div
                      className="h-full bg-amber-500/40 rounded"
                      style={{ width: `${(w.cost / maxWeeklyCost) * 100}%` }}
                    />
                  </div>
                  <span className="text-xs text-amber-400 font-mono w-16 text-right">${w.cost.toFixed(2)}</span>
                  <span className="text-[10px] text-stone-500 w-14 text-right">{w.runs} runs</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Recommendations */}
        {stats.recommendations.length > 0 && (
          <div className="p-4 rounded-lg bg-amber-950/20 border border-amber-800/20">
            <div className="flex items-center gap-2 mb-3">
              <AlertTriangle size={14} className="text-amber-400" />
              <h3 className="text-xs font-medium text-amber-300 uppercase tracking-wider">Recommendations</h3>
            </div>
            <div className="space-y-2">
              {stats.recommendations.map((rec, i) => (
                <p key={i} className="text-xs text-stone-300 leading-relaxed">
                  {rec}
                </p>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Card({ label, value, sub, color }: { label: string; value: string; sub: string; color: string }) {
  return (
    <div className="p-3 rounded-lg bg-stone-900/40 border border-stone-800/40">
      <div className="text-[10px] text-stone-500 uppercase tracking-wider">{label}</div>
      <div className={`text-xl font-semibold ${color} mt-1`}>{value}</div>
      <div className="text-[10px] text-stone-500 mt-0.5">{sub}</div>
    </div>
  );
}
