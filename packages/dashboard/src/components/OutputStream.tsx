import { useEffect, useRef, useState } from 'react';
import { Terminal, Send, CornerDownLeft } from 'lucide-react';
import type { Agent } from '../types';

interface OutputStreamProps {
  agent: Agent | null;
  liveOutput: string;
  onSendInput: (agentId: string, text: string) => void;
}

export function OutputStream({ agent, liveOutput, onSendInput }: OutputStreamProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [input, setInput] = useState('');
  const [localMessages, setLocalMessages] = useState<string[]>([]);

  useEffect(() => {
    setLocalMessages([]);
  }, [agent?.id]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [liveOutput, agent?.output, localMessages]);

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
      <div className="flex items-center justify-center h-full text-stone-500">
        <div className="text-center">
          <Terminal size={36} className="mx-auto mb-3 opacity-20" />
          <p className="text-sm">Select an agent to view output</p>
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

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-stone-800/40 bg-[#0a0a0a]">
        <div className="flex items-center gap-2">
          <Terminal size={13} className="text-stone-400" />
          <span className="text-sm font-medium text-stone-300">{agent.name}</span>
          <span className="text-[10px] text-stone-500">{agent.persona}/{agent.stack}</span>
        </div>
        <div className="flex items-center gap-2">
          {isRunning && (
            <span className="flex items-center gap-1.5 text-[10px] text-red-500">
              <span className="w-1.5 h-1.5 bg-red-500 rounded-full animate-pulse" />
              active
            </span>
          )}
          <span className="text-[10px] text-stone-500 font-mono">{agent.id.slice(0, 8)}</span>
        </div>
      </div>

      {/* Output content */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-auto p-4 font-[JetBrains_Mono,monospace] text-xs leading-relaxed bg-[#060606]"
      >
        {baseOutput || streamedExtra || localMessages.length > 0 ? (
          <>
            {baseOutput && (
              <pre className="whitespace-pre-wrap break-words text-stone-200">{baseOutput}</pre>
            )}
            {streamedExtra && (
              <pre className="whitespace-pre-wrap break-words text-stone-200">{streamedExtra}</pre>
            )}
            {localMessages.map((msg, i) => (
              <div key={i} className="my-2 flex items-start gap-2">
                <span className="text-red-600 font-bold shrink-0">&gt;</span>
                <pre className="whitespace-pre-wrap break-words text-red-400">{msg}</pre>
              </div>
            ))}
            {isRunning && localMessages.length > 0 && (
              <span className="text-stone-500 animate-pulse">responding...</span>
            )}
          </>
        ) : (
          <span className="text-stone-500 italic">
            {isRunning ? 'Awaiting output...' : 'No output.'}
          </span>
        )}
      </div>

      {/* Input bar */}
      {showInput && (
        <form
          onSubmit={handleSubmit}
          className="flex items-center gap-2 px-3 py-2.5 border-t border-stone-800/40 bg-[#0a0a0a]"
        >
          <CornerDownLeft size={13} className="text-stone-500 shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={isRunning ? 'Send input...' : 'Resume session...'}
            className="flex-1 px-3 py-1.5 bg-[#111] border border-stone-800/40 rounded text-sm text-stone-300 placeholder-stone-500 focus:border-red-800/50 focus:outline-none font-[JetBrains_Mono,monospace]"
          />
          <button
            type="submit"
            disabled={!input.trim()}
            className="p-1.5 rounded bg-red-900/50 hover:bg-red-800/50 disabled:bg-stone-900 disabled:text-stone-500 text-red-300 transition-colors shrink-0"
            title="Send (Enter)"
          >
            <Send size={13} />
          </button>
        </form>
      )}
    </div>
  );
}
