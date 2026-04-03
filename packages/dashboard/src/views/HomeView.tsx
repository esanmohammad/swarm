import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Rocket, Wrench, GitPullRequest, Search, RefreshCw, Sparkles,
  Play, ChevronDown, ChevronUp, Clock,
  CheckCircle, XCircle, Loader2, ArrowRight,
  Activity, X
} from 'lucide-react';
import type { WsCommand, PipelineState, HistoryEntry, AgentActivity } from '../types';

type ActionMode = 'build' | 'fix' | 'review' | 'spike' | 'refactor' | 'simplify' | null;

interface ActionConfig {
  mode: ActionMode;
  label: string;
  icon: typeof Rocket;
  placeholder: string;
  description: string;
  costEstimate: string;
  color: string;
}

const ACTIONS: ActionConfig[] = [
  { mode: 'build', label: 'Build Feature', icon: Rocket, placeholder: 'Describe the feature to build...', description: 'Full 5-stage pipeline: Analyze → Architect → Plan → Build → Test', costEstimate: '$2-8', color: 'text-blue-400 bg-blue-950/30 border-blue-800/30 hover:bg-blue-950/50' },
  { mode: 'fix', label: 'Fix Bug', icon: Wrench, placeholder: 'Describe the bug to fix...', description: 'Analyzes the issue, finds root cause, creates a fix', costEstimate: '$0.50-2', color: 'text-amber-400 bg-amber-950/30 border-amber-800/30 hover:bg-amber-950/50' },
  { mode: 'review', label: 'Review PRs', icon: GitPullRequest, placeholder: 'PR number or URL (or leave empty for current branch)...', description: 'Reviews code, posts comments to GitHub', costEstimate: '$0.05-0.20', color: 'text-green-400 bg-green-950/30 border-green-800/30 hover:bg-green-950/50' },
  { mode: 'spike', label: 'Spike', icon: Search, placeholder: 'What do you want to explore?', description: 'Quick codebase exploration without making changes', costEstimate: '$0.10-0.50', color: 'text-purple-400 bg-purple-950/30 border-purple-800/30 hover:bg-purple-950/50' },
  { mode: 'refactor', label: 'Refactor', icon: RefreshCw, placeholder: 'What to refactor...', description: 'Improves code structure without changing behavior', costEstimate: '$0.50-2', color: 'text-cyan-400 bg-cyan-950/30 border-cyan-800/30 hover:bg-cyan-950/50' },
  { mode: 'simplify', label: 'Simplify', icon: Sparkles, placeholder: 'What to simplify (or leave empty for recent changes)...', description: 'Reduces complexity and improves readability', costEstimate: '$0.20-1', color: 'text-pink-400 bg-pink-950/30 border-pink-800/30 hover:bg-pink-950/50' },
];

interface HomeViewProps {
  sendCommand: (cmd: WsCommand) => void;
  state: PipelineState | null;
  agentOutputs: Map<string, string>;
  agentActivities: Map<string, AgentActivity[]>;
  historyEntries: HistoryEntry[];
}

function formatElapsed(ms: number): string {
  if (ms < 1000) return '<1s';
  if (ms < 60000) return `${Math.round(ms / 1000)}s`;
  return `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`;
}

function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return new Date(ts).toLocaleDateString();
}

export function HomeView({ sendCommand, state, agentOutputs, agentActivities, historyEntries }: HomeViewProps) {
  const navigate = useNavigate();
  const [selectedMode, setSelectedMode] = useState<ActionMode>(null);
  const [input, setInput] = useState('');
  const [expandedAgents, setExpandedAgents] = useState<Set<string>>(new Set());
  const inputRef = useRef<HTMLInputElement>(null);

  const selectedAction = ACTIONS.find(a => a.mode === selectedMode);

  // Focus input when mode changes
  useEffect(() => {
    if (selectedMode) inputRef.current?.focus();
  }, [selectedMode]);

  const handleExecute = useCallback(() => {
    if (!selectedMode) return;
    const text = input.trim();

    switch (selectedMode) {
      case 'build':
        if (!text) return;
        sendCommand({ action: 'run-mayday', prompt: text, model: 'sonnet' } as WsCommand);
        break;
      case 'fix':
        if (!text) return;
        sendCommand({ action: 'run-fix', issue: text } as WsCommand);
        break;
      case 'review':
        sendCommand({ action: 'run-review', target: text || undefined });
        break;
      case 'spike':
        if (!text) return;
        sendCommand({ action: 'run-spike', prompt: text });
        break;
      case 'refactor':
        sendCommand({ action: 'run-refactor', prompt: text || 'Refactor recent changes' });
        break;
      case 'simplify':
        sendCommand({ action: 'run-simplify', scope: text || undefined });
        break;
    }

    setInput('');
  }, [selectedMode, input, sendCommand]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleExecute();
    }
    if (e.key === 'Escape') {
      setSelectedMode(null);
      setInput('');
    }
  };

  // Get running agents
  const runningAgents = state ? state.agents.filter(a => a.status === 'running') : [];
  const maydayActive = state?.mayday?.active;

  const toggleExpand = (id: string) => {
    setExpandedAgents(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-4xl mx-auto p-6 space-y-6">

        {/* Action Launcher */}
        <section>
          <h2 className="text-xs font-semibold text-stone-500 uppercase tracking-wider mb-3">What do you want to do?</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 mb-3">
            {ACTIONS.map((action) => {
              const Icon = action.icon;
              const isSelected = selectedMode === action.mode;
              return (
                <button
                  key={action.mode}
                  onClick={() => setSelectedMode(isSelected ? null : action.mode)}
                  className={`flex flex-col items-center gap-1.5 px-3 py-3 rounded-lg border text-xs font-medium transition-all ${
                    isSelected ? action.color + ' ring-1 ring-current' : 'border-stone-800/50 text-stone-500 hover:text-stone-300 hover:bg-stone-800/30 hover:border-stone-700/50'
                  }`}
                >
                  <Icon size={18} />
                  <span>{action.label}</span>
                </button>
              );
            })}
          </div>

          {/* Input area - shown when mode selected */}
          {selectedAction && (
            <div className={`rounded-lg border p-4 ${selectedAction.color.split(' ').slice(1).join(' ')}`}>
              <div className="flex items-center gap-2 mb-2">
                <selectedAction.icon size={14} className={selectedAction.color.split(' ')[0]} />
                <span className="text-xs font-medium text-stone-300">{selectedAction.label}</span>
                <span className="text-[10px] text-stone-600">Est. {selectedAction.costEstimate}</span>
              </div>
              <p className="text-xs text-stone-500 mb-3">{selectedAction.description}</p>
              <div className="flex gap-2">
                <input
                  ref={inputRef}
                  type="text"
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder={selectedAction.placeholder}
                  className="flex-1 bg-stone-900/50 border border-stone-700/50 rounded-md px-3 py-2 text-sm text-stone-300 placeholder-stone-600 focus:outline-none focus:ring-1 focus:ring-stone-600"
                />
                <button
                  onClick={handleExecute}
                  disabled={selectedMode === 'build' && !input.trim() || selectedMode === 'fix' && !input.trim() || selectedMode === 'spike' && !input.trim()}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-md text-xs font-medium bg-stone-800 hover:bg-stone-700 text-stone-200 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  <Play size={12} /> Go
                </button>
              </div>
            </div>
          )}
        </section>

        {/* Live Operations */}
        {runningAgents.length > 0 && (
          <section>
            <h2 className="text-xs font-semibold text-stone-500 uppercase tracking-wider mb-3 flex items-center gap-2">
              <Activity size={12} className="text-green-400" />
              Live Operations ({runningAgents.length} running)
            </h2>
            <div className="space-y-2">
              {runningAgents.map((agent) => {
                const output = agentOutputs.get(agent.id) || '';
                const activities = agentActivities.get(agent.id) || [];
                const lastActivity = activities[activities.length - 1];
                const isExpanded = expandedAgents.has(agent.id);
                const outputLines = output.split('\n');
                const preview = outputLines.slice(-3).join('\n');

                return (
                  <div key={agent.id} className="rounded-lg border border-stone-800/50 bg-stone-900/30 overflow-hidden">
                    <div className="px-4 py-3">
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-2">
                          <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                          <span className="text-xs font-medium text-stone-300">{agent.persona}</span>
                          {agent.name && <span className="text-xs text-stone-500 truncate max-w-xs">— {agent.name}</span>}
                        </div>
                        <div className="flex items-center gap-3 text-[10px] text-stone-600">
                          {agent.cost && <span className="text-amber-400">${agent.cost.totalUsd.toFixed(2)}</span>}
                          <Clock size={10} />
                          {agent.startedAt && <span>{formatElapsed(Date.now() - agent.startedAt)}</span>}
                        </div>
                      </div>

                      {/* Current activity */}
                      {lastActivity && (
                        <p className="text-[10px] text-stone-500 mb-2">
                          {lastActivity.tool ? `${lastActivity.tool}: ` : ''}{lastActivity.content?.substring(0, 100)}
                        </p>
                      )}

                      {/* Output preview / full */}
                      <div className="relative">
                        <pre className={`text-[10px] text-stone-600 font-mono bg-stone-950/50 rounded p-2 overflow-x-auto ${isExpanded ? 'max-h-60' : 'max-h-16'} overflow-y-auto whitespace-pre-wrap`}>
                          {isExpanded ? output.slice(-5000) : preview}
                        </pre>
                      </div>

                      <div className="flex items-center gap-2 mt-2">
                        <button
                          onClick={() => toggleExpand(agent.id)}
                          className="flex items-center gap-1 text-[10px] text-stone-600 hover:text-stone-400"
                        >
                          {isExpanded ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
                          {isExpanded ? 'Collapse' : 'Expand output'}
                        </button>
                        {maydayActive && agent.persona === 'engineer' && (
                          <button
                            onClick={() => navigate('/pipeline')}
                            className="flex items-center gap-1 text-[10px] text-blue-400 hover:text-blue-300 ml-auto"
                          >
                            View Full Pipeline <ArrowRight size={10} />
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}

              {/* MayDay compact card */}
              {maydayActive && state?.mayday && (
                <div className="rounded-lg border border-blue-800/30 bg-blue-950/20 px-4 py-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Rocket size={14} className="text-blue-400" />
                      <span className="text-xs font-medium text-blue-400">MayDay Pipeline</span>
                      <span className="text-xs text-stone-500">{state.mayday.currentStage}</span>
                    </div>
                    <button
                      onClick={() => navigate('/pipeline')}
                      className="flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300"
                    >
                      View Pipeline <ArrowRight size={12} />
                    </button>
                  </div>
                  {/* Stage progress dots */}
                  <div className="flex items-center gap-1 mt-2">
                    {['analyze', 'architect', 'plan', 'build', 'test'].map((stage) => {
                      const stageData = state.stages[stage as keyof typeof state.stages];
                      const isDone = stageData?.status === 'done';
                      const isRunning = stageData?.status === 'running';
                      const isError = stageData?.status === 'error';
                      return (
                        <div key={stage} className="flex items-center gap-1">
                          <div className={`w-2 h-2 rounded-full ${
                            isDone ? 'bg-green-500' :
                            isRunning ? 'bg-blue-500 animate-pulse' :
                            isError ? 'bg-red-500' :
                            'bg-stone-700'
                          }`} />
                          <span className={`text-[10px] ${isRunning ? 'text-blue-400' : isDone ? 'text-green-400' : 'text-stone-600'}`}>{stage}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </section>
        )}

        {/* Needs Attention */}
        {state && (
          <section>
            <h2 className="text-xs font-semibold text-stone-500 uppercase tracking-wider mb-3">Needs Attention</h2>
            <div className="space-y-1.5">
              {/* Check for errors in pipeline stages */}
              {Object.entries(state.stages).filter(([, s]) => s.status === 'error').map(([stage]) => (
                <div key={stage} className="flex items-center gap-2 px-3 py-2 rounded-md bg-red-950/20 border border-red-800/20">
                  <XCircle size={14} className="text-red-400 shrink-0" />
                  <span className="text-xs text-stone-400">Pipeline stage "{stage}" failed</span>
                  <button onClick={() => navigate('/pipeline')} className="ml-auto text-xs text-red-400 hover:text-red-300">View &rarr;</button>
                </div>
              ))}
              {/* No issues */}
              {Object.entries(state.stages).filter(([, s]) => s.status === 'error').length === 0 && (
                <p className="text-xs text-stone-600 px-3 py-2">No issues requiring attention.</p>
              )}
            </div>
          </section>
        )}

        {/* Activity Center — Tabbed View */}
        <ActivityCenter
          historyEntries={historyEntries}
          runningAgents={runningAgents}
          agentOutputs={agentOutputs}
          agentActivities={agentActivities}
          state={state}
        />
      </div>
    </div>
  );
}

// === Activity Center: Tabbed view with Pipelines / Agents / Reviews ===

type ActivityTab = 'pipelines' | 'agents' | 'reviews';

const AGENT_TYPES: Set<string> = new Set(['fix', 'spike', 'refactor', 'simplify', 'test-gen', 'learn', 'check']);
const REVIEW_TYPES: Set<string> = new Set(['review', 'pr']);

function classifyEntry(entry: HistoryEntry): ActivityTab {
  const t = entry.activityType || 'pipeline';
  if (REVIEW_TYPES.has(t)) return 'reviews';
  if (AGENT_TYPES.has(t)) return 'agents';
  return 'pipelines';
}

interface TabStats {
  count: number;
  cost: number;
  successCount: number;
}

function computeTabStats(entries: HistoryEntry[]): TabStats {
  return {
    count: entries.length,
    cost: entries.reduce((s, e) => s + (e.totalCost?.totalUsd || 0), 0),
    successCount: entries.filter(e => {
      if (e.activityStatus) return e.activityStatus === 'success';
      return Object.values(e.stagesSummary).every(s => s === 'done' || s === 'skipped');
    }).length,
  };
}

const TYPE_BADGE: Record<string, { label: string; color: string }> = {
  pipeline: { label: 'Pipeline', color: 'bg-blue-500/20 text-blue-300' },
  fix: { label: 'Fix', color: 'bg-amber-500/20 text-amber-300' },
  review: { label: 'Review', color: 'bg-purple-500/20 text-purple-300' },
  spike: { label: 'Spike', color: 'bg-cyan-500/20 text-cyan-300' },
  refactor: { label: 'Refactor', color: 'bg-emerald-500/20 text-emerald-300' },
  simplify: { label: 'Simplify', color: 'bg-teal-500/20 text-teal-300' },
  'test-gen': { label: 'Test Gen', color: 'bg-pink-500/20 text-pink-300' },
  learn: { label: 'Learn', color: 'bg-indigo-500/20 text-indigo-300' },
  pr: { label: 'PR', color: 'bg-orange-500/20 text-orange-300' },
  check: { label: 'Check', color: 'bg-stone-500/20 text-stone-300' },
};

interface ActivityCenterProps {
  historyEntries: HistoryEntry[];
  runningAgents: PipelineState['agents'];
  agentOutputs: Map<string, string>;
  agentActivities: Map<string, AgentActivity[]>;
  state: PipelineState | null;
}

function ActivityCenter({ historyEntries, runningAgents, agentOutputs, state }: ActivityCenterProps) {
  const [tab, setTab] = useState<ActivityTab>('pipelines');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Classify history entries by tab
  const { pipelines, agents, reviews, allStats, tabStats } = useMemo(() => {
    const pipelines: HistoryEntry[] = [];
    const agents: HistoryEntry[] = [];
    const reviews: HistoryEntry[] = [];

    for (const entry of historyEntries) {
      const bucket = classifyEntry(entry);
      if (bucket === 'pipelines') pipelines.push(entry);
      else if (bucket === 'agents') agents.push(entry);
      else reviews.push(entry);
    }

    const allStats = computeTabStats(historyEntries);
    const tabStats: Record<ActivityTab, TabStats> = {
      pipelines: computeTabStats(pipelines),
      agents: computeTabStats(agents),
      reviews: computeTabStats(reviews),
    };

    return { pipelines, agents, reviews, allStats, tabStats };
  }, [historyEntries]);

  const currentEntries = tab === 'pipelines' ? pipelines : tab === 'agents' ? agents : reviews;
  const currentStats = tabStats[tab];

  // Running items for each tab
  const runningForTab = useMemo(() => {
    if (!state) return [];
    if (tab === 'pipelines') {
      return state.mayday?.active ? runningAgents.filter(a => a.persona !== undefined) : [];
    }
    if (tab === 'agents') {
      // Non-pipeline running agents
      return runningAgents.filter(a => !state.mayday?.active || !['analyst', 'architect', 'lead', 'engineer', 'tester'].includes(a.persona));
    }
    if (tab === 'reviews') {
      return runningAgents.filter(a => a.name?.includes('reviewer'));
    }
    return [];
  }, [tab, runningAgents, state]);

  // Find the selected entry or running agent for detail view
  const selectedEntry = currentEntries.find(e => e.runId === selectedId);
  const selectedAgent = selectedId ? state?.agents.find(a => a.id === selectedId) : null;

  const TABS: { key: ActivityTab; label: string; icon: typeof Rocket }[] = [
    { key: 'pipelines', label: 'Pipelines', icon: Rocket },
    { key: 'agents', label: 'Agents', icon: Wrench },
    { key: 'reviews', label: 'Reviews', icon: GitPullRequest },
  ];

  return (
    <section>
      {/* Tab bar */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-1">
          {TABS.map(t => {
            const count = tabStats[t.key].count + (t.key === tab ? runningForTab.length : 0);
            const isActive = tab === t.key;
            return (
              <button
                key={t.key}
                onClick={() => { setTab(t.key); setSelectedId(null); }}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                  isActive
                    ? 'bg-stone-800/60 text-stone-200'
                    : 'text-stone-500 hover:text-stone-300 hover:bg-stone-800/30'
                }`}
              >
                <t.icon size={12} />
                {t.label}
                {count > 0 && (
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${isActive ? 'bg-stone-700 text-stone-300' : 'bg-stone-800 text-stone-500'}`}>
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Cumulative stats */}
        <div className="flex items-center gap-3 text-[10px] text-stone-500">
          <span>{allStats.count} total</span>
          <span className="text-amber-400">${allStats.cost.toFixed(2)}</span>
          <span>{allStats.count > 0 ? Math.round((allStats.successCount / allStats.count) * 100) : 0}% success</span>
        </div>
      </div>

      {/* Per-tab stats bar */}
      {currentStats.count > 0 && (
        <div className="flex items-center gap-4 px-3 py-2 mb-2 rounded-md bg-stone-900/30 border border-stone-800/30 text-[10px]">
          <span className="text-stone-400">{currentStats.count} runs</span>
          <span className="text-amber-400">${currentStats.cost.toFixed(2)} spent</span>
          <span className="text-green-400">{Math.round((currentStats.successCount / currentStats.count) * 100)}% success rate</span>
          {currentStats.count > 0 && (
            <span className="text-stone-500">avg ${(currentStats.cost / currentStats.count).toFixed(2)}/run</span>
          )}
        </div>
      )}

      {/* Content area: split view when item selected */}
      <div className={selectedId ? 'grid grid-cols-1 lg:grid-cols-2 gap-3' : ''}>
        {/* List panel (scrollable) */}
        <div className="max-h-[500px] overflow-y-auto space-y-1.5 pr-1 scrollbar-thin">
          {/* Running items pinned at top */}
          {runningForTab.map(agent => (
            <button
              key={agent.id}
              onClick={() => setSelectedId(agent.id)}
              className={`w-full text-left flex items-center gap-2 px-3 py-2.5 rounded-md border transition-colors ${
                selectedId === agent.id
                  ? 'bg-stone-800/60 border-stone-600/50'
                  : 'bg-stone-900/30 border-stone-800/30 hover:bg-stone-800/30'
              }`}
            >
              <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse shrink-0" />
              <span className="text-xs text-stone-300 truncate flex-1">{agent.name || agent.persona}</span>
              {agent.cost && <span className="text-[10px] text-amber-400 shrink-0">${agent.cost.totalUsd.toFixed(2)}</span>}
              {agent.startedAt && <span className="text-[10px] text-stone-600 shrink-0">{formatElapsed(Date.now() - agent.startedAt)}</span>}
            </button>
          ))}

          {/* Completed items */}
          {currentEntries.map(entry => {
            const type = entry.activityType || 'pipeline';
            const isSuccess = entry.activityStatus === 'success' || (!entry.activityStatus && Object.values(entry.stagesSummary).every(s => s === 'done' || s === 'skipped'));
            const isError = entry.activityStatus === 'error' || (!entry.activityStatus && Object.values(entry.stagesSummary).some(s => s === 'error'));
            const label = entry.summary || entry.featureRequest || `${type} run`;
            const badge = TYPE_BADGE[type] || TYPE_BADGE.pipeline;

            return (
              <button
                key={entry.runId}
                onClick={() => setSelectedId(entry.runId === selectedId ? null : entry.runId)}
                className={`w-full text-left flex items-center gap-2 px-3 py-2 rounded-md border transition-colors ${
                  selectedId === entry.runId
                    ? 'bg-stone-800/60 border-stone-600/50'
                    : 'bg-stone-900/30 border-stone-800/30 hover:bg-stone-800/30'
                }`}
              >
                {isSuccess ? (
                  <CheckCircle size={13} className="text-green-400 shrink-0" />
                ) : isError ? (
                  <XCircle size={13} className="text-red-400 shrink-0" />
                ) : (
                  <Loader2 size={13} className="text-stone-500 shrink-0" />
                )}
                <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full shrink-0 ${badge.color}`}>{badge.label}</span>
                <span className="text-xs text-stone-400 truncate flex-1">{label}</span>
                <span className="text-[10px] text-amber-400 shrink-0">${entry.totalCost?.totalUsd?.toFixed(2) || '0.00'}</span>
                <span className="text-[10px] text-stone-600 shrink-0">{timeAgo(entry.timestamp)}</span>
              </button>
            );
          })}

          {currentEntries.length === 0 && runningForTab.length === 0 && (
            <p className="text-xs text-stone-600 px-3 py-4 text-center">
              No {tab} activity yet.
            </p>
          )}
        </div>

        {/* Detail panel (inline output) */}
        {selectedId && (
          <div className="rounded-lg border border-stone-800/50 bg-stone-900/20 overflow-hidden">
            <div className="flex items-center justify-between px-3 py-2 border-b border-stone-800/40">
              <span className="text-xs font-medium text-stone-300">
                {selectedAgent ? `${selectedAgent.name || selectedAgent.persona} (running)` : selectedEntry?.summary || selectedEntry?.featureRequest || 'Details'}
              </span>
              <button onClick={() => setSelectedId(null)} className="text-stone-600 hover:text-stone-400">
                <X size={14} />
              </button>
            </div>
            <div className="max-h-[420px] overflow-y-auto p-3">
              {selectedAgent ? (
                // Running agent: show live output
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                    <span className="text-xs text-stone-400">{selectedAgent.persona} · {selectedAgent.stack}</span>
                    {selectedAgent.cost && <span className="text-[10px] text-amber-400">${selectedAgent.cost.totalUsd.toFixed(2)}</span>}
                  </div>
                  <pre className="text-[11px] text-stone-400 font-mono bg-stone-950/50 rounded p-3 max-h-[350px] overflow-y-auto whitespace-pre-wrap">
                    {agentOutputs.get(selectedAgent.id)?.slice(-8000) || 'Waiting for output...'}
                  </pre>
                </div>
              ) : selectedEntry ? (
                // Completed entry: show summary + stage info
                <div className="space-y-3">
                  <div className="flex items-center gap-3 text-xs">
                    <span className={`font-medium px-1.5 py-0.5 rounded-full ${(TYPE_BADGE[selectedEntry.activityType || 'pipeline'] || TYPE_BADGE.pipeline).color}`}>
                      {(TYPE_BADGE[selectedEntry.activityType || 'pipeline'] || TYPE_BADGE.pipeline).label}
                    </span>
                    <span className="text-amber-400">${selectedEntry.totalCost?.totalUsd?.toFixed(2) || '0.00'}</span>
                    <span className="text-stone-500">{formatElapsed(selectedEntry.durationMs)}</span>
                    <span className="text-stone-600">{new Date(selectedEntry.timestamp).toLocaleString()}</span>
                  </div>

                  {/* Pipeline stages */}
                  {(selectedEntry.activityType === 'pipeline' || !selectedEntry.activityType) && (
                    <div className="flex items-center gap-2">
                      {(['analyze', 'architect', 'plan', 'build', 'test'] as const).map(stage => {
                        const status = selectedEntry.stagesSummary[stage] ?? 'pending';
                        return (
                          <div key={stage} className="flex items-center gap-1">
                            <div className={`w-2.5 h-2.5 rounded-full ${
                              status === 'done' ? 'bg-green-500' : status === 'error' ? 'bg-red-500' : status === 'skipped' ? 'bg-stone-600' : 'bg-stone-700'
                            }`} />
                            <span className={`text-[10px] ${status === 'done' ? 'text-green-400' : status === 'error' ? 'text-red-400' : 'text-stone-600'}`}>{stage}</span>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* Stage breakdowns (cost per stage) */}
                  {selectedEntry.stageBreakdowns && selectedEntry.stageBreakdowns.length > 0 && (
                    <div className="space-y-1">
                      <h4 className="text-[10px] font-medium text-stone-500 uppercase tracking-wider">Cost Breakdown</h4>
                      {selectedEntry.stageBreakdowns.filter(b => b.cost > 0).map(b => (
                        <div key={b.name} className="flex items-center justify-between text-[10px]">
                          <span className="text-stone-400">{b.name}</span>
                          <div className="flex items-center gap-3">
                            <span className="text-amber-400">${b.cost.toFixed(3)}</span>
                            <span className="text-stone-600">{formatElapsed(b.durationMs)}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Summary / feature request */}
                  {(selectedEntry.summary || selectedEntry.featureRequest) && (
                    <div>
                      <h4 className="text-[10px] font-medium text-stone-500 uppercase tracking-wider mb-1">Description</h4>
                      <p className="text-xs text-stone-400">{selectedEntry.summary || selectedEntry.featureRequest}</p>
                    </div>
                  )}

                  {/* Model + metadata */}
                  <div className="flex items-center gap-3 text-[10px] text-stone-600">
                    {selectedEntry.model && <span>Model: {selectedEntry.model}</span>}
                    {selectedEntry.fixIterations != null && selectedEntry.fixIterations > 0 && (
                      <span>Fix iterations: {selectedEntry.fixIterations}</span>
                    )}
                    <span>{selectedEntry.projectName}:{selectedEntry.stack}</span>
                  </div>
                </div>
              ) : (
                <p className="text-xs text-stone-600">Select an item to view details.</p>
              )}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
