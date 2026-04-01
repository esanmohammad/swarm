import { useEffect, useRef, useState, useCallback } from 'react';
import {
  Terminal, Send, ChevronDown, ChevronRight,
  FileText, Pencil, TerminalSquare, Search, Brain,
  FolderSearch, Globe, Zap, Copy, Check, Download,
} from 'lucide-react';
import type { Agent, AgentActivity } from '../types';
import { DiffViewer } from './DiffViewer';

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

function ActivityItem({ activity, index }: { activity: AgentActivity; index: number }) {
  const [expanded, setExpanded] = useState(false);

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
          <span className="text-[9px] text-stone-500 w-7 shrink-0 text-right pr-2 pt-0.5 tabular-nums select-none">{lineNum}</span>
          <span className="text-stone-500 w-1 shrink-0 mr-2 pt-0.5">|</span>
          <div className="flex-1 min-w-0">
            <pre className="text-xs text-stone-300 whitespace-pre-wrap break-words leading-relaxed">
              {activity.summary}
              {hasExpandableContent && !expanded && <span className="text-stone-400">...</span>}
            </pre>
            {expanded && activity.content && (
              <pre className="text-xs text-stone-400 whitespace-pre-wrap break-words mt-1">{activity.content}</pre>
            )}
          </div>
          {hasExpandableContent && (
            <button
              onClick={() => setExpanded(!expanded)}
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
        onClick={() => hasExpandableContent && setExpanded(!expanded)}
        className={`w-full flex items-start px-3 py-1 text-left ${
          hasExpandableContent ? 'cursor-pointer' : 'cursor-default'
        }`}
      >
        <span className="text-[9px] text-stone-500 w-7 shrink-0 text-right pr-2 pt-0.5 tabular-nums select-none">{lineNum}</span>
        <span className="text-stone-500 w-1 shrink-0 mr-2 pt-0.5">|</span>
        <Icon size={11} className={`${meta.color} shrink-0 mt-0.5 mr-1.5`} />
        <span className={`text-[10px] font-semibold ${meta.color} shrink-0 mr-2 mt-px tracking-wider`}>
          {meta.prefix}
        </span>
        <span className="text-xs text-stone-400 truncate flex-1">{activity.summary}</span>
        <span className="text-[9px] text-stone-500 shrink-0 ml-2 tabular-nums">{time}</span>
        {hasExpandableContent && (
          <span className="shrink-0 text-stone-400 ml-1">
            {expanded ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
          </span>
        )}
      </button>
      {expanded && activity.content && (
        <div className="pl-12 pr-3 pb-1.5">
          <pre className="text-[10px] text-stone-400 whitespace-pre-wrap break-words max-h-48 overflow-auto bg-[#0a0908] rounded px-2 py-1.5 border border-stone-800/30 leading-relaxed">
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
  const [viewMode, setViewMode] = useState<ViewMode>('activity');
  const [autoScroll, setAutoScroll] = useState(true);
  const [copied, setCopied] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const exportRef = useRef<HTMLDivElement>(null);

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
  const feedActivities = activities.filter(a => a.kind === 'tool_use' || a.kind === 'thinking' || a.kind === 'text');

  return (
    <div className="flex flex-col h-full font-mono">
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
          <div className="flex text-[9px] font-medium">
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
                  className="w-full text-left px-3 py-1 text-[10px] text-stone-300 hover:bg-stone-800 transition-colors"
                >
                  Export .txt
                </button>
                <button
                  onClick={() => handleExport('json')}
                  className="w-full text-left px-3 py-1 text-[10px] text-stone-300 hover:bg-stone-800 transition-colors"
                >
                  Export .json
                </button>
              </div>
            )}
          </div>
          {isRunning && (
            <span className="flex items-center gap-1 text-[9px] text-red-400">
              <span className="w-1.5 h-1.5 bg-red-500 rounded-full animate-pulse" />
              live
            </span>
          )}
          <span className="text-[9px] text-stone-500 tabular-nums">{agent.id.slice(0, 8)}</span>
        </div>
      </div>

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
                <ActivityItem key={activity.id} activity={activity} index={i} />
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
