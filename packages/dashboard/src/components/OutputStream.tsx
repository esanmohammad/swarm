import { useEffect, useRef, useState, useCallback } from 'react';
import {
  Terminal, Send, ChevronDown, ChevronRight,
  FileText, Pencil, TerminalSquare, Search, Brain,
  FolderSearch, Globe, Zap, Copy, Check, Download,
  Filter, X,
} from 'lucide-react';
import type { Agent, AgentActivity } from '../types';
import { DiffViewer } from './DiffViewer';
import { usePersistedState } from '../hooks/usePersistedState';

interface OutputStreamProps {
  agent: Agent | null;
  liveOutput: string;
  activities: AgentActivity[];
  onSendInput: (agentId: string, text: string) => void;
}

/** Map tool names to prefix + colors */
function toolMeta(tool?: string) {
  switch (tool) {
    case 'Read': return { icon: FileText, color: 'text-blue-400', prefix: 'READ' };
    case 'Edit': return { icon: Pencil, color: 'text-amber-400', prefix: 'EDIT' };
    case 'Write': return { icon: Pencil, color: 'text-amber-400', prefix: 'WRITE' };
    case 'Bash': return { icon: TerminalSquare, color: 'text-green-400', prefix: 'BASH' };
    case 'Grep': return { icon: Search, color: 'text-purple-400', prefix: 'GREP' };
    case 'Glob': return { icon: FolderSearch, color: 'text-purple-400', prefix: 'GLOB' };
    case 'Agent': return { icon: Zap, color: 'text-red-400', prefix: 'AGENT' };
    case 'WebSearch': return { icon: Globe, color: 'text-cyan-400', prefix: 'SEARCH' };
    case 'WebFetch': return { icon: Globe, color: 'text-cyan-400', prefix: 'FETCH' };
    default: return { icon: Zap, color: 'text-stone-400', prefix: tool?.toUpperCase() ?? 'TOOL' };
  }
}

function ActivityItem({ activity, index, isExpanded, onToggleExpanded }: {
  activity: AgentActivity;
  index: number;
  isExpanded: boolean;
  onToggleExpanded: (id: string) => void;
}) {
  const expanded = isExpanded;

  const isToolUse = activity.kind === 'tool_use';
  const isText = activity.kind === 'text';
  const isResult = activity.kind === 'tool_result';

  if (isResult) return null;

  const hasExpandableContent = activity.content && activity.content.length > 200;
  const lineNum = String(index + 1).padStart(3, ' ');
  const time = new Date(activity.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

  if (isText) {
    return (
      <div className="group hover:bg-stone-800/20 transition-colors">
        <div className="flex items-start px-3 py-1">
          <span className="text-[10px] text-stone-400 w-7 shrink-0 text-right pr-2 pt-0.5 tabular-nums select-none font-code">{lineNum}</span>
          <span className="text-stone-500 w-1 shrink-0 mr-2 pt-0.5">|</span>
          <div className="flex-1 min-w-0">
            <pre className="text-xs text-stone-300 whitespace-pre-wrap break-words leading-relaxed">
              {activity.summary}
              {hasExpandableContent && !expanded && <span className="text-stone-400">...</span>}
            </pre>
            {expanded && activity.content && (
              <pre className="text-xs text-stone-400 whitespace-pre-wrap break-words mt-1 font-code">{activity.content}</pre>
            )}
          </div>
          {hasExpandableContent && (
            <button
              onClick={() => onToggleExpanded(activity.id)}
              className="shrink-0 p-0.5 text-stone-400 hover:text-stone-300 ml-1"
            >
              {expanded ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
            </button>
          )}
        </div>
      </div>
    );
  }

  const meta = isToolUse ? toolMeta(activity.tool) : { icon: Brain, color: 'text-violet-400', prefix: 'THINK' };
  const Icon = meta.icon;

  return (
    <div className="group hover:bg-stone-800/20 transition-colors">
      <button
        onClick={() => hasExpandableContent && onToggleExpanded(activity.id)}
        aria-expanded={hasExpandableContent ? expanded : undefined}
        className={`w-full flex items-start px-3 py-1 text-left ${
          hasExpandableContent ? 'cursor-pointer' : 'cursor-default'
        }`}
      >
        <span className="text-[10px] text-stone-400 w-7 shrink-0 text-right pr-2 pt-0.5 tabular-nums select-none font-code">{lineNum}</span>
        <span className="text-stone-500 w-1 shrink-0 mr-2 pt-0.5">|</span>
        <Icon size={11} className={`${meta.color} shrink-0 mt-0.5 mr-1.5`} />
        <span className={`text-xs font-semibold font-ui ${meta.color} shrink-0 mr-2 mt-px tracking-wider`}>
          {meta.prefix}
        </span>
        <span className="text-xs text-stone-300 truncate flex-1">{activity.summary}</span>
        <span className="text-[10px] text-stone-400 shrink-0 ml-2 tabular-nums font-code">{time}</span>
        {hasExpandableContent && (
          <span className="shrink-0 text-stone-400 ml-1">
            {expanded ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
          </span>
        )}
      </button>
      {expanded && activity.content && (
        <div className="pl-12 pr-3 pb-1.5">
          <pre className="text-[11px] font-code text-stone-400 whitespace-pre-wrap break-words max-h-48 overflow-auto bg-[#0a0908] rounded px-2 py-1.5 border border-stone-800/30 leading-relaxed">
            {activity.content}
          </pre>
        </div>
      )}
    </div>
  );
}

type ViewMode = 'activity' | 'raw' | 'diff';

export function OutputStream({ agent, liveOutput, activities, onSendInput }: OutputStreamProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [input, setInput] = useState('');
  const [localMessages, setLocalMessages] = useState<string[]>([]);
  const [viewMode, setViewMode] = usePersistedState<ViewMode>('swarm_output_view', 'activity');
  const [autoScroll, setAutoScroll] = useState(true);
  const [copied, setCopied] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterTool, setFilterTool] = useState<string | null>(null);
  const [showSearch, setShowSearch] = useState(false);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const exportRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  // Track scroll positions per agent so switching agents restores position
  const scrollPositions = useRef(new Map<string, number>());
  const prevAgentId = useRef<string | null>(null);

  const toggleExpanded = useCallback((id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // Save scroll position when switching agents, restore for new agent
  useEffect(() => {
    // Save previous agent's scroll position
    if (prevAgentId.current && scrollRef.current) {
      scrollPositions.current.set(prevAgentId.current, scrollRef.current.scrollTop);
    }
    // Restore new agent's scroll position
    if (agent?.id && scrollRef.current) {
      const saved = scrollPositions.current.get(agent.id);
      if (saved !== undefined) {
        // Defer to next frame so content is rendered
        requestAnimationFrame(() => {
          if (scrollRef.current) scrollRef.current.scrollTop = saved;
        });
      }
    }
    prevAgentId.current = agent?.id ?? null;
  }, [agent?.id]);

  useEffect(() => {
    setLocalMessages([]);
  }, [agent?.id]);

  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [liveOutput, agent?.output, localMessages, activities, autoScroll]);

  const handleScroll = () => {
    if (!scrollRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
    const isAtBottom = scrollHeight - scrollTop - clientHeight < 40;
    setAutoScroll(isAtBottom);
    // Persist scroll position for current agent
    if (agent?.id) {
      scrollPositions.current.set(agent.id, scrollTop);
    }
  };

  // Close export dropdown when clicking outside
  useEffect(() => {
    if (!exportOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (exportRef.current && !exportRef.current.contains(e.target as Node)) {
        setExportOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [exportOpen]);

  const getFullOutput = useCallback(() => {
    return agent?.output || liveOutput || '';
  }, [agent?.output, liveOutput]);

  const handleCopy = useCallback(async () => {
    const text = getFullOutput();
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // fallback: silent fail
    }
  }, [getFullOutput]);

  const handleExport = useCallback((format: 'txt' | 'json') => {
    if (!agent) return;
    const filename = `${agent.name}-${agent.id.slice(0, 8)}.${format}`;
    let content: string;

    if (format === 'txt') {
      content = getFullOutput();
    } else {
      content = JSON.stringify({
        agent: { id: agent.id, name: agent.name, persona: agent.persona, status: agent.status },
        output: getFullOutput(),
        activities,
      }, null, 2);
    }

    const blob = new Blob([content], { type: format === 'json' ? 'application/json' : 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
    setExportOpen(false);
  }, [agent, activities, getFullOutput]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!agent || !input.trim()) return;

    const text = input.trim();
    setLocalMessages((prev) => [...prev, text]);
    onSendInput(agent.id, text);
    setInput('');
    inputRef.current?.focus();
  };

  if (!agent) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center text-stone-400 font-mono">
          <Terminal size={32} className="mx-auto mb-3 opacity-15" />
          <p className="text-xs">select a process to view output</p>
        </div>
      </div>
    );
  }

  const baseOutput = agent.output || '';
  const streamedExtra = liveOutput && liveOutput !== baseOutput
    ? liveOutput.startsWith(baseOutput)
      ? liveOutput.slice(baseOutput.length)
      : liveOutput
    : '';

  const isRunning = agent.status === 'running';
  const isDone = agent.status === 'done';
  const showInput = isRunning || isDone;
  const feedActivities = activities.filter(a => {
    if (a.kind !== 'tool_use' && a.kind !== 'thinking' && a.kind !== 'text') return false;
    if (filterTool && a.kind === 'tool_use' && a.tool !== filterTool) return false;
    if (filterTool && a.kind !== 'tool_use') return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      const inSummary = a.summary?.toLowerCase().includes(q);
      const inContent = a.content?.toLowerCase().includes(q);
      const inTool = a.tool?.toLowerCase().includes(q);
      if (!inSummary && !inContent && !inTool) return false;
    }
    return true;
  });

  const toolCounts = activities.reduce<Record<string, number>>((acc, a) => {
    if (a.kind === 'tool_use' && a.tool) {
      acc[a.tool] = (acc[a.tool] || 0) + 1;
    }
    return acc;
  }, {});

  return (
    <div className="flex flex-col h-full font-mono" role="log" aria-label={`Agent output: ${agent.name}`} aria-live="polite">
      {/* Terminal header */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-stone-800/50 bg-[#0e0c0b]">
        <div className="flex items-center gap-2 text-xs">
          <Terminal size={11} className="text-stone-400" />
          <span className="text-stone-300">{agent.name}</span>
          <span className="text-stone-400">::</span>
          <span className="text-stone-400">{agent.persona}</span>
          <span className="text-stone-500">/</span>
          <span className="text-stone-400">{agent.stack}</span>
        </div>
        <div className="flex items-center gap-2">
          {/* View mode toggle */}
          <div className="flex text-[10px] font-medium font-ui">
            <button
              onClick={() => setViewMode('activity')}
              className={`px-2 py-0.5 rounded-l border transition-colors ${
                viewMode === 'activity'
                  ? 'bg-stone-800/50 text-stone-300 border-stone-700/50'
                  : 'text-stone-400 border-stone-700/40 hover:text-stone-300'
              }`}
            >
              log
            </button>
            <button
              onClick={() => setViewMode('diff')}
              className={`px-2 py-0.5 border-t border-r border-b transition-colors ${
                viewMode === 'diff'
                  ? 'bg-stone-800/50 text-stone-300 border-stone-700/50'
                  : 'text-stone-400 border-stone-700/40 hover:text-stone-300'
              }`}
            >
              changes
            </button>
            <button
              onClick={() => setViewMode('raw')}
              className={`px-2 py-0.5 rounded-r border-t border-r border-b transition-colors ${
                viewMode === 'raw'
                  ? 'bg-stone-800/50 text-stone-300 border-stone-700/50'
                  : 'text-stone-400 border-stone-700/40 hover:text-stone-300'
              }`}
            >
              raw
            </button>
          </div>
          {/* Copy button */}
          <button
            onClick={handleCopy}
            className="p-1 rounded text-stone-400 hover:text-stone-300 transition-colors"
            title="Copy output"
          >
            {copied ? <Check size={12} className="text-green-400" /> : <Copy size={12} />}
          </button>
          {/* Export dropdown */}
          <div ref={exportRef} className="relative">
            <button
              onClick={() => setExportOpen(!exportOpen)}
              className="p-1 rounded text-stone-400 hover:text-stone-300 transition-colors"
              title="Export log"
            >
              <Download size={12} />
            </button>
            {exportOpen && (
              <div className="absolute right-0 top-full mt-1 z-50 bg-stone-900 border border-stone-700 rounded shadow-lg py-1 min-w-[120px]">
                <button
                  onClick={() => handleExport('txt')}
                  className="w-full text-left px-3 py-1.5 text-xs font-ui text-stone-300 hover:bg-stone-800 transition-colors"
                >
                  Export .txt
                </button>
                <button
                  onClick={() => handleExport('json')}
                  className="w-full text-left px-3 py-1.5 text-xs font-ui text-stone-300 hover:bg-stone-800 transition-colors"
                >
                  Export .json
                </button>
              </div>
            )}
          </div>
          {/* Search toggle */}
          <button
            onClick={() => { setShowSearch(!showSearch); if (!showSearch) setTimeout(() => searchRef.current?.focus(), 50); }}
            className={`p-1 rounded transition-colors ${showSearch ? 'text-blue-400' : 'text-stone-400 hover:text-stone-300'}`}
            title="Search output (Ctrl+F)"
          >
            <Search size={12} />
          </button>
          {isRunning && (
            <span className="flex items-center gap-1 text-[10px] font-ui text-red-400">
              <span className="w-1.5 h-1.5 bg-red-500 rounded-full animate-pulse" />
              live
            </span>
          )}
          <span className="text-[10px] text-stone-400 tabular-nums font-code">{agent.id.slice(0, 8)}</span>
        </div>
      </div>

      {/* Search and filter bar */}
      {showSearch && viewMode === 'activity' && (
        <div className="flex items-center gap-2 px-3 py-1.5 border-b border-stone-800/50 bg-[#0d0b0a]">
          <Search size={11} className="text-stone-500 shrink-0" />
          <input
            ref={searchRef}
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search output..."
            className="flex-1 bg-transparent text-xs text-stone-300 placeholder-stone-500 focus:outline-none"
          />
          {searchQuery && (
            <button onClick={() => setSearchQuery('')} className="text-stone-400 hover:text-stone-300">
              <X size={11} />
            </button>
          )}
          <div className="h-3 w-px bg-stone-700/50" />
          <div className="flex items-center gap-1">
            <Filter size={10} className="text-stone-500" />
            {Object.entries(toolCounts).slice(0, 6).map(([tool, count]) => {
              const meta = toolMeta(tool);
              return (
                <button
                  key={tool}
                  onClick={() => setFilterTool(filterTool === tool ? null : tool)}
                  className={`flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-ui transition-colors ${
                    filterTool === tool
                      ? `${meta.color} bg-stone-800/60 border border-stone-600/40`
                      : 'text-stone-500 hover:text-stone-400'
                  }`}
                  title={`${tool} (${count})`}
                >
                  {meta.prefix}
                  <span className="text-stone-500">{count}</span>
                </button>
              );
            })}
            {filterTool && (
              <button onClick={() => setFilterTool(null)} className="text-[10px] font-ui text-stone-400 hover:text-stone-300 ml-1">
                clear
              </button>
            )}
          </div>
        </div>
      )}

      {/* Content area */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex-1 overflow-auto bg-[#0c0a09]"
      >
        {viewMode === 'diff' ? (
          <DiffViewer activities={activities} />
        ) : viewMode === 'activity' ? (
          <div className="min-h-full py-1">
            {feedActivities.length > 0 ? (
              feedActivities.map((activity, i) => (
                <ActivityItem key={activity.id} activity={activity} index={i} isExpanded={expandedIds.has(activity.id)} onToggleExpanded={toggleExpanded} />
              ))
            ) : isRunning ? (
              <div className="flex items-center gap-2 px-3 py-4 text-stone-400">
                <span className="w-1.5 h-1.5 bg-red-500 rounded-full animate-pulse" />
                <span className="text-xs">awaiting output...</span>
                <span className="terminal-cursor text-red-500">_</span>
              </div>
            ) : baseOutput ? (
              <div className="p-3 text-xs leading-relaxed">
                <pre className="whitespace-pre-wrap break-words text-stone-300">{baseOutput}</pre>
              </div>
            ) : (
              <div className="px-3 py-4 text-stone-400 text-xs italic">
                no output
              </div>
            )}

            {/* User messages */}
            {localMessages.map((msg, i) => (
              <div key={`local-${i}`} className="px-3 py-1.5 hover:bg-stone-800/20">
                <div className="flex items-start gap-2">
                  <span className="text-green-600 font-bold text-xs shrink-0">{'>'}</span>
                  <pre className="text-xs whitespace-pre-wrap break-words text-green-400/80">{msg}</pre>
                </div>
              </div>
            ))}
            {isRunning && localMessages.length > 0 && (
              <div className="px-3 py-1.5 text-stone-400 text-xs">
                <span className="terminal-cursor text-red-500">_</span>
              </div>
            )}
          </div>
        ) : (
          /* Raw output view */
          <div className="p-3 text-xs leading-relaxed">
            {baseOutput || streamedExtra || localMessages.length > 0 ? (
              <>
                {baseOutput && (
                  <pre className="whitespace-pre-wrap break-words text-stone-300">{baseOutput}</pre>
                )}
                {streamedExtra && (
                  <pre className="whitespace-pre-wrap break-words text-stone-300">{streamedExtra}</pre>
                )}
                {localMessages.map((msg, i) => (
                  <div key={i} className="my-1.5 flex items-start gap-2">
                    <span className="text-green-600 font-bold shrink-0">{'>'}</span>
                    <pre className="whitespace-pre-wrap break-words text-green-400/80">{msg}</pre>
                  </div>
                ))}
                {isRunning && localMessages.length > 0 && (
                  <span className="terminal-cursor text-red-500">_</span>
                )}
              </>
            ) : (
              <span className="text-stone-400 italic">
                {isRunning ? 'awaiting output...' : 'no output'}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Input bar — terminal prompt style */}
      {showInput && (
        <form
          onSubmit={handleSubmit}
          className="flex items-center gap-2 px-3 py-2 border-t border-stone-800/50 bg-[#0e0c0b]"
        >
          <span className="text-green-600 text-xs font-bold shrink-0">{'>'}</span>
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={isRunning ? 'send input...' : 'resume session...'}
            className="flex-1 bg-transparent text-xs text-stone-300 placeholder-stone-400 focus:outline-none"
          />
          <button
            type="submit"
            disabled={!input.trim()}
            className="p-1 rounded text-stone-400 hover:text-green-500 disabled:text-stone-600 transition-colors shrink-0"
            title="Send (Enter)"
          >
            <Send size={12} />
          </button>
        </form>
      )}
    </div>
  );
}
