import { useState, useEffect } from 'react';
import {
  FileText,
  TrendingUp,
  TrendingDown,
  Minus,
  DollarSign,
  GitPullRequest,
  Bug,
  CheckCircle,
  Clock,
  Send,
  RefreshCw,
} from 'lucide-react';
import type { WsCommand } from '../types';

interface StandupReport {
  date: string;
  completed: Array<{ summary: string; type: string; cost: number; prUrl?: string }>;
  impact: { prsCreated: number; prsMerged: number; issuesClosed: number; testsGenerated: number; linesGenerated: number };
  cost: { total: number; byType: Array<{ type: string; cost: number }> };
  blockers: Array<{ summary: string; reason: string }>;
  upcoming: Array<{ title: string; estimatedCost: number }>;
  velocity: { thisWeek: number; lastWeek: number; trend: 'up' | 'down' | 'stable' };
}

interface StandupViewProps {
  sendCommand: (cmd: WsCommand) => void;
  standupReport: StandupReport | null;
}

const typeIcons: Record<string, React.ReactNode> = {
  pipeline: <FileText size={14} className="text-blue-400" />,
  'pr-created': <GitPullRequest size={14} className="text-green-400" />,
  'pr-merged': <GitPullRequest size={14} className="text-purple-400" />,
  'issue-resolved': <CheckCircle size={14} className="text-emerald-400" />,
  'test-gen': <FileText size={14} className="text-cyan-400" />,
  'deps-update': <RefreshCw size={14} className="text-yellow-400" />,
  incident: <Bug size={14} className="text-red-400" />,
  review: <FileText size={14} className="text-indigo-400" />,
  fix: <CheckCircle size={14} className="text-amber-400" />,
  deploy: <Send size={14} className="text-teal-400" />,
  failure: <Bug size={14} className="text-red-500" />,
};

function TrendIcon({ trend }: { trend: 'up' | 'down' | 'stable' }) {
  if (trend === 'up') return <TrendingUp size={16} className="text-green-400" />;
  if (trend === 'down') return <TrendingDown size={16} className="text-red-400" />;
  return <Minus size={16} className="text-stone-400" />;
}

export function StandupView({ sendCommand, standupReport }: StandupViewProps) {
  const [weekly, setWeekly] = useState(false);

  useEffect(() => {
    sendCommand({ action: 'get-standup', weekly } as WsCommand);
  }, [weekly]);

  if (!standupReport) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center">
          <FileText size={36} className="text-stone-600 mx-auto mb-3" />
          <p className="text-sm text-stone-400">Loading standup report...</p>
        </div>
      </div>
    );
  }

  const report = standupReport;
  const maxCostByType = Math.max(...report.cost.byType.map(c => c.cost), 0.01);

  return (
    <div className="flex-1 flex flex-col p-6 overflow-auto">
      <div className="max-w-5xl w-full mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <FileText size={18} className="text-amber-400" />
            <h2 className="text-lg font-semibold text-stone-200">Standup Report</h2>
            <span className="text-xs text-stone-500 ml-2">{report.date}</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => setWeekly(false)}
                className={`px-2.5 py-1 rounded text-[10px] font-medium border transition-colors ${
                  !weekly
                    ? 'bg-blue-600/20 text-blue-300 border-blue-500/40'
                    : 'text-stone-400 border-stone-700/40 hover:border-stone-600/50'
                }`}
              >
                Today
              </button>
              <button
                onClick={() => setWeekly(true)}
                className={`px-2.5 py-1 rounded text-[10px] font-medium border transition-colors ${
                  weekly
                    ? 'bg-blue-600/20 text-blue-300 border-blue-500/40'
                    : 'text-stone-400 border-stone-700/40 hover:border-stone-600/50'
                }`}
              >
                Weekly
              </button>
            </div>
            <button
              onClick={() => sendCommand({ action: 'get-standup', weekly } as WsCommand)}
              className="px-2.5 py-1 rounded text-[10px] font-medium border text-stone-400 border-stone-700/40 hover:border-stone-600/50 flex items-center gap-1 transition-colors"
            >
              <RefreshCw size={10} />
              Generate Report
            </button>
            <button
              onClick={() => sendCommand({ action: 'post-standup', weekly } as WsCommand)}
              className="px-2.5 py-1 rounded text-[10px] font-medium border text-amber-400 border-amber-600/40 hover:bg-amber-600/10 flex items-center gap-1 transition-colors"
            >
              <Send size={10} />
              Post Now
            </button>
          </div>
        </div>

        {/* Stats cards */}
        <div className="grid grid-cols-4 gap-3">
          <div className="bg-stone-800/50 border border-stone-700/40 rounded-lg p-3">
            <div className="flex items-center gap-1.5 mb-1">
              <CheckCircle size={12} className="text-green-400" />
              <span className="text-[10px] text-stone-500 uppercase tracking-wider">Completed</span>
            </div>
            <p className="text-xl font-semibold text-stone-200">{report.completed.length}</p>
          </div>
          <div className="bg-stone-800/50 border border-stone-700/40 rounded-lg p-3">
            <div className="flex items-center gap-1.5 mb-1">
              <DollarSign size={12} className="text-yellow-400" />
              <span className="text-[10px] text-stone-500 uppercase tracking-wider">Total Cost</span>
            </div>
            <p className="text-xl font-semibold text-stone-200">${report.cost.total.toFixed(2)}</p>
          </div>
          <div className="bg-stone-800/50 border border-stone-700/40 rounded-lg p-3">
            <div className="flex items-center gap-1.5 mb-1">
              <GitPullRequest size={12} className="text-purple-400" />
              <span className="text-[10px] text-stone-500 uppercase tracking-wider">PRs Created</span>
            </div>
            <p className="text-xl font-semibold text-stone-200">{report.impact.prsCreated}</p>
          </div>
          <div className="bg-stone-800/50 border border-stone-700/40 rounded-lg p-3">
            <div className="flex items-center gap-1.5 mb-1">
              <TrendIcon trend={report.velocity.trend} />
              <span className="text-[10px] text-stone-500 uppercase tracking-wider">Velocity</span>
            </div>
            <p className="text-xl font-semibold text-stone-200">
              {report.velocity.thisWeek}
              <span className="text-xs text-stone-500 ml-1">/ {report.velocity.lastWeek} last</span>
            </p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-6">
          {/* Activity Timeline */}
          <div className="bg-stone-800/50 border border-stone-700/40 rounded-lg p-4">
            <div className="flex items-center gap-1.5 mb-3">
              <Clock size={14} className="text-stone-400" />
              <h3 className="text-xs font-medium text-stone-300 uppercase tracking-wider">Activity Timeline</h3>
            </div>
            {report.completed.length === 0 ? (
              <p className="text-xs text-stone-500">No activity recorded yet.</p>
            ) : (
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {report.completed.map((item, i) => (
                  <div key={i} className="flex items-start gap-2 py-1.5 border-b border-stone-700/30 last:border-0">
                    <div className="mt-0.5">{typeIcons[item.type] ?? <FileText size={14} className="text-stone-500" />}</div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-stone-300 truncate">{item.summary}</p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-[10px] text-stone-500">{item.type}</span>
                        <span className="text-[10px] text-yellow-500">${item.cost.toFixed(2)}</span>
                        {item.prUrl && (
                          <a href={item.prUrl} target="_blank" rel="noreferrer" className="text-[10px] text-blue-400 hover:underline">
                            PR
                          </a>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Cost Burn Chart */}
          <div className="bg-stone-800/50 border border-stone-700/40 rounded-lg p-4">
            <div className="flex items-center gap-1.5 mb-3">
              <DollarSign size={14} className="text-yellow-400" />
              <h3 className="text-xs font-medium text-stone-300 uppercase tracking-wider">Cost by Type</h3>
            </div>
            {report.cost.byType.length === 0 ? (
              <p className="text-xs text-stone-500">No cost data yet.</p>
            ) : (
              <div className="space-y-2">
                {report.cost.byType.map((item, i) => (
                  <div key={i}>
                    <div className="flex items-center justify-between mb-0.5">
                      <span className="text-[10px] text-stone-400">{item.type}</span>
                      <span className="text-[10px] text-stone-300 font-mono">${item.cost.toFixed(2)}</span>
                    </div>
                    <div className="h-2 bg-stone-700/50 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-amber-500/60 rounded-full transition-all"
                        style={{ width: `${Math.max((item.cost / maxCostByType) * 100, 2)}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Impact & Blockers */}
        <div className="grid grid-cols-2 gap-6">
          {/* Impact */}
          <div className="bg-stone-800/50 border border-stone-700/40 rounded-lg p-4">
            <div className="flex items-center gap-1.5 mb-3">
              <TrendingUp size={14} className="text-green-400" />
              <h3 className="text-xs font-medium text-stone-300 uppercase tracking-wider">Impact</h3>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="flex items-center gap-2">
                <GitPullRequest size={12} className="text-green-400" />
                <span className="text-xs text-stone-400">PRs created</span>
                <span className="text-xs text-stone-200 ml-auto font-mono">{report.impact.prsCreated}</span>
              </div>
              <div className="flex items-center gap-2">
                <GitPullRequest size={12} className="text-purple-400" />
                <span className="text-xs text-stone-400">PRs merged</span>
                <span className="text-xs text-stone-200 ml-auto font-mono">{report.impact.prsMerged}</span>
              </div>
              <div className="flex items-center gap-2">
                <Bug size={12} className="text-emerald-400" />
                <span className="text-xs text-stone-400">Issues closed</span>
                <span className="text-xs text-stone-200 ml-auto font-mono">{report.impact.issuesClosed}</span>
              </div>
              <div className="flex items-center gap-2">
                <FileText size={12} className="text-cyan-400" />
                <span className="text-xs text-stone-400">Tests generated</span>
                <span className="text-xs text-stone-200 ml-auto font-mono">{report.impact.testsGenerated}</span>
              </div>
              <div className="col-span-2 flex items-center gap-2">
                <FileText size={12} className="text-stone-400" />
                <span className="text-xs text-stone-400">Lines generated</span>
                <span className="text-xs text-stone-200 ml-auto font-mono">{report.impact.linesGenerated.toLocaleString()}</span>
              </div>
            </div>
          </div>

          {/* Blockers */}
          <div className="bg-stone-800/50 border border-stone-700/40 rounded-lg p-4">
            <div className="flex items-center gap-1.5 mb-3">
              <Bug size={14} className="text-red-400" />
              <h3 className="text-xs font-medium text-stone-300 uppercase tracking-wider">Blockers</h3>
            </div>
            {report.blockers.length === 0 ? (
              <p className="text-xs text-stone-500">No blockers. All clear.</p>
            ) : (
              <div className="space-y-2 max-h-32 overflow-y-auto">
                {report.blockers.map((b, i) => (
                  <div key={i} className="py-1.5 border-b border-stone-700/30 last:border-0">
                    <p className="text-xs text-red-300">{b.summary}</p>
                    <p className="text-[10px] text-stone-500 mt-0.5">{b.reason}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Upcoming */}
        {report.upcoming.length > 0 && (
          <div className="bg-stone-800/50 border border-stone-700/40 rounded-lg p-4">
            <div className="flex items-center gap-1.5 mb-3">
              <Clock size={14} className="text-blue-400" />
              <h3 className="text-xs font-medium text-stone-300 uppercase tracking-wider">Upcoming</h3>
            </div>
            <div className="space-y-1.5">
              {report.upcoming.map((u, i) => (
                <div key={i} className="flex items-center justify-between py-1 border-b border-stone-700/30 last:border-0">
                  <span className="text-xs text-stone-300">{u.title}</span>
                  <span className="text-[10px] text-yellow-500 font-mono">est. ${u.estimatedCost.toFixed(2)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
