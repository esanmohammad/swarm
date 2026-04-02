import { useState, useEffect } from 'react';
import {
  BarChart3,
  TrendingUp,
  DollarSign,
  Clock,
  FileText,
  Download,
  RefreshCw,
  ArrowUpRight,
  GitPullRequest,
  Bug,
  TestTube,
  Shield,
} from 'lucide-react';
import type { WsCommand } from '../types';

interface ReportData {
  period: { start: string; end: string; label: string };
  output: {
    issuesResolved: number;
    prsCreated: number;
    prsMerged: number;
    linesGenerated: number;
    testsGenerated: number;
  };
  quality: {
    mergeRate: number;
    revertRate: number;
    fixLoopSuccessRate: number;
  };
  cost: {
    total: number;
    byCommand: Array<{ command: string; cost: number }>;
    perIssue: number;
    perPr: number;
  };
  roi: {
    estimatedHoursSaved: number;
    estimatedValueSaved: number;
    roiMultiple: number;
  };
  trends: {
    velocity: Array<{ period: string; items: number }>;
    costEfficiency: Array<{ period: string; costPerItem: number }>;
  };
}

interface ReportViewProps {
  sendCommand: (cmd: WsCommand) => void;
  reportData: ReportData | null;
}

export function ReportView({ sendCommand, reportData }: ReportViewProps) {
  const [period, setPeriod] = useState<'weekly' | 'monthly' | 'quarterly'>('monthly');
  const [compare, setCompare] = useState(false);

  useEffect(() => {
    sendCommand({ action: 'get-report', period, compare } as WsCommand);
  }, [period, compare]);

  if (!reportData) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center">
          <BarChart3 size={36} className="text-stone-600 mx-auto mb-3" />
          <p className="text-sm text-stone-400">Loading report data...</p>
        </div>
      </div>
    );
  }

  const maxCommandCost = Math.max(...reportData.cost.byCommand.map(c => c.cost), 0.01);
  const totalCommandCost = reportData.cost.total || 0.01;
  const maxVelocity = Math.max(...(reportData.trends.velocity.map(v => v.items) || [1]), 1);

  // Color palette for cost breakdown
  const barColors = [
    'bg-blue-500/60',
    'bg-amber-500/60',
    'bg-purple-500/60',
    'bg-emerald-500/60',
    'bg-rose-500/60',
    'bg-cyan-500/60',
    'bg-orange-500/60',
    'bg-indigo-500/60',
  ];

  return (
    <div className="flex-1 flex flex-col p-6 overflow-auto">
      <div className="max-w-6xl w-full mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <BarChart3 size={18} className="text-emerald-400" />
            <h2 className="text-lg font-semibold text-stone-200">Impact Report</h2>
            <span className="text-xs text-stone-500 ml-2">
              {reportData.period.start} to {reportData.period.end}
            </span>
          </div>
          <div className="flex items-center gap-2">
            {/* Period selector */}
            <div className="flex items-center gap-1.5">
              {(['weekly', 'monthly', 'quarterly'] as const).map(p => (
                <button
                  key={p}
                  onClick={() => setPeriod(p)}
                  className={`px-2.5 py-1 rounded text-[10px] font-medium border transition-colors ${
                    period === p
                      ? 'bg-emerald-600/20 text-emerald-300 border-emerald-500/40'
                      : 'text-stone-400 border-stone-700/40 hover:border-stone-600/50'
                  }`}
                >
                  {p}
                </button>
              ))}
            </div>
            {/* Compare toggle */}
            <button
              onClick={() => setCompare(!compare)}
              className={`px-2.5 py-1 rounded text-[10px] font-medium border transition-colors ${
                compare
                  ? 'bg-blue-600/20 text-blue-300 border-blue-500/40'
                  : 'text-stone-400 border-stone-700/40 hover:border-stone-600/50'
              }`}
            >
              Compare
            </button>
            {/* Action buttons */}
            <button
              onClick={() => sendCommand({ action: 'get-report', period, compare } as WsCommand)}
              className="p-1.5 rounded text-stone-400 border border-stone-700/40 hover:border-stone-600/50 transition-colors"
              title="Refresh"
            >
              <RefreshCw size={12} />
            </button>
            <button
              onClick={() => sendCommand({ action: 'get-report', period } as WsCommand)}
              className="p-1.5 rounded text-stone-400 border border-stone-700/40 hover:border-stone-600/50 transition-colors"
              title="Export"
            >
              <Download size={12} />
            </button>
          </div>
        </div>

        {/* Executive Summary */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <SummaryCard
            icon={<ArrowUpRight size={14} className="text-emerald-400" />}
            label="ROI Multiple"
            value={`${reportData.roi.roiMultiple.toFixed(1)}x`}
            sub="return on investment"
            color="text-emerald-400"
          />
          <SummaryCard
            icon={<Bug size={14} className="text-blue-400" />}
            label="Issues Closed"
            value={String(reportData.output.issuesResolved)}
            sub={`${reportData.output.prsCreated} PRs created`}
            color="text-blue-400"
          />
          <SummaryCard
            icon={<DollarSign size={14} className="text-amber-400" />}
            label="Total Cost"
            value={`$${reportData.cost.total.toFixed(2)}`}
            sub={`$${reportData.cost.perIssue.toFixed(2)}/issue`}
            color="text-amber-400"
          />
          <SummaryCard
            icon={<Clock size={14} className="text-cyan-400" />}
            label="Hours Saved"
            value={`${reportData.roi.estimatedHoursSaved.toFixed(1)}h`}
            sub={`$${reportData.roi.estimatedValueSaved.toFixed(0)} value`}
            color="text-cyan-400"
          />
        </div>

        {/* Output Metrics Grid */}
        <div className="p-4 rounded-lg bg-stone-900/40 border border-stone-800/40">
          <div className="flex items-center gap-2 mb-3">
            <FileText size={14} className="text-stone-400" />
            <h3 className="text-xs font-medium text-stone-400 uppercase tracking-wider">Output Metrics</h3>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
            <MetricItem icon={<Bug size={12} />} label="Issues Resolved" value={reportData.output.issuesResolved} />
            <MetricItem icon={<GitPullRequest size={12} />} label="PRs Created" value={reportData.output.prsCreated} />
            <MetricItem icon={<GitPullRequest size={12} />} label="PRs Merged" value={reportData.output.prsMerged} />
            <MetricItem icon={<FileText size={12} />} label="Lines Generated" value={reportData.output.linesGenerated} />
            <MetricItem icon={<TestTube size={12} />} label="Tests Generated" value={reportData.output.testsGenerated} />
          </div>
        </div>

        {/* Quality Metrics */}
        <div className="p-4 rounded-lg bg-stone-900/40 border border-stone-800/40">
          <div className="flex items-center gap-2 mb-3">
            <Shield size={14} className="text-stone-400" />
            <h3 className="text-xs font-medium text-stone-400 uppercase tracking-wider">Quality</h3>
          </div>
          <div className="grid grid-cols-3 gap-6">
            <GaugeMetric label="Merge Rate" value={reportData.quality.mergeRate} color="emerald" />
            <GaugeMetric label="Revert Rate" value={reportData.quality.revertRate} color="rose" invert />
            <GaugeMetric label="Fix Loop Success" value={reportData.quality.fixLoopSuccessRate} color="blue" />
          </div>
        </div>

        {/* Cost Breakdown */}
        {reportData.cost.byCommand.length > 0 && (
          <div className="p-4 rounded-lg bg-stone-900/40 border border-stone-800/40">
            <div className="flex items-center gap-2 mb-3">
              <DollarSign size={14} className="text-amber-400" />
              <h3 className="text-xs font-medium text-stone-400 uppercase tracking-wider">Cost Breakdown</h3>
            </div>
            {/* Stacked bar */}
            <div className="flex h-6 rounded overflow-hidden mb-4">
              {reportData.cost.byCommand.map((item, i) => {
                const pct = (item.cost / totalCommandCost) * 100;
                if (pct < 1) return null;
                return (
                  <div
                    key={item.command}
                    className={`${barColors[i % barColors.length]} relative group`}
                    style={{ width: `${pct}%` }}
                    title={`${item.command}: $${item.cost.toFixed(2)} (${pct.toFixed(0)}%)`}
                  />
                );
              })}
            </div>
            {/* Legend */}
            <div className="space-y-2">
              {reportData.cost.byCommand.map((item, i) => {
                const pct = totalCommandCost > 0 ? (item.cost / totalCommandCost * 100) : 0;
                return (
                  <div key={item.command} className="flex items-center gap-3">
                    <div className={`w-2.5 h-2.5 rounded-sm ${barColors[i % barColors.length]}`} />
                    <span className="text-xs text-stone-300 w-28 shrink-0">{item.command}</span>
                    <div className="flex-1 h-3 bg-stone-800/60 rounded overflow-hidden">
                      <div
                        className={`h-full rounded ${barColors[i % barColors.length]}`}
                        style={{ width: `${(item.cost / maxCommandCost) * 100}%` }}
                      />
                    </div>
                    <span className="text-xs text-amber-400 font-mono w-16 text-right">
                      ${item.cost.toFixed(2)}
                    </span>
                    <span className="text-[10px] text-stone-500 w-10 text-right">{pct.toFixed(0)}%</span>
                  </div>
                );
              })}
            </div>
            <div className="flex gap-6 mt-4 pt-3 border-t border-stone-800/30">
              <span className="text-[10px] text-stone-500">
                Cost/Issue: <span className="text-stone-300">${reportData.cost.perIssue.toFixed(2)}</span>
              </span>
              <span className="text-[10px] text-stone-500">
                Cost/PR: <span className="text-stone-300">${reportData.cost.perPr.toFixed(2)}</span>
              </span>
            </div>
          </div>
        )}

        {/* ROI Calculation */}
        <div className="p-4 rounded-lg bg-emerald-950/20 border border-emerald-800/20">
          <div className="flex items-center gap-2 mb-3">
            <TrendingUp size={14} className="text-emerald-400" />
            <h3 className="text-xs font-medium text-emerald-300 uppercase tracking-wider">ROI Analysis</h3>
          </div>
          <div className="grid grid-cols-3 gap-6">
            <div>
              <div className="text-[10px] text-stone-500 uppercase">Value Generated</div>
              <div className="text-2xl font-bold text-emerald-400 mt-1">
                ${reportData.roi.estimatedValueSaved.toFixed(0)}
              </div>
              <div className="text-[10px] text-stone-500 mt-0.5">
                {reportData.roi.estimatedHoursSaved.toFixed(1)}h saved
              </div>
            </div>
            <div>
              <div className="text-[10px] text-stone-500 uppercase">Total Spent</div>
              <div className="text-2xl font-bold text-amber-400 mt-1">
                ${reportData.cost.total.toFixed(2)}
              </div>
              <div className="text-[10px] text-stone-500 mt-0.5">API + compute costs</div>
            </div>
            <div>
              <div className="text-[10px] text-stone-500 uppercase">Net Return</div>
              <div className={`text-2xl font-bold mt-1 ${
                reportData.roi.roiMultiple >= 1 ? 'text-emerald-400' : 'text-rose-400'
              }`}>
                {reportData.roi.roiMultiple.toFixed(1)}x
              </div>
              <div className="text-[10px] text-stone-500 mt-0.5">
                {reportData.roi.roiMultiple >= 1 ? 'positive ROI' : 'below break-even'}
              </div>
            </div>
          </div>
          {/* Break-even bar */}
          <div className="mt-4 pt-3 border-t border-emerald-800/20">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[10px] text-stone-500">Break-even analysis</span>
              <span className="text-[10px] text-stone-400">
                {reportData.roi.roiMultiple >= 1
                  ? `${((reportData.roi.roiMultiple - 1) * 100).toFixed(0)}% above break-even`
                  : `${((1 - reportData.roi.roiMultiple) * 100).toFixed(0)}% below break-even`}
              </span>
            </div>
            <div className="h-2 bg-stone-800/60 rounded overflow-hidden">
              <div
                className={`h-full rounded ${reportData.roi.roiMultiple >= 1 ? 'bg-emerald-500/60' : 'bg-rose-500/60'}`}
                style={{ width: `${Math.min(reportData.roi.roiMultiple * 50, 100)}%` }}
              />
            </div>
          </div>
        </div>

        {/* Velocity Trend */}
        {reportData.trends.velocity.length > 1 && (
          <div className="p-4 rounded-lg bg-stone-900/40 border border-stone-800/40">
            <div className="flex items-center gap-2 mb-3">
              <BarChart3 size={14} className="text-cyan-400" />
              <h3 className="text-xs font-medium text-stone-400 uppercase tracking-wider">Velocity Trend</h3>
            </div>
            <div className="flex items-end gap-1.5" style={{ height: '120px' }}>
              {reportData.trends.velocity.map(v => (
                <div key={v.period} className="flex-1 flex flex-col items-center justify-end h-full">
                  <div className="text-[9px] text-stone-400 font-mono mb-1">{v.items}</div>
                  <div
                    className="w-full bg-cyan-500/40 rounded-t min-h-[2px]"
                    style={{ height: `${(v.items / maxVelocity) * 100}%` }}
                  />
                  <div className="text-[8px] text-stone-500 mt-1 truncate w-full text-center">
                    {v.period.slice(5)}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Cost Efficiency Trend */}
        {reportData.trends.costEfficiency.length > 1 && (
          <div className="p-4 rounded-lg bg-stone-900/40 border border-stone-800/40">
            <div className="flex items-center gap-2 mb-3">
              <DollarSign size={14} className="text-amber-400" />
              <h3 className="text-xs font-medium text-stone-400 uppercase tracking-wider">Cost Efficiency Trend</h3>
            </div>
            <div className="space-y-2">
              {(() => {
                const maxCpi = Math.max(...reportData.trends.costEfficiency.map(c => c.costPerItem), 0.01);
                return reportData.trends.costEfficiency.map(c => (
                  <div key={c.period} className="flex items-center gap-3">
                    <span className="text-[10px] text-stone-400 font-mono w-20 shrink-0">{c.period.slice(5)}</span>
                    <div className="flex-1 h-3 bg-stone-800/60 rounded overflow-hidden">
                      <div
                        className="h-full bg-amber-500/40 rounded"
                        style={{ width: `${(c.costPerItem / maxCpi) * 100}%` }}
                      />
                    </div>
                    <span className="text-xs text-amber-400 font-mono w-20 text-right">
                      ${c.costPerItem.toFixed(2)}/item
                    </span>
                  </div>
                ));
              })()}
            </div>
          </div>
        )}

        {/* Generate / Export actions */}
        <div className="flex items-center gap-3 pt-2">
          <button
            onClick={() => sendCommand({ action: 'get-report', period } as WsCommand)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-emerald-600/20 text-emerald-300 border border-emerald-500/40 text-xs font-medium hover:bg-emerald-600/30 transition-colors"
          >
            <FileText size={12} />
            Generate Report
          </button>
          <button
            onClick={() => sendCommand({ action: 'get-report', period } as WsCommand)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-stone-800/60 text-stone-300 border border-stone-700/40 text-xs font-medium hover:bg-stone-800/80 transition-colors"
          >
            <Download size={12} />
            Export Markdown
          </button>
          <button
            onClick={() => sendCommand({ action: 'get-report', period } as WsCommand)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-stone-800/60 text-stone-300 border border-stone-700/40 text-xs font-medium hover:bg-stone-800/80 transition-colors"
          >
            <Download size={12} />
            Export JSON
          </button>
        </div>
      </div>
    </div>
  );
}

function SummaryCard({
  icon,
  label,
  value,
  sub,
  color,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub: string;
  color: string;
}) {
  return (
    <div className="p-3 rounded-lg bg-stone-900/40 border border-stone-800/40">
      <div className="flex items-center gap-1.5 mb-1">
        {icon}
        <span className="text-[10px] text-stone-500 uppercase tracking-wider">{label}</span>
      </div>
      <div className={`text-xl font-semibold ${color} mt-1`}>{value}</div>
      <div className="text-[10px] text-stone-500 mt-0.5">{sub}</div>
    </div>
  );
}

function MetricItem({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
}) {
  return (
    <div className="flex items-center gap-2">
      <div className="text-stone-500">{icon}</div>
      <div>
        <div className="text-sm font-semibold text-stone-200">{value.toLocaleString()}</div>
        <div className="text-[10px] text-stone-500">{label}</div>
      </div>
    </div>
  );
}

function GaugeMetric({
  label,
  value,
  color,
  invert,
}: {
  label: string;
  value: number;
  color: 'emerald' | 'rose' | 'blue';
  invert?: boolean;
}) {
  const fillColor = {
    emerald: 'bg-emerald-500/60',
    rose: 'bg-rose-500/60',
    blue: 'bg-blue-500/60',
  }[color];

  const textColor = {
    emerald: 'text-emerald-400',
    rose: 'text-rose-400',
    blue: 'text-blue-400',
  }[color];

  // For inverted metrics (like revert rate), lower is better
  const displayValue = value;
  const barWidth = invert ? Math.max(100 - value, 0) : value;

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs text-stone-400">{label}</span>
        <span className={`text-xs font-mono font-semibold ${textColor}`}>{displayValue}%</span>
      </div>
      <div className="h-2 bg-stone-800/60 rounded overflow-hidden">
        <div className={`h-full rounded ${fillColor}`} style={{ width: `${barWidth}%` }} />
      </div>
      {invert && (
        <div className="text-[9px] text-stone-600 mt-0.5">lower is better</div>
      )}
    </div>
  );
}
