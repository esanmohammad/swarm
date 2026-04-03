import { useState, useEffect } from 'react';
import {
  Inbox, Play, Pause, Square, Plus, Filter, ArrowUp, ExternalLink,
  Clock, DollarSign, CheckCircle, XCircle, AlertCircle, ChevronDown, ChevronRight,
} from 'lucide-react';
import { FeatureGuide } from '../components/FeatureGuide';
import { StateView } from '../components/StateView';
import type { WsCommand } from '../types';

// ---------------------------------------------------------------------------
// Local type mirrors (matching CLI types)
// ---------------------------------------------------------------------------

interface WorkItem {
  id: string;
  source: 'github-issue' | 'github-pr' | 'ci-failure' | 'stale-pr' | 'slack' | 'scheduled' | 'manual';
  title: string;
  body: string;
  url?: string;
  labels: string[];
  author?: string;
  createdAt: string;
  priority: number;
  type: 'bug-fix' | 'feature' | 'maintenance' | 'incident' | 'review';
  status: 'queued' | 'triaging' | 'running' | 'done' | 'failed' | 'skipped' | 'needs-human';
  confidence: number;
  estimatedCost: number;
  estimatedMinutes: number;
  result?: { prUrl?: string; cost?: number; duration?: number; error?: string };
  startedAt?: number;
  completedAt?: number;
}

interface InboxState {
  running: boolean;
  paused: boolean;
  label: string;
  pollInterval: number;
  maxConcurrent: number;
  queue: WorkItem[];
  processed: WorkItem[];
  stats: {
    totalProcessed: number;
    successful: number;
    failed: number;
    skipped: number;
    totalCost: number;
    dailyBudget: number;
    dailySpent: number;
  };
  workHours?: { start: string; end: string; timezone: string };
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface InboxViewProps {
  sendCommand: (cmd: WsCommand) => void;
  inboxState: InboxState | null;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STATUS_STYLES: Record<string, { icon: typeof CheckCircle; color: string; bg: string }> = {
  queued: { icon: Clock, color: 'text-stone-400', bg: 'bg-stone-500/15 border-stone-500/30' },
  triaging: { icon: Clock, color: 'text-blue-400', bg: 'bg-blue-500/15 border-blue-500/30' },
  running: { icon: Clock, color: 'text-blue-400', bg: 'bg-blue-500/15 border-blue-500/30' },
  done: { icon: CheckCircle, color: 'text-green-400', bg: 'bg-green-500/15 border-green-500/30' },
  failed: { icon: XCircle, color: 'text-red-400', bg: 'bg-red-500/15 border-red-500/30' },
  skipped: { icon: XCircle, color: 'text-stone-500', bg: 'bg-stone-600/15 border-stone-600/30' },
  'needs-human': { icon: AlertCircle, color: 'text-yellow-400', bg: 'bg-yellow-500/15 border-yellow-500/30' },
};

const SOURCE_ICONS: Record<string, string> = {
  'github-issue': '\u{1F41B}',
  'github-pr': '\u{1F500}',
  'ci-failure': '\u{1F6A8}',
  'stale-pr': '\u{23F3}',
  'slack': '\u{1F4AC}',
  'scheduled': '\u{1F4C5}',
  'manual': '\u{270F}\u{FE0F}',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDuration(ms: number | undefined): string {
  if (!ms) return '-';
  const minutes = Math.floor(ms / 60000);
  if (minutes < 1) return '<1m';
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function InboxView({ sendCommand, inboxState }: InboxViewProps) {
  const [label, setLabel] = useState('swarm');
  const [interval, setIntervalVal] = useState('10');
  const [budget, setBudget] = useState('25');
  const [maxConcurrent, setMaxConcurrent] = useState('1');
  const [addTaskInput, setAddTaskInput] = useState('');
  const [expandedItem, setExpandedItem] = useState<string | null>(null);
  const [filterSource, setFilterSource] = useState<string>('all');
  const [filterType, setFilterType] = useState<string>('all');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [showFilters, setShowFilters] = useState(false);

  useEffect(() => {
    sendCommand({ action: 'inbox-status' } as WsCommand);
  }, []);

  useEffect(() => {
    if (inboxState) {
      setLabel(inboxState.label);
      setIntervalVal(String(inboxState.pollInterval));
      setBudget(String(inboxState.stats.dailyBudget));
      setMaxConcurrent(String(inboxState.maxConcurrent));
    }
  }, [inboxState]);

  const isRunning = inboxState?.running ?? false;
  const isPaused = inboxState?.paused ?? false;

  const handleStart = () => {
    sendCommand({
      action: 'inbox-start',
      label: label.trim() || 'swarm',
      interval: parseInt(interval) || 10,
      maxConcurrent: parseInt(maxConcurrent) || 1,
      budget: parseFloat(budget) || 25,
    } as WsCommand);
  };

  const handleStop = () => {
    sendCommand({ action: 'inbox-stop' } as WsCommand);
  };

  const handlePause = () => {
    sendCommand({ action: 'inbox-pause' } as WsCommand);
  };

  const handleAddTask = () => {
    if (!addTaskInput.trim()) return;
    sendCommand({ action: 'inbox-add', task: addTaskInput.trim() } as WsCommand);
    setAddTaskInput('');
  };

  const handlePrioritize = (id: string) => {
    sendCommand({ action: 'inbox-prioritize', itemId: id } as WsCommand);
  };

  const handleSkip = (id: string) => {
    sendCommand({ action: 'inbox-skip', itemId: id } as WsCommand);
  };

  const stats = inboxState?.stats ?? { totalProcessed: 0, successful: 0, failed: 0, skipped: 0, totalCost: 0, dailyBudget: 25, dailySpent: 0 };
  const successRate = stats.totalProcessed > 0 ? ((stats.successful / stats.totalProcessed) * 100).toFixed(0) : '-';
  const budgetPercent = stats.dailyBudget > 0 ? Math.min(100, (stats.dailySpent / stats.dailyBudget) * 100) : 0;

  const allItems: WorkItem[] = [
    ...(inboxState?.queue ?? []),
    ...(inboxState?.processed ?? []).slice().reverse(),
  ];

  const filteredItems = allItems.filter((item) => {
    if (filterSource !== 'all' && item.source !== filterSource) return false;
    if (filterType !== 'all' && item.type !== filterType) return false;
    if (filterStatus !== 'all' && item.status !== filterStatus) return false;
    return true;
  });

  return (
    <div className="flex-1 overflow-auto p-4 sm:p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Inbox size={20} className="text-amber-400" />
          <div>
            <h2 className="text-sm font-semibold text-stone-200">Inbox</h2>
            <p className="text-xs text-stone-500">Self-directed work queue — aggregates tasks from GitHub, CI, Slack, and manual input</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
            isRunning
              ? isPaused
                ? 'bg-yellow-500/15 text-yellow-400 border border-yellow-500/30'
                : 'bg-green-500/15 text-green-400 border border-green-500/30'
              : 'bg-stone-800 text-stone-500 border border-stone-700/50'
          }`}>
            {isRunning ? (isPaused ? 'Paused' : 'Running') : 'Stopped'}
          </span>
        </div>
      </div>

      <FeatureGuide
        featureId="inbox"
        title="Inbox"
        description="Self-directed work queue. Swarm identifies tasks from issues, TODOs, and failed tests, prioritizes them, and works through them."
        cliCommands={[
          { command: 'swarm inbox', description: 'View the current inbox queue' },
          { command: 'swarm inbox process', description: 'Start processing inbox items' },
        ]}
        hasData={(inboxState?.queue?.length ?? 0) + (inboxState?.processed?.length ?? 0) > 0}
      />

      {/* Config + Controls */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="p-4 rounded-lg bg-stone-900/50 border border-stone-800/50 space-y-3">
          <h3 className="text-xs font-semibold text-stone-400 uppercase tracking-wider">Configuration</h3>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[10px] text-stone-500 mb-1">GitHub Label</label>
              <input
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                className="w-full px-2.5 py-1.5 text-xs rounded-md bg-stone-800/80 border border-stone-700/50 text-stone-200 focus:outline-none focus:border-amber-500/50"
                placeholder="swarm"
                disabled={isRunning}
              />
            </div>
            <div>
              <label className="block text-[10px] text-stone-500 mb-1">Poll Interval (min)</label>
              <input
                value={interval}
                onChange={(e) => setIntervalVal(e.target.value)}
                type="number"
                min="1"
                className="w-full px-2.5 py-1.5 text-xs rounded-md bg-stone-800/80 border border-stone-700/50 text-stone-200 focus:outline-none focus:border-amber-500/50"
                disabled={isRunning}
              />
            </div>
            <div>
              <label className="block text-[10px] text-stone-500 mb-1">Daily Budget ($)</label>
              <input
                value={budget}
                onChange={(e) => setBudget(e.target.value)}
                type="number"
                min="1"
                className="w-full px-2.5 py-1.5 text-xs rounded-md bg-stone-800/80 border border-stone-700/50 text-stone-200 focus:outline-none focus:border-amber-500/50"
                disabled={isRunning}
              />
            </div>
            <div>
              <label className="block text-[10px] text-stone-500 mb-1">Max Concurrent</label>
              <input
                value={maxConcurrent}
                onChange={(e) => setMaxConcurrent(e.target.value)}
                type="number"
                min="1"
                max="5"
                className="w-full px-2.5 py-1.5 text-xs rounded-md bg-stone-800/80 border border-stone-700/50 text-stone-200 focus:outline-none focus:border-amber-500/50"
                disabled={isRunning}
              />
            </div>
          </div>
          <div className="flex items-center gap-2">
            {!isRunning ? (
              <button
                onClick={handleStart}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors bg-amber-500/15 text-amber-400 border border-amber-500/30 hover:bg-amber-500/25"
              >
                <Play size={12} /> Start Inbox
              </button>
            ) : (
              <>
                <button
                  onClick={handlePause}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                    isPaused
                      ? 'bg-green-500/15 text-green-400 border border-green-500/30 hover:bg-green-500/25'
                      : 'bg-yellow-500/15 text-yellow-400 border border-yellow-500/30 hover:bg-yellow-500/25'
                  }`}
                >
                  {isPaused ? <Play size={12} /> : <Pause size={12} />}
                  {isPaused ? 'Resume' : 'Pause'}
                </button>
                <button
                  onClick={handleStop}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors bg-red-500/15 text-red-400 border border-red-500/30 hover:bg-red-500/25"
                >
                  <Square size={12} /> Stop
                </button>
              </>
            )}
          </div>
        </div>

        {/* Stats */}
        <div className="p-4 rounded-lg bg-stone-900/50 border border-stone-800/50 space-y-3">
          <h3 className="text-xs font-semibold text-stone-400 uppercase tracking-wider">Stats</h3>
          <div className="grid grid-cols-2 gap-3">
            <div className="p-3 rounded-md bg-stone-800/40">
              <div className="text-lg font-semibold text-stone-200">{stats.totalProcessed}</div>
              <div className="text-[10px] text-stone-500">Total Processed</div>
            </div>
            <div className="p-3 rounded-md bg-stone-800/40">
              <div className="text-lg font-semibold text-green-400">{successRate}%</div>
              <div className="text-[10px] text-stone-500">Success Rate</div>
            </div>
            <div className="p-3 rounded-md bg-stone-800/40">
              <div className="text-lg font-semibold text-amber-400">${stats.totalCost.toFixed(2)}</div>
              <div className="text-[10px] text-stone-500">Total Cost</div>
            </div>
            <div className="p-3 rounded-md bg-stone-800/40">
              <div className="text-lg font-semibold text-stone-200">{(inboxState?.queue ?? []).length}</div>
              <div className="text-[10px] text-stone-500">In Queue</div>
            </div>
          </div>
          {/* Daily Budget Meter */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-[10px] text-stone-500 flex items-center gap-1"><DollarSign size={10} /> Daily Budget</span>
              <span className="text-[10px] text-stone-400">${stats.dailySpent.toFixed(2)} / ${stats.dailyBudget.toFixed(2)}</span>
            </div>
            <div className="h-2 rounded-full bg-stone-800/60 overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${budgetPercent > 90 ? 'bg-red-500' : budgetPercent > 70 ? 'bg-yellow-500' : 'bg-amber-500'}`}
                style={{ width: `${budgetPercent}%` }}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Add Task */}
      <div className="flex items-center gap-2">
        <input
          value={addTaskInput}
          onChange={(e) => setAddTaskInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleAddTask()}
          className="flex-1 px-3 py-2 text-xs rounded-md bg-stone-800/80 border border-stone-700/50 text-stone-200 focus:outline-none focus:border-amber-500/50"
          placeholder="Add a manual task..."
        />
        <button
          onClick={handleAddTask}
          className="flex items-center gap-1.5 px-3 py-2 rounded-md text-xs font-medium bg-amber-500/15 text-amber-400 border border-amber-500/30 hover:bg-amber-500/25 transition-colors"
        >
          <Plus size={12} /> Add
        </button>
      </div>

      {/* Filters */}
      <div>
        <button
          onClick={() => setShowFilters(!showFilters)}
          className="flex items-center gap-1.5 text-xs text-stone-500 hover:text-stone-300 transition-colors"
        >
          <Filter size={12} /> Filters
          {showFilters ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </button>
        {showFilters && (
          <div className="flex flex-wrap gap-3 mt-2">
            <div>
              <label className="block text-[10px] text-stone-500 mb-1">Source</label>
              <select
                value={filterSource}
                onChange={(e) => setFilterSource(e.target.value)}
                className="px-2 py-1 text-xs rounded-md bg-stone-800/80 border border-stone-700/50 text-stone-200 focus:outline-none"
              >
                <option value="all">All</option>
                <option value="github-issue">GitHub Issue</option>
                <option value="github-pr">GitHub PR</option>
                <option value="ci-failure">CI Failure</option>
                <option value="stale-pr">Stale PR</option>
                <option value="slack">Slack</option>
                <option value="scheduled">Scheduled</option>
                <option value="manual">Manual</option>
              </select>
            </div>
            <div>
              <label className="block text-[10px] text-stone-500 mb-1">Type</label>
              <select
                value={filterType}
                onChange={(e) => setFilterType(e.target.value)}
                className="px-2 py-1 text-xs rounded-md bg-stone-800/80 border border-stone-700/50 text-stone-200 focus:outline-none"
              >
                <option value="all">All</option>
                <option value="bug-fix">Bug Fix</option>
                <option value="feature">Feature</option>
                <option value="maintenance">Maintenance</option>
                <option value="incident">Incident</option>
                <option value="review">Review</option>
              </select>
            </div>
            <div>
              <label className="block text-[10px] text-stone-500 mb-1">Status</label>
              <select
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value)}
                className="px-2 py-1 text-xs rounded-md bg-stone-800/80 border border-stone-700/50 text-stone-200 focus:outline-none"
              >
                <option value="all">All</option>
                <option value="queued">Queued</option>
                <option value="running">Running</option>
                <option value="done">Done</option>
                <option value="failed">Failed</option>
                <option value="skipped">Skipped</option>
                <option value="needs-human">Needs Human</option>
              </select>
            </div>
          </div>
        )}
      </div>

      {/* Work Queue Table */}
      <div className="space-y-2">
        <h3 className="text-xs font-semibold text-stone-400 uppercase tracking-wider">
          Work Items ({filteredItems.length})
        </h3>
        {filteredItems.length === 0 ? (
          <StateView
            status="empty"
            title="Inbox is empty"
            message={`Swarm will populate it with tasks from issues, TODOs, and test failures. Label issues with "${label}" on GitHub or add tasks manually above.`}
          />
        ) : (
          <div className="space-y-1">
            {filteredItems.map((item) => (
              <WorkItemRow
                key={item.id}
                item={item}
                expanded={expandedItem === item.id}
                onToggle={() => setExpandedItem(expandedItem === item.id ? null : item.id)}
                onPrioritize={() => handlePrioritize(item.id)}
                onSkip={() => handleSkip(item.id)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Work Item Row
// ---------------------------------------------------------------------------

function WorkItemRow({ item, expanded, onToggle, onPrioritize, onSkip }: {
  item: WorkItem;
  expanded: boolean;
  onToggle: () => void;
  onPrioritize: () => void;
  onSkip: () => void;
}) {
  const style = STATUS_STYLES[item.status] || STATUS_STYLES.queued;
  const Icon = style.icon;
  const sourceIcon = SOURCE_ICONS[item.source] || '';
  const priorityWidth = Math.max(5, Math.min(100, item.priority));

  return (
    <div className="rounded-lg bg-stone-900/30 border border-stone-800/50 overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-stone-800/20 transition-colors"
      >
        <Icon size={14} className={`shrink-0 ${style.color} ${item.status === 'running' ? 'animate-spin' : ''}`} />
        <span className="text-xs shrink-0 w-5 text-center" title={item.source}>{sourceIcon}</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-stone-300 truncate">{item.title}</span>
            <span className={`text-[10px] px-1.5 py-0.5 rounded border ${style.bg}`}>{item.status}</span>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-stone-800/60 text-stone-400 border border-stone-700/30">{item.type}</span>
          </div>
          <div className="flex items-center gap-3 mt-1">
            {/* Priority bar */}
            <div className="flex items-center gap-1.5 min-w-[80px]">
              <div className="w-16 h-1.5 rounded-full bg-stone-800/60 overflow-hidden">
                <div
                  className={`h-full rounded-full ${item.priority >= 80 ? 'bg-red-500' : item.priority >= 50 ? 'bg-amber-500' : 'bg-stone-500'}`}
                  style={{ width: `${priorityWidth}%` }}
                />
              </div>
              <span className="text-[10px] text-stone-500">{item.priority}</span>
            </div>
            <span className="text-[10px] text-stone-500 flex items-center gap-0.5">
              <CheckCircle size={9} /> {item.confidence}%
            </span>
            <span className="text-[10px] text-stone-500 flex items-center gap-0.5">
              <DollarSign size={9} /> {item.estimatedCost.toFixed(2)}
            </span>
            <span className="text-[10px] text-stone-500 flex items-center gap-0.5">
              <Clock size={9} /> {item.estimatedMinutes}m
            </span>
            {item.author && (
              <span className="text-[10px] text-stone-500">@{item.author}</span>
            )}
          </div>
        </div>
        {item.result?.prUrl && (
          <a
            href={item.result.prUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="flex items-center gap-1 text-[10px] text-amber-400 hover:text-amber-300 shrink-0"
          >
            PR <ExternalLink size={9} />
          </a>
        )}
        {expanded ? <ChevronDown size={14} className="text-stone-500 shrink-0" /> : <ChevronRight size={14} className="text-stone-500 shrink-0" />}
      </button>
      {expanded && (
        <div className="px-3 pb-3 space-y-2 border-t border-stone-800/30">
          {item.body && (
            <div className="mt-2">
              <div className="text-[10px] text-stone-500 mb-1">Description</div>
              <pre className="text-[10px] text-stone-400 whitespace-pre-wrap font-mono bg-stone-800/30 p-2 rounded max-h-32 overflow-auto">
                {item.body.slice(0, 1000)}
              </pre>
            </div>
          )}
          {item.result?.error && (
            <div>
              <div className="text-[10px] text-red-500 mb-1">Error</div>
              <pre className="text-[10px] text-red-400 whitespace-pre-wrap font-mono bg-red-950/20 p-2 rounded">
                {item.result.error}
              </pre>
            </div>
          )}
          {item.result && (
            <div className="flex flex-wrap gap-3 text-[10px] text-stone-400">
              {item.result.cost != null && <span className="flex items-center gap-1"><DollarSign size={9} /> Cost: ${item.result.cost.toFixed(2)}</span>}
              {item.result.duration != null && <span className="flex items-center gap-1"><Clock size={9} /> Duration: {formatDuration(item.result.duration)}</span>}
              {item.result.prUrl && (
                <a href={item.result.prUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-amber-400 hover:text-amber-300">
                  <ExternalLink size={9} /> {item.result.prUrl}
                </a>
              )}
            </div>
          )}
          <div className="flex flex-wrap gap-1">
            {item.labels.map((l) => (
              <span key={l} className="text-[10px] px-1.5 py-0.5 rounded bg-stone-800/60 text-stone-400 border border-stone-700/30">{l}</span>
            ))}
          </div>
          {item.status === 'queued' && (
            <div className="flex items-center gap-2 pt-1">
              <button
                onClick={(e) => { e.stopPropagation(); onPrioritize(); }}
                className="flex items-center gap-1 px-2 py-1 text-[10px] rounded bg-amber-500/15 text-amber-400 border border-amber-500/30 hover:bg-amber-500/25 transition-colors"
              >
                <ArrowUp size={10} /> Prioritize
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); onSkip(); }}
                className="flex items-center gap-1 px-2 py-1 text-[10px] rounded bg-stone-700/30 text-stone-400 border border-stone-600/30 hover:bg-stone-700/50 transition-colors"
              >
                <XCircle size={10} /> Skip
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
