import { useEffect, useRef, useState, useCallback } from 'react';
import {
  Terminal, Send, Search, Copy, Check,
  Filter, X,
} from 'lucide-react';
import type { Agent, AgentActivity } from '../../types';
import { ActivityLine } from './ActivityLine';
import { RawOutput } from './RawOutput';
import { MarkdownRenderer } from './MarkdownRenderer';
import { DiffViewer } from '../diff/DiffViewer';
import { usePersistedState } from '../../hooks/usePersistedState';

interface OutputPanelProps {
  agent: Agent | null;
  liveOutput: string;
  activities: AgentActivity[];
  onSendInput: (agentId: string, text: string) => void;
}

type ViewMode = 'activity' | 'raw' | 'changes';

export function OutputPanel({ agent, liveOutput, activities, onSendInput }: OutputPanelProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [input, setInput] = useState('');
  const [localMessages, setLocalMessages] = useState<string[]>([]);
  const [viewMode, setViewMode] = usePersistedState<ViewMode>('swarm_output_view', 'activity');
  const [autoScroll, setAutoScroll] = useState(true);
  const [copied, setCopied] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterTool, setFilterTool] = useState<string | null>(null);
  const [showSearch, setShowSearch] = useState(false);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const searchRef = useRef<HTMLInputElement>(null);
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

  // Save/restore scroll position per agent
  useEffect(() => {
    if (prevAgentId.current && scrollRef.current) {
      scrollPositions.current.set(prevAgentId.current, scrollRef.current.scrollTop);
    }
    if (agent?.id && scrollRef.current) {
      const saved = scrollPositions.current.get(agent.id);
      if (saved !== undefined) {
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
    setAutoScroll(scrollHeight - scrollTop - clientHeight < 40);
    if (agent?.id) scrollPositions.current.set(agent.id, scrollTop);
  };

  const getFullOutput = useCallback(() => agent?.output || liveOutput || '', [agent?.output, liveOutput]);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(getFullOutput());
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* silent */ }
  }, [getFullOutput]);

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
        <div className="text-center">
          <Terminal size={32} className="mx-auto mb-3 opacity-15" style={{ color: 'var(--text-tertiary)' }} />
          <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>Select an activity to view output</p>
        </div>
      </div>
    );
  }

  const baseOutput = agent.output || '';
  const isRunning = agent.status === 'running';
  const isDone = agent.status === 'done';
  const showInput = isRunning || isDone;

  const feedActivities = activities.filter((a) => {
    if (a.kind !== 'tool_use' && a.kind !== 'thinking' && a.kind !== 'text') return false;
    if (filterTool && a.kind === 'tool_use' && a.tool !== filterTool) return false;
    if (filterTool && a.kind !== 'tool_use') return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      if (!a.summary?.toLowerCase().includes(q) && !a.content?.toLowerCase().includes(q) && !a.tool?.toLowerCase().includes(q)) return false;
    }
    return true;
  });

  const toolCounts = activities.reduce<Record<string, number>>((acc, a) => {
    if (a.kind === 'tool_use' && a.tool) acc[a.tool] = (acc[a.tool] || 0) + 1;
    return acc;
  }, {});

  return (
    <div className="flex flex-col h-full font-code" role="log" aria-label={`Agent output: ${agent.name}`}>
      {/* Terminal header */}
      <div
        className="flex items-center justify-between px-3 py-1.5 shrink-0"
        style={{
          backgroundColor: 'var(--bg-surface)',
          borderBottom: '1px solid var(--border-muted)',
        }}
      >
        <div className="flex items-center gap-2 text-xs">
          <Terminal size={11} style={{ color: 'var(--text-tertiary)' }} />
          <span style={{ color: 'var(--text-primary)' }}>{agent.name}</span>
          <span style={{ color: 'var(--text-disabled)' }}>::</span>
          <span style={{ color: 'var(--text-tertiary)' }}>{agent.persona}</span>
          <span style={{ color: 'var(--text-disabled)' }}>/</span>
          <span style={{ color: 'var(--text-tertiary)' }}>{agent.stack}</span>
        </div>
        <div className="flex items-center gap-2">
          {/* View mode toggle */}
          <div className="flex text-[10px] font-medium font-ui">
            {(['activity', 'changes', 'raw'] as ViewMode[]).map((mode, i) => (
              <button
                key={mode}
                onClick={() => setViewMode(mode)}
                className="px-2 py-0.5 transition-colors"
                style={{
                  backgroundColor: viewMode === mode ? 'var(--bg-emphasis)' : 'transparent',
                  color: viewMode === mode ? 'var(--text-primary)' : 'var(--text-tertiary)',
                  border: '1px solid var(--border-muted)',
                  borderRadius: i === 0 ? '4px 0 0 4px' : i === 2 ? '0 4px 4px 0' : '0',
                  borderLeft: i > 0 ? 'none' : undefined,
                }}
              >
                {mode === 'activity' ? 'log' : mode}
              </button>
            ))}
          </div>
          <button onClick={handleCopy} className="p-1 rounded transition-colors" style={{ color: 'var(--text-tertiary)' }} title="Copy">
            {copied ? <Check size={12} style={{ color: 'var(--status-success)' }} /> : <Copy size={12} />}
          </button>
          <button
            onClick={() => { setShowSearch(!showSearch); if (!showSearch) setTimeout(() => searchRef.current?.focus(), 50); }}
            className="p-1 rounded transition-colors"
            style={{ color: showSearch ? 'var(--accent)' : 'var(--text-tertiary)' }}
            title="Search"
          >
            <Search size={12} />
          </button>
          {isRunning && (
            <span className="flex items-center gap-1 text-[10px] font-ui" style={{ color: 'var(--status-error)' }}>
              <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ backgroundColor: 'var(--status-error)' }} />
              live
            </span>
          )}
          <span className="text-[10px] tabular-nums" style={{ color: 'var(--text-tertiary)' }}>{agent.id.slice(0, 8)}</span>
        </div>
      </div>

      {/* Search and filter bar */}
      {showSearch && viewMode === 'activity' && (
        <div
          className="flex items-center gap-2 px-3 py-1.5"
          style={{
            backgroundColor: 'var(--bg-raised)',
            borderBottom: '1px solid var(--border-muted)',
          }}
        >
          <Search size={11} style={{ color: 'var(--text-disabled)' }} />
          <input
            ref={searchRef}
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search output..."
            className="flex-1 bg-transparent text-xs focus:outline-none"
            style={{ color: 'var(--text-primary)' }}
          />
          {searchQuery && (
            <button onClick={() => setSearchQuery('')} style={{ color: 'var(--text-tertiary)' }}>
              <X size={11} />
            </button>
          )}
          <div className="h-3 w-px" style={{ backgroundColor: 'var(--border-muted)' }} />
          <div className="flex items-center gap-1">
            <Filter size={10} style={{ color: 'var(--text-disabled)' }} />
            {Object.entries(toolCounts).slice(0, 6).map(([tool, count]) => (
              <button
                key={tool}
                onClick={() => setFilterTool(filterTool === tool ? null : tool)}
                className="flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-ui transition-colors"
                style={{
                  backgroundColor: filterTool === tool ? 'var(--bg-emphasis)' : 'transparent',
                  color: filterTool === tool ? 'var(--text-primary)' : 'var(--text-disabled)',
                }}
              >
                {tool}
                <span style={{ color: 'var(--text-disabled)' }}>{count}</span>
              </button>
            ))}
            {filterTool && (
              <button onClick={() => setFilterTool(null)} className="text-[10px] font-ui" style={{ color: 'var(--text-tertiary)' }}>
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
        className="flex-1 overflow-auto"
        style={{ backgroundColor: 'var(--bg-base)' }}
      >
        {viewMode === 'changes' ? (
          <DiffViewer activities={activities} />
        ) : viewMode === 'activity' ? (
          <div className="min-h-full py-1">
            {feedActivities.length > 0 ? (
              feedActivities.map((activity, i) => {
                // Find if this is the last text activity (agent's final answer)
                const isLastText = activity.kind === 'text' &&
                  !feedActivities.slice(i + 1).some((a) => a.kind === 'text');
                return (
                  <ActivityLine
                    key={activity.id}
                    activity={activity}
                    index={i}
                    isExpanded={expandedIds.has(activity.id)}
                    onToggleExpanded={toggleExpanded}
                    isLastText={isLastText}
                  />
                );
              })
            ) : isRunning ? (
              <div className="flex items-center gap-2 px-3 py-4">
                <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ backgroundColor: 'var(--status-running)' }} />
                <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>awaiting output...</span>
                <span className="terminal-cursor" style={{ color: 'var(--status-running)' }}>_</span>
              </div>
            ) : baseOutput ? (
              <div className="p-4">
                <MarkdownRenderer content={baseOutput} />
              </div>
            ) : (
              <div className="px-3 py-4 text-xs italic" style={{ color: 'var(--text-tertiary)' }}>no output</div>
            )}

            {/* User messages */}
            {localMessages.map((msg, i) => (
              <div key={`local-${i}`} className="px-3 py-1.5" style={{ backgroundColor: 'var(--bg-subtle)' }}>
                <div className="flex items-start gap-2">
                  <span className="font-bold text-xs shrink-0" style={{ color: 'var(--status-success)' }}>{'>'}</span>
                  <pre className="text-xs whitespace-pre-wrap break-words" style={{ color: 'var(--status-success)', opacity: 0.8 }}>{msg}</pre>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <RawOutput agent={agent} liveOutput={liveOutput} localMessages={localMessages} isRunning={isRunning} />
        )}
      </div>

      {/* Input bar */}
      {showInput && (
        <form
          onSubmit={handleSubmit}
          className="flex items-center gap-2 px-3 py-2 shrink-0"
          style={{
            backgroundColor: 'var(--bg-surface)',
            borderTop: '1px solid var(--border-muted)',
          }}
        >
          <span className="text-xs font-bold shrink-0" style={{ color: 'var(--status-success)' }}>{'>'}</span>
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={isRunning ? 'send input...' : 'resume session...'}
            className="flex-1 bg-transparent text-xs focus:outline-none"
            style={{ color: 'var(--text-primary)' }}
          />
          <button
            type="submit"
            disabled={!input.trim()}
            className="p-1 rounded transition-colors shrink-0 disabled:opacity-30"
            style={{ color: 'var(--text-tertiary)' }}
          >
            <Send size={12} />
          </button>
        </form>
      )}
    </div>
  );
}

