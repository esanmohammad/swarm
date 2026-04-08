import { useMemo, useState } from 'react';
import {
  BarChart3, TrendingUp, DollarSign, Clock, Zap, Wrench,
  CheckCircle2, XCircle, Cpu, ArrowUpRight, ArrowDownRight,
  RefreshCw, GitPullRequest, Search as SearchIcon, Minimize2,
  Rocket, ChevronDown, ChevronRight,
} from 'lucide-react';
import type { HistoryEntry, PipelineState, StageName } from '../../types';

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

interface StatsCanvasProps {
  stats: StatsData | null;
  historyEntries: HistoryEntry[];
  state?: PipelineState;
}

// ── Stat Card ──
function StatCard({ icon: Icon, label, value, sub, trend }: {
  icon: typeof BarChart3; label: string; value: string; sub?: string;
  trend?: { direction: 'up' | 'down' | 'neutral'; label: string };
}) {
  return (
    <div
      className="rounded-lg p-4"
      style={{ backgroundColor: 'var(--bg-surface)', border: '1px solid var(--border-muted)' }}
    >
      <div className="flex items-center gap-2 mb-2">
        <Icon size={13} style={{ color: 'var(--text-tertiary)' }} />
        <span className="text-[10px] uppercase tracking-wider font-ui" style={{ color: 'var(--text-tertiary)' }}>
          {label}
        </span>
      </div>
      <div className="text-2xl font-semibold tabular-nums font-code" style={{ color: 'var(--text-primary)' }}>
        {value}
      </div>
      <div className="flex items-center gap-2 mt-1">
        {sub && <span className="text-[10px]" style={{ color: 'var(--text-disabled)' }}>{sub}</span>}
        {trend && (
          <span className="flex items-center gap-0.5 text-[10px]" style={{
            color: trend.direction === 'up' ? 'var(--status-success)' : trend.direction === 'down' ? 'var(--status-error)' : 'var(--text-disabled)',
          }}>
            {trend.direction === 'up' ? <ArrowUpRight size={9} /> : trend.direction === 'down' ? <ArrowDownRight size={9} /> : null}
            {trend.label}
          </span>
        )}
      </div>
    </div>
  );
}

// ── Horizontal bar ──
function Bar({ value, max, color }: { value: number; max: number; color: string }) {
  const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0;
  return (
    <div className="h-2 rounded-full flex-1" style={{ backgroundColor: 'var(--bg-inset)' }}>
      <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: color }} />
    </div>
  );
}

// ── Section ──
function Section({ title, children, defaultOpen = true }: { title: string; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-lg overflow-hidden" style={{ border: '1px solid var(--border-muted)' }}>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 w-full px-4 py-2.5 text-left"
        style={{ backgroundColor: 'var(--bg-surface)' }}
      >
        {open ? <ChevronDown size={12} style={{ color: 'var(--text-disabled)' }} /> : <ChevronRight size={12} style={{ color: 'var(--text-disabled)' }} />}
        <span className="text-[10px] uppercase tracking-wider font-semibold font-ui" style={{ color: 'var(--text-tertiary)' }}>
          {title}
        </span>
      </button>
      {open && <div style={{ backgroundColor: 'var(--bg-surface)' }}>{children}</div>}
    </div>
  );
}

// ── Activity Type Config ──
const ACTIVITY_META: Record<string, { icon: typeof Rocket; color: string; label: string }> = {
  pipeline: { icon: Rocket, color: 'var(--activity-pipeline)', label: 'Pipeline' },
  fix: { icon: Wrench, color: 'var(--activity-fix)', label: 'Fix' },
  review: { icon: GitPullRequest, color: 'var(--activity-review)', label: 'Review' },
  spike: { icon: SearchIcon, color: 'var(--activity-spike)', label: 'Spike' },
  refactor: { icon: RefreshCw, color: 'var(--activity-refactor)', label: 'Refactor' },
  simplify: { icon: Minimize2, color: 'var(--activity-simplify)', label: 'Simplify' },
};

const STAGE_ORDER: StageName[] = ['analyze', 'architect', 'plan', 'build', 'validate', 'ship'];

export function StatsCanvas({ stats, historyEntries, state }: StatsCanvasProps) {
  const computed = stats ?? computeStats(historyEntries, state);
  const deep = useDeepStats(historyEntries);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div
        className="flex items-center gap-2 px-4 py-2.5 shrink-0"
        style={{ backgroundColor: 'var(--bg-surface)', borderBottom: '1px solid var(--border-muted)' }}
      >
        <BarChart3 size={14} style={{ color: 'var(--text-secondary)' }} />
        <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>Usage & Costs</span>
        <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
          {historyEntries.length} activities tracked
        </span>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* ── Overview Cards ── */}
        <div className="grid grid-cols-4 gap-3">
          <StatCard
            icon={Zap}
            label="Total Runs"
            value={String(computed.totalRuns)}
            sub={`${computed.passed} passed · ${computed.failed} failed`}
          />
          <StatCard
            icon={TrendingUp}
            label="Success Rate"
            value={`${Math.round(computed.successRate)}%`}
            trend={deep.successTrend}
          />
          <StatCard
            icon={DollarSign}
            label="Total Cost"
            value={`$${computed.totalCost.toFixed(2)}`}
            sub={`$${computed.avgCostPerRun.toFixed(2)} avg/run`}
            trend={deep.costTrend}
          />
          <StatCard
            icon={Clock}
            label="Avg Duration"
            value={formatDuration(computed.avgDurationMs)}
            sub={deep.totalDuration}
          />
        </div>

        {/* ── Token Usage ── */}
        <Section title="Token Usage">
          <div className="grid grid-cols-4 gap-px" style={{ borderTop: '1px solid var(--border-muted)' }}>
            {[
              { label: 'Input', value: deep.tokens.input, color: 'var(--accent)' },
              { label: 'Output', value: deep.tokens.output, color: 'var(--activity-pipeline)' },
              { label: 'Cache Read', value: deep.tokens.cacheRead, color: 'var(--status-success)' },
              { label: 'Cache Write', value: deep.tokens.cacheWrite, color: 'var(--status-warning)' },
            ].map((t) => (
              <div key={t.label} className="px-4 py-3 text-center" style={{ borderRight: '1px solid var(--border-muted)' }}>
                <div className="text-[10px] uppercase tracking-wider mb-1" style={{ color: 'var(--text-tertiary)' }}>{t.label}</div>
                <div className="text-sm font-semibold tabular-nums font-code" style={{ color: t.color }}>{formatTokens(t.value)}</div>
              </div>
            ))}
          </div>
        </Section>

        {/* ── Activity Type Breakdown ── */}
        <Section title="Activity Breakdown">
          <div style={{ borderTop: '1px solid var(--border-muted)' }}>
            {deep.activityBreakdown.map((ab) => {
              const meta = ACTIVITY_META[ab.type] || { icon: Zap, color: 'var(--text-secondary)', label: ab.type };
              const Icon = meta.icon;
              return (
                <div
                  key={ab.type}
                  className="flex items-center gap-3 px-4 py-2.5"
                  style={{ borderBottom: '1px solid var(--border-muted)' }}
                >
                  <Icon size={12} style={{ color: meta.color }} className="shrink-0" />
                  <span className="text-xs font-medium w-20 shrink-0" style={{ color: 'var(--text-primary)' }}>{meta.label}</span>
                  <Bar value={ab.count} max={deep.activityBreakdown[0]?.count ?? 1} color={meta.color} />
                  <div className="flex items-center gap-3 shrink-0 text-xs tabular-nums font-code">
                    <span style={{ color: 'var(--text-secondary)' }}>{ab.count} runs</span>
                    <span style={{ color: ab.successRate >= 80 ? 'var(--status-success)' : ab.successRate >= 50 ? 'var(--status-warning)' : 'var(--status-error)' }}>
                      {Math.round(ab.successRate)}%
                    </span>
                    <span style={{ color: 'var(--text-primary)' }}>${ab.totalCost.toFixed(2)}</span>
                    <span style={{ color: 'var(--text-tertiary)' }}>{formatDuration(ab.avgDuration)}</span>
                  </div>
                </div>
              );
            })}
            {deep.activityBreakdown.length === 0 && (
              <div className="px-4 py-6 text-center text-xs" style={{ color: 'var(--text-disabled)' }}>No activities yet</div>
            )}
          </div>
        </Section>

        {/* ── Stage Cost Breakdown (from server stats) ── */}
        {computed.stageCosts.length > 0 && (
          <Section title="Cost by Pipeline Stage">
            <div style={{ borderTop: '1px solid var(--border-muted)' }}>
              {computed.stageCosts.map((sc) => (
                <div
                  key={sc.stage}
                  className="flex items-center gap-3 px-4 py-2.5"
                  style={{ borderBottom: '1px solid var(--border-muted)' }}
                >
                  <span className="text-xs capitalize w-20 shrink-0" style={{ color: 'var(--text-primary)' }}>{sc.stage}</span>
                  <Bar value={sc.totalCost} max={computed.stageCosts.reduce((m, s) => Math.max(m, s.totalCost), 0)} color="var(--accent)" />
                  <div className="flex items-center gap-4 shrink-0 text-xs tabular-nums font-code">
                    <span style={{ color: 'var(--text-secondary)' }}>{sc.count} runs</span>
                    <span style={{ color: 'var(--text-primary)' }}>${sc.totalCost.toFixed(2)}</span>
                    <span style={{ color: 'var(--text-tertiary)' }}>${sc.avgCost.toFixed(2)}/run</span>
                    <span style={{ color: 'var(--text-tertiary)' }}>{formatDuration(sc.avgDurationMs)}</span>
                  </div>
                </div>
              ))}
            </div>
          </Section>
        )}

        {/* ── Weekly Spend ── */}
        {deep.weeklyData.length > 0 && (
          <Section title="Weekly Spend">
            <div style={{ borderTop: '1px solid var(--border-muted)' }}>
              {deep.weeklyData.map((w) => (
                <div
                  key={w.week}
                  className="flex items-center gap-3 px-4 py-2"
                  style={{ borderBottom: '1px solid var(--border-muted)' }}
                >
                  <span className="text-xs w-20 shrink-0 tabular-nums font-code" style={{ color: 'var(--text-secondary)' }}>{w.week}</span>
                  <Bar value={w.cost} max={deep.weeklyData.reduce((m, ww) => Math.max(m, ww.cost), 0)} color="var(--accent)" />
                  <div className="flex items-center gap-3 shrink-0 text-xs tabular-nums font-code">
                    <span style={{ color: 'var(--text-primary)' }}>${w.cost.toFixed(2)}</span>
                    <span style={{ color: 'var(--text-tertiary)' }}>{w.runs} runs</span>
                  </div>
                </div>
              ))}
            </div>
          </Section>
        )}

        {/* ── Fix Loop Analysis ── */}
        {deep.fixLoopStats.totalFixes > 0 && (
          <Section title="Fix Loop Analysis">
            <div className="grid grid-cols-3 gap-px" style={{ borderTop: '1px solid var(--border-muted)' }}>
              <div className="px-4 py-3 text-center" style={{ borderRight: '1px solid var(--border-muted)' }}>
                <div className="text-[10px] uppercase tracking-wider mb-1" style={{ color: 'var(--text-tertiary)' }}>Fix Runs</div>
                <div className="text-lg font-semibold tabular-nums font-code" style={{ color: 'var(--activity-fix)' }}>{deep.fixLoopStats.totalFixes}</div>
              </div>
              <div className="px-4 py-3 text-center" style={{ borderRight: '1px solid var(--border-muted)' }}>
                <div className="text-[10px] uppercase tracking-wider mb-1" style={{ color: 'var(--text-tertiary)' }}>Avg Iterations</div>
                <div className="text-lg font-semibold tabular-nums font-code" style={{ color: 'var(--text-primary)' }}>{deep.fixLoopStats.avgIterations.toFixed(1)}</div>
              </div>
              <div className="px-4 py-3 text-center">
                <div className="text-[10px] uppercase tracking-wider mb-1" style={{ color: 'var(--text-tertiary)' }}>Fix Cost</div>
                <div className="text-lg font-semibold tabular-nums font-code" style={{ color: 'var(--text-primary)' }}>${deep.fixLoopStats.totalFixCost.toFixed(2)}</div>
              </div>
            </div>
          </Section>
        )}

        {/* ── Recent Activity Table ── */}
        <Section title="Recent Activity" defaultOpen={false}>
          <div style={{ borderTop: '1px solid var(--border-muted)' }}>
            {/* Header */}
            <div
              className="flex items-center gap-2 px-4 py-1.5 text-[10px] uppercase tracking-wider font-ui"
              style={{ color: 'var(--text-disabled)', borderBottom: '1px solid var(--border-muted)' }}
            >
              <span className="w-6">St</span>
              <span className="flex-1">Activity</span>
              <span className="w-14 text-right">Cost</span>
              <span className="w-14 text-right">Duration</span>
              <span className="w-20 text-right">Date</span>
            </div>
            {historyEntries.slice(0, 20).map((entry) => {
              const isSuccess = entry.activityStatus === 'success';
              const isError = entry.activityStatus === 'error';
              return (
                <div
                  key={entry.runId}
                  className="flex items-center gap-2 px-4 py-1.5 text-xs"
                  style={{ borderBottom: '1px solid var(--border-muted)' }}
                >
                  <span className="w-6 shrink-0">
                    {isSuccess ? <CheckCircle2 size={11} style={{ color: 'var(--status-success)' }} /> :
                     isError ? <XCircle size={11} style={{ color: 'var(--status-error)' }} /> :
                     <Clock size={11} style={{ color: 'var(--text-disabled)' }} />}
                  </span>
                  <span className="flex-1 truncate" style={{ color: 'var(--text-primary)' }}>
                    {entry.summary || entry.featureRequest || entry.projectName}
                  </span>
                  <span className="w-14 text-right tabular-nums font-code shrink-0" style={{ color: 'var(--text-secondary)' }}>
                    ${(entry.totalCost?.totalUsd ?? 0).toFixed(2)}
                  </span>
                  <span className="w-14 text-right tabular-nums font-code shrink-0" style={{ color: 'var(--text-tertiary)' }}>
                    {formatDuration(entry.durationMs ?? 0)}
                  </span>
                  <span className="w-20 text-right tabular-nums font-code shrink-0" style={{ color: 'var(--text-disabled)' }}>
                    {new Date(entry.timestamp).toLocaleDateString([], { month: 'short', day: 'numeric' })}
                  </span>
                </div>
              );
            })}
            {historyEntries.length === 0 && (
              <div className="px-4 py-6 text-center text-xs" style={{ color: 'var(--text-disabled)' }}>No activity history</div>
            )}
          </div>
        </Section>

        {/* ── Recommendations ── */}
        {computed.recommendations.length > 0 && (
          <Section title="Recommendations">
            <div className="p-4 space-y-2" style={{ borderTop: '1px solid var(--border-muted)' }}>
              {computed.recommendations.map((r, i) => (
                <p key={i} className="text-xs leading-relaxed" style={{ color: 'var(--text-secondary)' }}>{r}</p>
              ))}
            </div>
          </Section>
        )}

        {/* ── Model Usage ── */}
        {deep.modelBreakdown.length > 0 && (
          <Section title="Model Usage" defaultOpen={false}>
            <div style={{ borderTop: '1px solid var(--border-muted)' }}>
              {deep.modelBreakdown.map((m) => (
                <div
                  key={m.model}
                  className="flex items-center gap-3 px-4 py-2"
                  style={{ borderBottom: '1px solid var(--border-muted)' }}
                >
                  <Cpu size={11} style={{ color: 'var(--text-tertiary)' }} className="shrink-0" />
                  <span className="text-xs w-28 shrink-0 truncate" style={{ color: 'var(--text-primary)' }}>{m.model}</span>
                  <Bar value={m.count} max={deep.modelBreakdown[0]?.count ?? 1} color="var(--activity-pipeline)" />
                  <div className="flex items-center gap-3 shrink-0 text-xs tabular-nums font-code">
                    <span style={{ color: 'var(--text-secondary)' }}>{m.count} runs</span>
                    <span style={{ color: 'var(--text-primary)' }}>${m.totalCost.toFixed(2)}</span>
                  </div>
                </div>
              ))}
            </div>
          </Section>
        )}
      </div>
    </div>
  );
}

// ── Deep stats computed from history entries ──

interface DeepStats {
  tokens: { input: number; output: number; cacheRead: number; cacheWrite: number };
  activityBreakdown: Array<{ type: string; count: number; successRate: number; totalCost: number; avgDuration: number }>;
  weeklyData: Array<{ week: string; cost: number; runs: number }>;
  fixLoopStats: { totalFixes: number; avgIterations: number; totalFixCost: number };
  modelBreakdown: Array<{ model: string; count: number; totalCost: number }>;
  successTrend: { direction: 'up' | 'down' | 'neutral'; label: string } | undefined;
  costTrend: { direction: 'up' | 'down' | 'neutral'; label: string } | undefined;
  totalDuration: string;
}

function useDeepStats(entries: HistoryEntry[]): DeepStats {
  return useMemo(() => {
    // Tokens
    const tokens = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
    for (const e of entries) {
      if (e.totalCost) {
        tokens.input += e.totalCost.inputTokens ?? 0;
        tokens.output += e.totalCost.outputTokens ?? 0;
        tokens.cacheRead += e.totalCost.cacheReadTokens ?? 0;
        tokens.cacheWrite += e.totalCost.cacheWriteTokens ?? 0;
      }
    }

    // Activity breakdown
    const byType = new Map<string, { count: number; passed: number; cost: number; duration: number }>();
    for (const e of entries) {
      const t = e.activityType || 'pipeline';
      const existing = byType.get(t) || { count: 0, passed: 0, cost: 0, duration: 0 };
      existing.count++;
      if (e.activityStatus === 'success') existing.passed++;
      existing.cost += e.totalCost?.totalUsd ?? 0;
      existing.duration += e.durationMs ?? 0;
      byType.set(t, existing);
    }
    const activityBreakdown = Array.from(byType.entries())
      .map(([type, data]) => ({
        type,
        count: data.count,
        successRate: data.count > 0 ? (data.passed / data.count) * 100 : 0,
        totalCost: data.cost,
        avgDuration: data.count > 0 ? data.duration / data.count : 0,
      }))
      .sort((a, b) => b.count - a.count);

    // Weekly data
    const byWeek = new Map<string, { cost: number; runs: number }>();
    for (const e of entries) {
      const d = new Date(e.timestamp);
      // Get ISO week start (Monday)
      const monday = new Date(d);
      monday.setDate(d.getDate() - ((d.getDay() + 6) % 7));
      const weekKey = `${monday.getMonth() + 1}/${monday.getDate()}`;
      const existing = byWeek.get(weekKey) || { cost: 0, runs: 0 };
      existing.cost += e.totalCost?.totalUsd ?? 0;
      existing.runs++;
      byWeek.set(weekKey, existing);
    }
    const weeklyData = Array.from(byWeek.entries())
      .map(([week, data]) => ({ week, ...data }))
      .slice(-8);

    // Fix loop stats
    const fixes = entries.filter((e) => e.activityType === 'fix' || (e.fixIterations != null && e.fixIterations > 0));
    const totalFixIterations = fixes.reduce((sum, e) => sum + (e.fixIterations ?? 1), 0);
    const fixLoopStats = {
      totalFixes: fixes.length,
      avgIterations: fixes.length > 0 ? totalFixIterations / fixes.length : 0,
      totalFixCost: fixes.reduce((sum, e) => sum + (e.totalCost?.totalUsd ?? 0), 0),
    };

    // Model breakdown
    const byModel = new Map<string, { count: number; cost: number }>();
    for (const e of entries) {
      const model = e.model || 'unknown';
      const existing = byModel.get(model) || { count: 0, cost: 0 };
      existing.count++;
      existing.cost += e.totalCost?.totalUsd ?? 0;
      byModel.set(model, existing);
    }
    const modelBreakdown = Array.from(byModel.entries())
      .map(([model, data]) => ({ model, count: data.count, totalCost: data.cost }))
      .sort((a, b) => b.count - a.count);

    // Trends (compare last 5 vs previous 5)
    const sorted = [...entries].sort((a, b) => b.timestamp - a.timestamp);
    const recent5 = sorted.slice(0, 5);
    const prev5 = sorted.slice(5, 10);
    let successTrend: DeepStats['successTrend'];
    let costTrend: DeepStats['costTrend'];

    if (recent5.length >= 3 && prev5.length >= 3) {
      const recentSuccessRate = recent5.filter((e) => e.activityStatus === 'success').length / recent5.length;
      const prevSuccessRate = prev5.filter((e) => e.activityStatus === 'success').length / prev5.length;
      const diff = recentSuccessRate - prevSuccessRate;
      if (Math.abs(diff) > 0.1) {
        successTrend = {
          direction: diff > 0 ? 'up' : 'down',
          label: `${Math.abs(Math.round(diff * 100))}% vs prev`,
        };
      }

      const recentAvgCost = recent5.reduce((s, e) => s + (e.totalCost?.totalUsd ?? 0), 0) / recent5.length;
      const prevAvgCost = prev5.reduce((s, e) => s + (e.totalCost?.totalUsd ?? 0), 0) / prev5.length;
      const costDiff = prevAvgCost > 0 ? (recentAvgCost - prevAvgCost) / prevAvgCost : 0;
      if (Math.abs(costDiff) > 0.1) {
        costTrend = {
          direction: costDiff > 0 ? 'up' : 'down',
          label: `${Math.abs(Math.round(costDiff * 100))}% vs prev`,
        };
      }
    }

    // Total duration
    const totalMs = entries.reduce((sum, e) => sum + (e.durationMs ?? 0), 0);
    const totalDuration = `Total: ${formatDuration(totalMs)}`;

    return { tokens, activityBreakdown, weeklyData, fixLoopStats, modelBreakdown, successTrend, costTrend, totalDuration };
  }, [entries]);
}

function computeStats(entries: HistoryEntry[], state?: PipelineState): StatsData {
  const totalRuns = entries.length || (state ? 1 : 0);
  const passed = entries.filter((e) => e.activityStatus === 'success').length;
  const failed = entries.filter((e) => e.activityStatus === 'error').length + (
    state && !entries.length && STAGE_ORDER.some((s) => state.stages[s]?.status === 'error') ? 1 : 0
  );

  // Cost from history + current state
  let totalCost = entries.reduce((sum, e) => sum + (e.totalCost?.totalUsd ?? 0), 0);
  const totalDuration = entries.reduce((sum, e) => sum + (e.durationMs ?? 0), 0);

  // If no history cost, compute from current state
  if (totalCost === 0 && state) {
    totalCost = state.totalCost?.totalUsd > 0
      ? state.totalCost.totalUsd
      : state.agents.reduce((sum, a) => sum + (a.cost?.totalUsd ?? 0), 0) ||
        STAGE_ORDER.reduce((sum, s) => sum + (state.stages[s]?.stageCost ?? 0), 0);
  }

  // Stage costs from history breakdowns + current state
  const stageMap = new Map<string, { totalCost: number; count: number; totalDuration: number }>();
  for (const e of entries) {
    if (e.stageBreakdowns) {
      for (const sb of e.stageBreakdowns) {
        const existing = stageMap.get(sb.name) || { totalCost: 0, count: 0, totalDuration: 0 };
        existing.totalCost += sb.cost ?? 0;
        existing.count++;
        existing.totalDuration += sb.durationMs ?? 0;
        stageMap.set(sb.name, existing);
      }
    }
  }
  // Also add current state stages if no history
  if (stageMap.size === 0 && state) {
    for (const s of STAGE_ORDER) {
      const st = state.stages[s];
      if (st?.stageCost && st.stageCost > 0) {
        const dur = (st.finishedAt && st.startedAt) ? st.finishedAt - st.startedAt : 0;
        stageMap.set(s, { totalCost: st.stageCost, count: 1, totalDuration: dur });
      }
    }
  }
  const stageCosts = Array.from(stageMap.entries()).map(([stage, data]) => ({
    stage,
    totalCost: data.totalCost,
    avgCost: data.count > 0 ? data.totalCost / data.count : 0,
    avgDurationMs: data.count > 0 ? data.totalDuration / data.count : 0,
    count: data.count,
  }));

  return {
    totalRuns,
    passed,
    failed,
    successRate: totalRuns > 0 ? (passed / totalRuns) * 100 : 0,
    totalCost,
    avgCostPerRun: totalRuns > 0 ? totalCost / totalRuns : 0,
    avgDurationMs: totalRuns > 0 ? totalDuration / totalRuns : 0,
    avgFixIterations: 0,
    stageCosts,
    weeklySpend: [],
    recommendations: [],
  };
}

function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}
