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
import { FeatureGuide } from '../components/FeatureGuide';
import { StateView } from '../components/StateView';
import { ActionProgress } from '../components/ActionProgress';
import { useAction } from '../hooks/useAction';

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
  const forecastAction = useAction(sendCommand);

  useEffect(() => {
    sendCommand({ action: 'get-forecast' } as WsCommand);
  }, []);

  const handleRunForecast = () => {
    forecastAction.execute(
      { action: 'run-forecast', scope: costInput.trim() || undefined } as WsCommand,
      'Analyzing pipeline history and generating predictions...'
    );
  };

  // No data yet — show proper empty state with guide
  if (!forecastData) {
    return (
      <div className="flex-1 flex flex-col p-6 overflow-auto">
        <div className="max-w-4xl w-full mx-auto space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <TrendingUp size={18} className="text-cyan-400" />
              <h2 className="text-lg font-semibold text-stone-200">Forecast</h2>
            </div>
          </div>

          <FeatureGuide
            featureId="forecast"
            title="Engineering Forecast"
            description="Forecast predicts engineering velocity, cost trends, project risks, and health trajectory based on your pipeline run history. It needs at least a few pipeline runs to generate meaningful predictions."
            hasData={false}
            setupSteps={[
              { label: 'Run a few pipelines first to build history', command: 'swarm "Add a feature"' },
              { label: 'Then generate forecast', command: 'swarm forecast' },
            ]}
            prerequisites={[
              { label: '.swarm/ directory initialized', met: true },
              { label: 'Pipeline run history (3+ runs recommended)', met: false },
            ]}
            cliCommands={[
              { command: 'swarm forecast', description: 'Generate forecast from history' },
              { command: 'swarm stats', description: 'View cost/run history first' },
            ]}
          />

          {/* Action feedback */}
          {forecastAction.state.status !== 'idle' && (
            <ActionProgress
              state={forecastAction.state}
              onCancel={forecastAction.cancel}
              onRetry={handleRunForecast}
              onDismiss={forecastAction.reset}
            />
          )}

          <StateView
            status="empty"
            title="No forecast data yet"
            message="Forecast analyzes your pipeline run history to predict velocity, costs, risks, and health trends. Run a few pipelines first, then generate your forecast."
            actions={[
              { label: 'Generate Forecast', onClick: handleRunForecast, variant: 'primary' },
            ]}
          >
            <div className="text-left mt-3 space-y-1.5">
              <p className="text-[10px] text-stone-500 font-medium">What Forecast analyzes:</p>
              <ul className="text-[10px] text-stone-600 space-y-0.5">
                <li>Velocity — how many pipeline runs per week, trending up or down</li>
                <li>Cost estimates — predicted cost for future features based on past runs</li>
                <li>Risk radar — identifies patterns that could cause failures</li>
                <li>Health projections — where code quality metrics are heading</li>
              </ul>
            </div>
          </StateView>
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
          <div className="flex items-center gap-2">
            <FeatureGuide
              featureId="forecast"
              title="Engineering Forecast"
              description="Predicts velocity, costs, risks, and health trajectory from pipeline run history."
              hasData={true}
              cliCommands={[
                { command: 'swarm forecast', description: 'Regenerate forecast' },
              ]}
            />
            <button
              onClick={handleRunForecast}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium bg-cyan-600/20 text-cyan-300 border border-cyan-500/30 hover:bg-cyan-600/30 transition-colors"
            >
              <Play size={12} />
              Re-run Forecast
            </button>
          </div>
        </div>

        {/* Action feedback */}
        {forecastAction.state.status !== 'idle' && (
          <ActionProgress
            state={forecastAction.state}
            onCancel={forecastAction.cancel}
            onRetry={handleRunForecast}
            onDismiss={forecastAction.reset}
          />
        )}

        {/* Velocity chart */}
        <div className="space-y-2">
          <div className="flex items-center gap-1.5">
            <BarChart3 size={14} className="text-blue-400" />
            <h3 className="text-xs font-semibold text-stone-400 uppercase tracking-wider">Velocity</h3>
            <span className="text-[10px] text-stone-600 ml-2">Pipeline runs per week — higher = more throughput</span>
          </div>
          <div className="p-4 rounded-lg bg-stone-800/40 border border-stone-700/40">
            <div className="flex items-center gap-4 mb-3 text-xs">
              <div>
                <span className="text-stone-500">Current:</span>
                <span className="ml-1 font-medium text-stone-200">{velocity.current} runs/week</span>
              </div>
              <div>
                <span className="text-stone-500">Predicted:</span>
                <span className="ml-1 font-medium text-cyan-300">{velocity.predicted} runs/week</span>
              </div>
              <div>
                <span className="text-stone-500">Confidence:</span>
                <span className="ml-1 font-medium text-stone-400">{Math.round(velocity.confidence * 100)}%</span>
              </div>
            </div>
            {velocity.history.length > 0 ? (
              <>
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
              </>
            ) : (
              <p className="text-xs text-stone-600 py-4 text-center">No weekly data yet. Run more pipelines to see velocity trends.</p>
            )}
          </div>
        </div>

        {/* Cost estimation */}
        <div className="space-y-2">
          <div className="flex items-center gap-1.5">
            <DollarSign size={14} className="text-green-400" />
            <h3 className="text-xs font-semibold text-stone-400 uppercase tracking-wider">Cost Estimates</h3>
            <span className="text-[10px] text-stone-600 ml-2">Predicted cost for future work based on past runs</span>
          </div>
          <div className="flex gap-2 mb-2">
            <input
              type="text"
              value={costInput}
              onChange={e => setCostInput(e.target.value)}
              placeholder="Describe a feature for cost estimate (optional)..."
              className="flex-1 px-3 py-2 bg-stone-900/60 border border-stone-700/50 rounded-lg text-xs text-stone-200 placeholder-stone-500 focus:border-cyan-600 focus:outline-none focus:ring-1 focus:ring-cyan-600/30"
            />
          </div>
          {costEstimates.length > 0 ? (
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
          ) : (
            <p className="text-xs text-stone-600 p-3">No cost estimates yet. Run more pipelines to build a cost model.</p>
          )}
        </div>

        {/* Risk radar */}
        <div className="space-y-2">
          <div className="flex items-center gap-1.5">
            <AlertTriangle size={14} className="text-amber-400" />
            <h3 className="text-xs font-semibold text-stone-400 uppercase tracking-wider">Risk Radar</h3>
            <span className="text-[10px] text-stone-600 ml-2">Patterns that could cause future pipeline failures</span>
          </div>
          {risks.length === 0 ? (
            <div className="p-4 rounded-lg bg-stone-800/40 border border-stone-700/40 text-center">
              <p className="text-xs text-stone-500">No risks identified. This is based on failure patterns from pipeline history.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {risks.map((risk, i) => (
                <div key={i} className="p-3 bg-stone-800/40 rounded-lg border border-stone-700/40 space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-stone-300 flex-1">{risk.name}</span>
                    <span className="text-[10px] text-stone-500">Probability: {Math.round(risk.probability * 100)}%</span>
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
            <span className="text-[10px] text-stone-600 ml-2">Where your code quality metrics are heading</span>
          </div>
          {healthProjection.length > 0 ? (
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
          ) : (
            <p className="text-xs text-stone-600 p-3">No health projection data yet.</p>
          )}
        </div>
      </div>
    </div>
  );
}
