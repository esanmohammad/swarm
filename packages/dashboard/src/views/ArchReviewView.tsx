import { useState, useEffect } from 'react';
import {
  Building2,
  CheckCircle,
  Star,
  BarChart3,
  Play,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import { FeatureGuide } from '../components/FeatureGuide';
import { StateView } from '../components/StateView';
import type { WsCommand } from '../types';

interface ArchIssue {
  id: string;
  title: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  category: string;
  evidence: string;
  impact: string;
  solutions: Array<{
    name: string;
    description: string;
    effort: string;
    risk: string;
    recommended: boolean;
  }>;
}

interface ActionItem {
  priority: number;
  action: string;
  effort: string;
  impact: string;
}

interface ArchReviewData {
  summary: string;
  issues: ArchIssue[];
  couplingScore: number;
  complexityScore: number;
  trends: Array<{ metric: string; direction: 'improving' | 'degrading' | 'stable'; detail: string }>;
  actionPlan: ActionItem[];
  timestamp: number;
}

interface ArchReviewViewProps {
  sendCommand: (cmd: WsCommand) => void;
  archReview: ArchReviewData | null;
}

function SeverityBadge({ severity }: { severity: string }) {
  const styles: Record<string, string> = {
    critical: 'bg-red-500/20 text-red-300 border-red-500/30',
    high: 'bg-orange-500/20 text-orange-300 border-orange-500/30',
    medium: 'bg-amber-500/20 text-amber-300 border-amber-500/30',
    low: 'bg-blue-500/20 text-blue-300 border-blue-500/30',
  };
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium border ${
        styles[severity] || 'bg-stone-700 text-stone-300 border-stone-600'
      }`}
    >
      {severity.toUpperCase()}
    </span>
  );
}

function ScoreGauge({ label, score, icon }: { label: string; score: number; icon: React.ReactNode }) {
  const color = score < 40 ? 'bg-emerald-500' : score < 70 ? 'bg-amber-500' : 'bg-red-500';
  const textColor = score < 40 ? 'text-emerald-400' : score < 70 ? 'text-amber-400' : 'text-red-400';
  return (
    <div className="p-4 rounded-lg bg-stone-800/40 border border-stone-700/40 space-y-2">
      <div className="flex items-center gap-1.5">
        {icon}
        <span className="text-[10px] text-stone-500 uppercase tracking-wider">{label}</span>
      </div>
      <div className="flex items-center gap-2">
        <div className="flex-1 h-2 bg-stone-700 rounded-full overflow-hidden">
          <div className={`h-full rounded-full ${color} transition-all`} style={{ width: `${score}%` }} />
        </div>
        <span className={`text-xs font-medium ${textColor}`}>{score}/100</span>
      </div>
    </div>
  );
}

export function ArchReviewView({ sendCommand, archReview }: ArchReviewViewProps) {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    sendCommand({ action: 'get-arch-review' } as WsCommand);
  }, []);

  const toggleExpand = (id: string) => {
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  if (!archReview) {
    return (
      <div className="flex-1 flex flex-col p-6 overflow-auto">
        <div className="max-w-5xl w-full mx-auto space-y-6">
          <div className="flex items-center gap-2">
            <Building2 size={18} className="text-orange-400" />
            <h2 className="text-lg font-semibold text-stone-200">Architecture Review</h2>
            <FeatureGuide
              featureId="arch-review"
              title="Architecture Review"
              description="AI-powered architecture analysis. Reviews coupling, complexity, circular dependencies, and suggests design improvements."
              cliCommands={[
                { command: 'swarm architect-review', description: 'Run an architecture review' },
              ]}
              hasData={false}
            />
          </div>
          <StateView
            status="empty"
            title="No architecture review yet"
            message="Run a review to analyze coupling, complexity, circular dependencies, and get design improvement suggestions."
            actions={[
              { label: 'Run Review', onClick: () => sendCommand({ action: 'run-arch-review' } as WsCommand), variant: 'primary' },
            ]}
          />
        </div>
      </div>
    );
  }

  const { issues, couplingScore, complexityScore, actionPlan, summary } = archReview;

  return (
    <div className="flex-1 flex flex-col p-6 overflow-auto">
      <div className="max-w-5xl w-full mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Building2 size={18} className="text-orange-400" />
            <h2 className="text-lg font-semibold text-stone-200">Architecture Review</h2>
            <span className="text-xs text-stone-500 ml-2">{issues.length} issues</span>
            <FeatureGuide
              featureId="arch-review"
              title="Architecture Review"
              description="AI-powered architecture analysis. Reviews coupling, complexity, circular dependencies, and suggests design improvements."
              cliCommands={[
                { command: 'swarm architect-review', description: 'Run an architecture review' },
              ]}
              hasData={true}
            />
          </div>
          <button
            onClick={() => sendCommand({ action: 'run-arch-review' } as WsCommand)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium bg-orange-600/20 text-orange-300 border border-orange-500/30 hover:bg-orange-600/30 transition-colors"
          >
            <Play size={12} />
            Run Review
          </button>
        </div>

        {/* Summary */}
        {summary && (
          <div className="p-4 rounded-lg bg-stone-800/40 border border-stone-700/40">
            <p className="text-xs text-stone-400">{summary}</p>
          </div>
        )}

        {/* Score gauges */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <ScoreGauge
            label="Coupling"
            score={couplingScore}
            icon={<BarChart3 size={14} className="text-amber-400" />}
          />
          <ScoreGauge
            label="Complexity"
            score={complexityScore}
            icon={<BarChart3 size={14} className="text-violet-400" />}
          />
        </div>

        {/* Issue cards */}
        <div className="space-y-3">
          <h3 className="text-xs font-semibold text-stone-400 uppercase tracking-wider">Issues</h3>
          {issues.length === 0 ? (
            <div className="text-center py-8">
              <CheckCircle size={28} className="text-emerald-600 mx-auto mb-2" />
              <p className="text-xs text-stone-500">No architecture issues found.</p>
            </div>
          ) : (
            issues.map(issue => {
              const expanded = expandedIds.has(issue.id);
              return (
                <div
                  key={issue.id}
                  className="bg-stone-800/40 rounded-lg border border-stone-700/40 overflow-hidden"
                >
                  <button
                    onClick={() => toggleExpand(issue.id)}
                    className="w-full flex items-center gap-3 p-3 text-left hover:bg-stone-800/60 transition-colors"
                  >
                    {expanded ? (
                      <ChevronDown size={12} className="text-stone-500" />
                    ) : (
                      <ChevronRight size={12} className="text-stone-500" />
                    )}
                    <SeverityBadge severity={issue.severity} />
                    <span className="text-xs text-stone-300 flex-1 truncate">{issue.title}</span>
                    <span className="text-[10px] text-stone-500">{issue.category}</span>
                  </button>

                  {expanded && (
                    <div className="px-4 pb-3 space-y-3 border-t border-stone-700/30">
                      <div className="pt-2">
                        <p className="text-[10px] text-stone-500 uppercase tracking-wider mb-1">Evidence</p>
                        <p className="text-xs text-stone-400">{issue.evidence}</p>
                      </div>
                      <div>
                        <p className="text-[10px] text-stone-500 uppercase tracking-wider mb-1">Impact</p>
                        <p className="text-xs text-stone-400">{issue.impact}</p>
                      </div>
                      <div>
                        <p className="text-[10px] text-stone-500 uppercase tracking-wider mb-2">Solutions</p>
                        <div className="space-y-2">
                          {issue.solutions.map((sol, i) => (
                            <div
                              key={i}
                              className={`p-2.5 rounded border ${
                                sol.recommended
                                  ? 'bg-blue-500/5 border-blue-500/30'
                                  : 'bg-stone-900/40 border-stone-800/40'
                              }`}
                            >
                              <div className="flex items-center gap-2 mb-1">
                                <p className="text-xs text-stone-300 flex-1">{sol.name}: {sol.description}</p>
                                {sol.recommended && (
                                  <span className="flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-blue-500/20 text-[10px] font-medium text-blue-300 border border-blue-500/30">
                                    <Star size={9} /> RECOMMENDED
                                  </span>
                                )}
                              </div>
                              <p className="text-[10px] text-stone-500">Effort: {sol.effort} | Risk: {sol.risk}</p>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* Action plan table */}
        {actionPlan.length > 0 && (
          <div className="space-y-3">
            <h3 className="text-xs font-semibold text-stone-400 uppercase tracking-wider">Action Plan</h3>
            <div className="bg-stone-800/40 rounded-lg border border-stone-700/40 overflow-hidden">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-stone-700/40">
                    <th className="text-left p-3 text-[10px] text-stone-500 uppercase tracking-wider font-medium">Priority</th>
                    <th className="text-left p-3 text-[10px] text-stone-500 uppercase tracking-wider font-medium">Action</th>
                    <th className="text-left p-3 text-[10px] text-stone-500 uppercase tracking-wider font-medium">Effort</th>
                    <th className="text-left p-3 text-[10px] text-stone-500 uppercase tracking-wider font-medium">Impact</th>
                  </tr>
                </thead>
                <tbody>
                  {actionPlan.map((item, i) => (
                    <tr key={i} className="border-b border-stone-700/20 last:border-0">
                      <td className="p-3 text-stone-400">{item.priority}</td>
                      <td className="p-3 text-stone-300">{item.action}</td>
                      <td className="p-3 text-stone-400">{item.effort}</td>
                      <td className="p-3 text-stone-400">{item.impact}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
