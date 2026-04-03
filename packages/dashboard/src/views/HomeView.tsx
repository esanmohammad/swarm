import { useState, useCallback, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Rocket, Wrench, GitPullRequest, Search, RefreshCw, Sparkles,
  Play, ChevronDown, ChevronUp, Clock,
  CheckCircle, XCircle, Loader2, ArrowRight,
  Activity
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

  // Recent completed from history
  const recentCompleted = historyEntries.slice(0, 5);

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

        {/* Recently Completed */}
        <section>
          <h2 className="text-xs font-semibold text-stone-500 uppercase tracking-wider mb-3">Recently Completed</h2>
          {recentCompleted.length > 0 ? (
            <div className="space-y-1.5">
              {recentCompleted.map((entry) => {
                const hasError = Object.values(entry.stagesSummary).some(s => s === 'error');
                const allDone = Object.values(entry.stagesSummary).every(s => s === 'done' || s === 'skipped');
                return (
                  <div key={entry.runId} className="flex items-center gap-2 px-3 py-2 rounded-md bg-stone-900/30 border border-stone-800/30">
                    {allDone ? (
                      <CheckCircle size={14} className="text-green-400 shrink-0" />
                    ) : hasError ? (
                      <XCircle size={14} className="text-red-400 shrink-0" />
                    ) : (
                      <Loader2 size={14} className="text-stone-500 shrink-0" />
                    )}
                    <span className="text-xs text-stone-400 truncate flex-1">{entry.featureRequest || 'Pipeline run'}</span>
                    <span className="text-[10px] text-amber-400 shrink-0">${entry.totalCost?.totalUsd?.toFixed(2) || '0.00'}</span>
                    <span className="text-[10px] text-stone-600 shrink-0">{timeAgo(entry.timestamp)}</span>
                  </div>
                );
              })}
              <button onClick={() => navigate('/history')} className="text-xs text-stone-600 hover:text-stone-400 px-3 py-1">
                View all history &rarr;
              </button>
            </div>
          ) : (
            <p className="text-xs text-stone-600 px-3 py-2">No completed runs yet. Launch your first pipeline above!</p>
          )}
        </section>

        {/* Daily summary */}
        {historyEntries.length > 0 && (
          <div className="text-[10px] text-stone-600 px-1 pb-4">
            {historyEntries.length} total runs | ${historyEntries.reduce((s, e) => s + (e.totalCost?.totalUsd || 0), 0).toFixed(2)} spent
          </div>
        )}
      </div>
    </div>
  );
}
