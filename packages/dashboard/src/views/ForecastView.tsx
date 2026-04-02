import { useState, useEffect } from 'react';
import {
  TrendingUp,
  BarChart3,
  DollarSign,
  AlertTriangle,
  Activity,
  Play,
  ArrowUpRight,
  ArrowDownRight,
  Minus,
} from 'lucide-react';
import type { WsCommand } from '../types';

interface VelocityData {
  current: number;
  predicted: number;
  confidence: number;
  history: Array<{ week: string; items: number }>;
}

interface CostEstimate {
  feature: string;
  estimatedCost: number;
  confidence: number;
  basis: string;
}

interface RiskItem {
  name: string;
  probability: number;
  impact: string;
  mitigation: string;
}

interface HealthProjection {
  metric: string;
  current: number;
  projected: number;
  timeframe: string;
  warning?: string;
}

interface ForecastData {
  velocity: VelocityData;
  costEstimates: CostEstimate[];
  risks: RiskItem[];
  healthProjection: HealthProjection[];
}

interface ForecastViewProps {
  sendCommand: (cmd: WsCommand) => void;
  forecastData: ForecastData | null;
}

function TrendArrow({ current, projected }: { current: number; projected: number }) {
  if (projected > current) return <ArrowUpRight size={12} className="text-emerald-400" />;
  if (projected < current) return <ArrowDownRight size={12} className="text-red-400" />;
  return <Minus size={12} className="text-stone-500" />;
}

function RiskBadge({ level }: { level: string }) {
  const styles: Record<string, string> = {
    low: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
    medium: 'bg-amber-500/20 text-amber-300 border-amber-500/30',
    high: 'bg-red-500/20 text-red-300 border-red-500/30',
  };
  return (
    <span className={`inline-flex px-1.5 py-0.5 rounded text-[10px] font-medium border ${styles[level] ?? 'bg-stone-700 text-stone-300 border-stone-600'}`}>
      {level.toUpperCase()}
    </span>
  );
}

export function ForecastView({ sendCommand, forecastData }: ForecastViewProps) {
  const [costInput, setCostInput] = useState('');

  useEffect(() => {
    sendCommand({ action: 'get-forecast' } as WsCommand);
  }, []);

  const handleRunForecast = () => {
    sendCommand({ action: 'run-forecast', scope: costInput.trim() || undefined } as WsCommand);
  };

  if (!forecastData) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center">
          <TrendingUp size={36} className="text-stone-600 mx-auto mb-3" />
          <p className="text-sm text-stone-400">Loading forecast data...</p>
        </div>
      </div>
    );
  }

  const { velocity, costEstimates, risks, healthProjection } = forecastData;
  const maxVelocity = Math.max(...velocity.history.map(v => v.items), velocity.predicted, 1);

  return (
    <div className="flex-1 flex flex-col p-6 overflow-auto">
      <div className="max-w-5xl w-full mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <TrendingUp size={18} className="text-cyan-400" />
            <h2 className="text-lg font-semibold text-stone-200">Forecast</h2>
          </div>
          <button
            onClick={handleRunForecast}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium bg-cyan-600/20 text-cyan-300 border border-cyan-500/30 hover:bg-cyan-600/30 transition-colors"
          >
            <Play size={12} />
            Run Forecast
          </button>
        </div>

        {/* Velocity chart */}
        <div className="space-y-2">
          <div className="flex items-center gap-1.5">
            <BarChart3 size={14} className="text-blue-400" />
            <h3 className="text-xs font-semibold text-stone-400 uppercase tracking-wider">Velocity</h3>
          </div>
          <div className="p-4 rounded-lg bg-stone-800/40 border border-stone-700/40">
            <div className="flex items-end gap-2 h-32">
              {velocity.history.map((v, i) => (
                <div key={i} className="flex-1 flex flex-col items-center gap-1">
                  <div className="w-full flex gap-0.5 items-end" style={{ height: '100%' }}>
                    <div
                      className="flex-1 bg-blue-500/60 rounded-t transition-all"
                      style={{ height: `${(v.items / maxVelocity) * 100}%` }}
                    />
                  </div>
                  <span className="text-[8px] text-stone-600 truncate w-full text-center">{v.week}</span>
                </div>
              ))}
            </div>
            <div className="flex items-center gap-4 mt-3">
              <div className="flex items-center gap-1.5">
                <div className="w-3 h-2 bg-blue-500/60 rounded" />
                <span className="text-[10px] text-stone-500">Actual</span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="w-3 h-2 bg-cyan-400/30 border border-cyan-400/50 border-dashed rounded" />
                <span className="text-[10px] text-stone-500">Predicted</span>
              </div>
            </div>
          </div>
        </div>

        {/* Cost estimation */}
        <div className="space-y-2">
          <div className="flex items-center gap-1.5">
            <DollarSign size={14} className="text-green-400" />
            <h3 className="text-xs font-semibold text-stone-400 uppercase tracking-wider">Cost Estimates</h3>
          </div>
          <div className="flex gap-2 mb-2">
            <input
              type="text"
              value={costInput}
              onChange={e => setCostInput(e.target.value)}
              placeholder="Scope for cost estimate (optional)..."
              className="flex-1 px-3 py-2 bg-stone-900/60 border border-stone-700/50 rounded-lg text-xs text-stone-200 placeholder-stone-500 focus:border-cyan-600 focus:outline-none focus:ring-1 focus:ring-cyan-600/30"
            />
          </div>
          <div className="space-y-2">
            {costEstimates.map((ce, i) => (
              <div key={i} className="flex items-center gap-3 p-3 bg-stone-800/40 rounded-lg border border-stone-700/40">
                <span className="text-xs text-stone-300 flex-1">{ce.feature}</span>
                <span className="text-xs font-medium text-green-400">${ce.estimatedCost.toFixed(2)}</span>
                <div className="flex items-center gap-1">
                  <div className="w-12 h-1.5 bg-stone-700 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-green-500 rounded-full"
                      style={{ width: `${ce.confidence * 100}%` }}
                    />
                  </div>
                  <span className="text-[10px] text-stone-500">{Math.round(ce.confidence * 100)}%</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Risk radar */}
        <div className="space-y-2">
          <div className="flex items-center gap-1.5">
            <AlertTriangle size={14} className="text-amber-400" />
            <h3 className="text-xs font-semibold text-stone-400 uppercase tracking-wider">Risk Radar</h3>
          </div>
          {risks.length === 0 ? (
            <div className="text-center py-6">
              <p className="text-xs text-stone-500">No risks identified.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {risks.map((risk, i) => (
                <div key={i} className="p-3 bg-stone-800/40 rounded-lg border border-stone-700/40 space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-stone-300 flex-1">{risk.name}</span>
                    <span className="text-[10px] text-stone-500">P: {Math.round(risk.probability * 100)}%</span>
                    <RiskBadge level={risk.impact} />
                  </div>
                  <p className="text-[10px] text-stone-500">Mitigation: {risk.mitigation}</p>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Health projections */}
        <div className="space-y-2">
          <div className="flex items-center gap-1.5">
            <Activity size={14} className="text-violet-400" />
            <h3 className="text-xs font-semibold text-stone-400 uppercase tracking-wider">Health Projections</h3>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {healthProjection.map((hp, i) => (
              <div key={i} className="p-3 bg-stone-800/40 rounded-lg border border-stone-700/40">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs text-stone-400">{hp.metric}</span>
                  <TrendArrow current={hp.current} projected={hp.projected} />
                </div>
                <div className="flex items-baseline gap-2">
                  <span className="text-sm font-bold text-stone-200">{hp.current}</span>
                  <span className="text-[10px] text-stone-500">current</span>
                  <span className="text-stone-600 mx-1">&rarr;</span>
                  <span className="text-sm font-bold text-cyan-300">{hp.projected}</span>
                  <span className="text-[10px] text-stone-500">in {hp.timeframe}</span>
                </div>
                {hp.warning && <p className="text-[10px] text-amber-400 mt-1">{hp.warning}</p>}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
