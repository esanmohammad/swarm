import { useState, useEffect } from 'react';
import { Activity, Play, Loader2, CheckCircle, AlertTriangle, XCircle } from 'lucide-react';
import type { WsCommand } from '../types';

interface HealthMetric {
  name: string;
  score: number;
  status: string;
  detail: string;
  suggestion?: string;
}

interface HealthReport {
  overall: number;
  metrics: HealthMetric[];
  timestamp: number;
}

interface HealthViewProps {
  sendCommand: (cmd: WsCommand) => void;
  healthReport: HealthReport | null;
}

const STATUS_CONFIG: Record<string, { icon: typeof CheckCircle; color: string; barColor: string }> = {
  good: { icon: CheckCircle, color: 'text-green-400', barColor: 'bg-green-500' },
  warning: { icon: AlertTriangle, color: 'text-yellow-400', barColor: 'bg-yellow-500' },
  poor: { icon: XCircle, color: 'text-red-400', barColor: 'bg-red-500' },
};

function overallColor(score: number): string {
  if (score >= 80) return 'text-green-400';
  if (score >= 50) return 'text-yellow-400';
  return 'text-red-400';
}

function overallBg(score: number): string {
  if (score >= 80) return 'border-green-500/30';
  if (score >= 50) return 'border-yellow-500/30';
  return 'border-red-500/30';
}

export function HealthView({ sendCommand, healthReport }: HealthViewProps) {
  const [running, setRunning] = useState(false);

  const handleRun = () => {
    setRunning(true);
    sendCommand({ action: 'run-health' } as WsCommand);
  };

  // Stop spinner when report arrives
  useEffect(() => {
    if (healthReport) setRunning(false);
  }, [healthReport]);

  const report = healthReport;

  return (
    <div className="flex-1 flex flex-col p-4 sm:p-6 overflow-auto">
      <div className="max-w-4xl w-full mx-auto space-y-5">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Activity size={18} className="text-green-400" />
            <div>
              <h2 className="text-sm font-semibold text-stone-200">Codebase Health</h2>
              <p className="text-xs text-stone-500">Dependencies, vulnerabilities, dead code, complexity, type safety, bundle size, docs</p>
            </div>
          </div>
          <button
            onClick={handleRun}
            disabled={running}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium text-white bg-green-600 hover:bg-green-500 disabled:bg-stone-700 disabled:text-stone-500 transition-colors"
          >
            {running ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />}
            {running ? 'Analyzing...' : 'Run Health Check'}
          </button>
        </div>

        {report ? (
          <>
            {/* Overall score */}
            <div className={`p-5 rounded-lg bg-stone-900/50 border ${overallBg(report.overall)} flex items-center gap-5`}>
              <div className={`text-4xl font-bold ${overallColor(report.overall)}`}>
                {report.overall}
              </div>
              <div>
                <div className="text-sm font-medium text-stone-200">
                  Overall Health Score
                </div>
                <div className="text-xs text-stone-500 mt-0.5">
                  {report.overall >= 80 ? 'Good' : report.overall >= 50 ? 'Needs attention' : 'Poor'} &middot; Last checked {new Date(report.timestamp).toLocaleTimeString()}
                </div>
              </div>
            </div>

            {/* Metrics */}
            <div className="space-y-2">
              {report.metrics.map((metric) => {
                const cfg = STATUS_CONFIG[metric.status] || STATUS_CONFIG.warning;
                const Icon = cfg.icon;
                return (
                  <div key={metric.name} className="p-3 rounded-lg bg-stone-900/30 border border-stone-800/50">
                    <div className="flex items-center gap-3">
                      <Icon size={14} className={`shrink-0 ${cfg.color}`} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-xs font-medium text-stone-300">{metric.name}</span>
                          <span className={`text-xs font-mono ${cfg.color}`}>{metric.score}/100</span>
                        </div>
                        {/* Progress bar */}
                        <div className="w-full h-1.5 bg-stone-800 rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all ${cfg.barColor}`}
                            style={{ width: `${metric.score}%` }}
                          />
                        </div>
                        <div className="text-[10px] text-stone-500 mt-1">{metric.detail}</div>
                        {metric.suggestion && (
                          <div className="text-[10px] text-stone-600 mt-0.5">{metric.suggestion}</div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        ) : (
          /* Empty state */
          <div className="flex-1 rounded-lg border border-stone-800/30 bg-stone-900/20 flex items-center justify-center py-16">
            <div className="text-center">
              <Activity size={36} className="text-stone-700 mx-auto mb-3" />
              <p className="text-xs text-stone-500">Run a health check to analyze your codebase.</p>
              <p className="text-[10px] text-stone-600 mt-1">
                CLI: <code className="text-stone-400 bg-stone-800/60 px-1 py-0.5 rounded">swarm health</code>
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
