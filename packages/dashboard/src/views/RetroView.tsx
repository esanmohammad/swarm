import { useState, useEffect } from 'react';
import {
  ThumbsUp,
  ThumbsDown,
  ListChecks,
  Settings,
  Play,
  CheckCircle,
  ArrowRight,
  BarChart3,
} from 'lucide-react';
import { FeatureGuide } from '../components/FeatureGuide';
import { StateView } from '../components/StateView';
import type { WsCommand } from '../types';

interface RetroReport {
  period: { start: string; end: string };
  wentWell: Array<{ summary: string; evidence: string }>;
  wentPoorly: Array<{ summary: string; evidence: string; impact: string }>;
  actionItems: Array<{
    description: string;
    configChange?: { key: string; oldValue: unknown; newValue: unknown };
    priority: string;
  }>;
  metrics: {
    totalRuns: number;
    successRate: number;
    avgCost: number;
    revertRate: number;
    fixIterationAvg: number;
  };
}

interface RetroViewProps {
  sendCommand: (cmd: WsCommand) => void;
  retroReport: RetroReport | null;
}

const priorityColors: Record<string, { bg: string; text: string; border: string }> = {
  high: { bg: 'bg-red-900/20', text: 'text-red-300', border: 'border-red-700/40' },
  medium: { bg: 'bg-yellow-900/20', text: 'text-yellow-300', border: 'border-yellow-700/40' },
  low: { bg: 'bg-stone-800/40', text: 'text-stone-400', border: 'border-stone-700/40' },
};

function GaugeRing({ value, label, color }: { value: number; label: string; color: string }) {
  const radius = 32;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (Math.min(value, 100) / 100) * circumference;

  return (
    <div className="flex flex-col items-center">
      <svg width="80" height="80" className="-rotate-90">
        <circle cx="40" cy="40" r={radius} fill="none" stroke="currentColor" strokeWidth="6" className="text-stone-800" />
        <circle
          cx="40"
          cy="40"
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth="6"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          className={color}
        />
      </svg>
      <span className="text-lg font-semibold text-stone-200 -mt-[52px] mb-6">{value}%</span>
      <span className="text-[10px] text-stone-500 uppercase tracking-wider">{label}</span>
    </div>
  );
}

export function RetroView({ sendCommand, retroReport }: RetroViewProps) {
  const [period, setPeriod] = useState<'biweekly' | 'monthly'>('biweekly');
  const [appliedItems, setAppliedItems] = useState<Set<number>>(new Set());

  useEffect(() => {
    sendCommand({ action: 'get-retro', period } as WsCommand);
  }, []);

  const handleRunRetro = () => {
    setAppliedItems(new Set());
    sendCommand({ action: 'get-retro', period } as WsCommand);
  };

  const handleApplyChanges = () => {
    sendCommand({ action: 'run-retro', autoApply: true, period } as WsCommand);
    // Mark all config-change items as applied
    if (retroReport) {
      const newApplied = new Set(appliedItems);
      retroReport.actionItems.forEach((item, i) => {
        if (item.configChange) newApplied.add(i);
      });
      setAppliedItems(newApplied);
    }
  };

  if (!retroReport) {
    return (
      <div className="flex-1 flex flex-col p-6 overflow-auto">
        <div className="max-w-5xl w-full mx-auto space-y-6">
          <FeatureGuide
            featureId="retro"
            title="Retrospectives"
            description="Automated retrospectives analyzing pipeline runs. Identifies what went well, what didn't, and patterns to improve."
            cliCommands={[
              { command: 'swarm retro', description: 'Run a retrospective on recent pipeline activity' },
            ]}
            hasData={false}
          />
          <StateView
            status="empty"
            title="No retrospective yet"
            message="Run one to analyze your recent pipeline activity. Retrospectives surface what went well, what went poorly, and actionable config improvements."
            actions={[{ label: 'Run Retro', onClick: handleRunRetro, variant: 'primary' }]}
          />
        </div>
      </div>
    );
  }

  const report = retroReport;
  const hasConfigChanges = report.actionItems.some(a => a.configChange);
  const allApplied = report.actionItems.every((a, i) => !a.configChange || appliedItems.has(i));

  return (
    <div className="flex-1 flex flex-col p-6 overflow-auto">
      <div className="max-w-5xl w-full mx-auto space-y-6">
        <FeatureGuide
          featureId="retro"
          title="Retrospectives"
          description="Automated retrospectives analyzing pipeline runs. Identifies what went well, what didn't, and patterns to improve."
          cliCommands={[
            { command: 'swarm retro', description: 'Run a retrospective on recent pipeline activity' },
          ]}
          hasData={!!retroReport}
        />

        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <BarChart3 size={18} className="text-amber-400" />
            <h2 className="text-lg font-semibold text-stone-200">Retrospective</h2>
            <span className="text-xs text-stone-500 ml-2">
              {report.period.start} to {report.period.end}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => setPeriod('biweekly')}
                className={`px-2.5 py-1 rounded text-[10px] font-medium border transition-colors ${
                  period === 'biweekly'
                    ? 'bg-blue-600/20 text-blue-300 border-blue-500/40'
                    : 'text-stone-400 border-stone-700/40 hover:border-stone-600/50'
                }`}
              >
                2 Weeks
              </button>
              <button
                onClick={() => setPeriod('monthly')}
                className={`px-2.5 py-1 rounded text-[10px] font-medium border transition-colors ${
                  period === 'monthly'
                    ? 'bg-blue-600/20 text-blue-300 border-blue-500/40'
                    : 'text-stone-400 border-stone-700/40 hover:border-stone-600/50'
                }`}
              >
                Monthly
              </button>
            </div>
            <button
              onClick={handleRunRetro}
              className="px-2.5 py-1 rounded text-[10px] font-medium border text-stone-400 border-stone-700/40 hover:border-stone-600/50 flex items-center gap-1 transition-colors"
            >
              <Play size={10} />
              Run Retro
            </button>
          </div>
        </div>

        {/* Metrics Summary */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          <MetricCard label="Total Runs" value={String(report.metrics.totalRuns)} color="text-stone-200" />
          <MetricCard label="Success Rate" value={`${report.metrics.successRate}%`} color="text-green-400" />
          <MetricCard label="Avg Cost" value={`$${report.metrics.avgCost.toFixed(2)}`} color="text-amber-400" />
          <MetricCard label="Revert Rate" value={`${report.metrics.revertRate}%`} color="text-red-400" />
          <MetricCard label="Avg Fix Iters" value={report.metrics.fixIterationAvg.toFixed(1)} color="text-purple-400" />
        </div>

        {/* Gauges */}
        <div className="p-4 rounded-lg bg-stone-900/40 border border-stone-800/40">
          <div className="flex items-center justify-around">
            <GaugeRing value={report.metrics.successRate} label="Success Rate" color="text-green-500" />
            <GaugeRing value={100 - report.metrics.revertRate} label="Retention" color="text-blue-500" />
            <GaugeRing
              value={Math.max(0, Math.min(100, 100 - (report.metrics.fixIterationAvg / 5) * 100))}
              label="First-Pass Quality"
              color="text-purple-500"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-6">
          {/* Went Well */}
          <div className="p-4 rounded-lg bg-stone-900/40 border border-stone-800/40">
            <div className="flex items-center gap-2 mb-3">
              <ThumbsUp size={14} className="text-green-400" />
              <h3 className="text-xs font-medium text-green-300 uppercase tracking-wider">Went Well</h3>
            </div>
            {report.wentWell.length === 0 ? (
              <p className="text-xs text-stone-500">No strong positives identified in this period.</p>
            ) : (
              <div className="space-y-3">
                {report.wentWell.map((item, i) => (
                  <div
                    key={i}
                    className="p-3 rounded-lg bg-green-950/20 border border-green-800/20"
                  >
                    <p className="text-xs text-green-200 font-medium">{item.summary}</p>
                    <p className="text-[10px] text-stone-500 mt-1">{item.evidence}</p>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Went Poorly */}
          <div className="p-4 rounded-lg bg-stone-900/40 border border-stone-800/40">
            <div className="flex items-center gap-2 mb-3">
              <ThumbsDown size={14} className="text-red-400" />
              <h3 className="text-xs font-medium text-red-300 uppercase tracking-wider">Went Poorly</h3>
            </div>
            {report.wentPoorly.length === 0 ? (
              <p className="text-xs text-stone-500">No issues identified in this period.</p>
            ) : (
              <div className="space-y-3">
                {report.wentPoorly.map((item, i) => (
                  <div
                    key={i}
                    className="p-3 rounded-lg bg-red-950/20 border border-red-800/20"
                  >
                    <p className="text-xs text-red-200 font-medium">{item.summary}</p>
                    <p className="text-[10px] text-stone-500 mt-1">{item.evidence}</p>
                    <p className="text-[10px] text-red-400 mt-1">Impact: {item.impact}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Action Items */}
        <div className="p-4 rounded-lg bg-stone-900/40 border border-stone-800/40">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <ListChecks size={14} className="text-amber-400" />
              <h3 className="text-xs font-medium text-amber-300 uppercase tracking-wider">Action Items</h3>
            </div>
            {hasConfigChanges && !allApplied && (
              <button
                onClick={handleApplyChanges}
                className="px-2.5 py-1 rounded text-[10px] font-medium border text-amber-400 border-amber-600/40 hover:bg-amber-600/10 flex items-center gap-1 transition-colors"
              >
                <Settings size={10} />
                Apply Changes
              </button>
            )}
            {allApplied && hasConfigChanges && (
              <span className="flex items-center gap-1 text-[10px] text-green-400">
                <CheckCircle size={10} />
                All changes applied
              </span>
            )}
          </div>
          {report.actionItems.length === 0 ? (
            <p className="text-xs text-stone-500">No action items. Everything looks healthy.</p>
          ) : (
            <div className="space-y-2.5">
              {report.actionItems.map((item, i) => {
                const pc = priorityColors[item.priority] || priorityColors.low;
                const isApplied = appliedItems.has(i);
                return (
                  <div
                    key={i}
                    className={`p-3 rounded-lg border ${isApplied ? 'bg-green-950/10 border-green-800/20 opacity-60' : 'bg-stone-800/30 border-stone-700/30'}`}
                  >
                    <div className="flex items-start gap-2">
                      <div className="mt-0.5">
                        {isApplied ? (
                          <CheckCircle size={14} className="text-green-400" />
                        ) : (
                          <ListChecks size={14} className="text-stone-500" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium border ${pc.bg} ${pc.text} ${pc.border}`}>
                            {item.priority.toUpperCase()}
                          </span>
                          <p className="text-xs text-stone-300">{item.description}</p>
                        </div>
                        {item.configChange && (
                          <div className="mt-1.5 p-2 rounded bg-stone-900/60 border border-stone-800/30">
                            <div className="flex items-center gap-2 text-[10px] font-mono">
                              <span className="text-stone-500">{item.configChange.key}:</span>
                              <span className="text-red-400 line-through">{JSON.stringify(item.configChange.oldValue)}</span>
                              <ArrowRight size={10} className="text-stone-600" />
                              <span className="text-green-400">{JSON.stringify(item.configChange.newValue)}</span>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function MetricCard({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="p-3 rounded-lg bg-stone-900/40 border border-stone-800/40">
      <div className="text-[10px] text-stone-500 uppercase tracking-wider">{label}</div>
      <div className={`text-xl font-semibold ${color} mt-1`}>{value}</div>
    </div>
  );
}
