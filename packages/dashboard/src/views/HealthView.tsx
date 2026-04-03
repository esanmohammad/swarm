import { useState, useEffect } from 'react';
import { Activity, Play, Loader2, CheckCircle, AlertTriangle, XCircle, RefreshCw, HelpCircle } from 'lucide-react';
import type { WsCommand } from '../types';
import { FeatureGuide } from '../components/FeatureGuide';
import { StateView } from '../components/StateView';
import { ActionProgress } from '../components/ActionProgress';
import { useAction } from '../hooks/useAction';

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

// Explain what each metric actually measures
const METRIC_EXPLANATIONS: Record<string, string> = {
  'Dependencies': 'Checks how up-to-date your npm/pip/go dependencies are. Stale deps = security risk.',
  'Vulnerabilities': 'Runs npm audit / safety check for known CVEs in your dependency tree.',
  'Dead Code': 'Scans for unused exports, unreachable code, and orphaned files.',
  'Complexity': 'Identifies functions with high cyclomatic complexity (deeply nested logic).',
  'Type Coverage': 'Measures how much of your codebase has type annotations (TS strict, Python types).',
  'Bundle Size': 'Checks your production bundle size against thresholds.',
  'Documentation': 'Checks if key files (README, API docs) exist and are recently updated.',
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

function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return `${Math.floor(diff / 86400000)}d ago`;
}

export function HealthView({ sendCommand, healthReport }: HealthViewProps) {
  const healthAction = useAction(sendCommand);
  const [showExplanations, setShowExplanations] = useState(false);

  const handleRun = () => {
    healthAction.execute(
      { action: 'run-health' } as WsCommand,
      'Running health check — analyzing dependencies, vulnerabilities, complexity, types, bundle size, docs...'
    );
  };

  // Reset action when report arrives
  useEffect(() => {
    if (healthReport && (healthAction.state.status === 'running' || healthAction.state.status === 'pending')) {
      healthAction.reset();
    }
  }, [healthReport]);

  const report = healthReport;

  return (
    <div className="flex-1 flex flex-col p-4 sm:p-6 overflow-auto">
      <div className="max-w-4xl w-full mx-auto space-y-5">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Activity size={18} className="text-green-400" />
            <h2 className="text-lg font-semibold text-stone-200">Codebase Health</h2>
          </div>
          <div className="flex items-center gap-2">
            <FeatureGuide
              featureId="health"
              title="Codebase Health"
              description="Analyzes 7 dimensions of code quality: dependency freshness, known vulnerabilities (CVEs), dead code, cyclomatic complexity, type coverage, bundle size, and documentation freshness. Each is scored 0-100 and weighted into an overall score."
              hasData={!!report}
              setupSteps={[
                { label: 'Run your first health check', command: 'swarm health' },
              ]}
              prerequisites={[
                { label: '.swarm/ directory initialized', met: true },
                { label: 'package.json or equivalent exists', met: true },
              ]}
              cliCommands={[
                { command: 'swarm health', description: 'Run health check' },
                { command: 'swarm health --format json', description: 'JSON output for CI' },
                { command: 'swarm health --threshold 70', description: 'Fail if below 70' },
              ]}
            />
            <button
              onClick={handleRun}
              disabled={healthAction.state.status === 'running' || healthAction.state.status === 'pending'}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium text-white bg-green-600 hover:bg-green-500 disabled:bg-stone-700 disabled:text-stone-500 transition-colors"
            >
              {healthAction.state.status === 'running' || healthAction.state.status === 'pending'
                ? <Loader2 size={12} className="animate-spin" />
                : report ? <RefreshCw size={12} /> : <Play size={12} />
              }
              {report ? 'Re-run' : 'Run Health Check'}
            </button>
          </div>
        </div>

        {/* Action feedback */}
        {healthAction.state.status !== 'idle' && (
          <ActionProgress
            state={healthAction.state}
            onCancel={healthAction.cancel}
            onRetry={handleRun}
            onDismiss={healthAction.reset}
          />
        )}

        {report ? (
          <>
            {/* Overall score */}
            <div className={`p-5 rounded-lg bg-stone-900/50 border ${overallBg(report.overall)} flex items-center gap-5`}>
              <div className={`text-4xl font-bold ${overallColor(report.overall)}`}>
                {report.overall}
              </div>
              <div className="flex-1">
                <div className="text-sm font-medium text-stone-200">
                  Overall Health Score
                </div>
                <div className="text-xs text-stone-500 mt-0.5">
                  {report.overall >= 80 ? 'Good — your codebase is in solid shape' : report.overall >= 50 ? 'Needs attention — some metrics are below healthy thresholds' : 'Poor — multiple areas need improvement'}
                </div>
                <div className="text-[10px] text-stone-600 mt-1">
                  Checked {timeAgo(report.timestamp)} &middot; Weighted average of {report.metrics.length} metrics
                </div>
              </div>
            </div>

            {/* What do these metrics mean? */}
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold text-stone-500 uppercase tracking-wider">Metrics</h3>
              <button
                onClick={() => setShowExplanations(!showExplanations)}
                className="flex items-center gap-1 text-[10px] text-stone-600 hover:text-stone-400"
              >
                <HelpCircle size={10} />
                {showExplanations ? 'Hide explanations' : 'What do these mean?'}
              </button>
            </div>

            {/* Metrics */}
            <div className="space-y-2">
              {report.metrics.map((metric) => {
                const cfg = STATUS_CONFIG[metric.status] || STATUS_CONFIG.warning;
                const Icon = cfg.icon;
                const explanation = METRIC_EXPLANATIONS[metric.name];
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
                        {/* What this metric found */}
                        <div className="text-[10px] text-stone-400 mt-1.5">{metric.detail}</div>
                        {/* Explanation of what it measures */}
                        {showExplanations && explanation && (
                          <div className="text-[10px] text-stone-600 mt-1 italic">{explanation}</div>
                        )}
                        {/* Suggestion to fix */}
                        {metric.suggestion && (
                          <div className="text-[10px] text-amber-400/70 mt-1">
                            Fix: {metric.suggestion}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Scoring explanation */}
            <div className="text-[10px] text-stone-600 p-3 rounded-lg bg-stone-900/20 border border-stone-800/30">
              <strong className="text-stone-500">How scoring works:</strong> Each metric is scored 0-100 based on actual analysis of your codebase.
              The overall score is a weighted average: Vulnerabilities (20%), Dependencies (15%), Complexity (15%), Types (15%), Docs (15%), Dead Code (10%), Bundle (10%).
              Scores update each time you run a health check.
            </div>
          </>
        ) : (
          /* Empty state */
          <StateView
            status="empty"
            title="No health data yet"
            message="Run a health check to analyze your codebase across 7 dimensions."
            actions={[
              { label: 'Run Health Check', onClick: handleRun, variant: 'primary' },
            ]}
          >
            <div className="text-left mt-3 space-y-1.5">
              <p className="text-[10px] text-stone-500 font-medium">What gets checked:</p>
              <ul className="text-[10px] text-stone-600 space-y-0.5">
                <li><strong className="text-stone-500">Dependencies</strong> — are your packages up to date?</li>
                <li><strong className="text-stone-500">Vulnerabilities</strong> — any known CVEs in your deps?</li>
                <li><strong className="text-stone-500">Dead Code</strong> — unused exports and orphaned files</li>
                <li><strong className="text-stone-500">Complexity</strong> — functions with deeply nested logic</li>
                <li><strong className="text-stone-500">Type Coverage</strong> — how typed is your codebase?</li>
                <li><strong className="text-stone-500">Bundle Size</strong> — is your production bundle bloated?</li>
                <li><strong className="text-stone-500">Documentation</strong> — are key docs present and fresh?</li>
              </ul>
            </div>
          </StateView>
        )}
      </div>
    </div>
  );
}
