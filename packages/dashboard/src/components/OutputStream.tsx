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
  // Local message log for user inputs that haven't round-tripped yet
  const [localMessages, setLocalMessages] = useState<string[]>([]);

  // Reset local messages when agent changes
  useEffect(() => {
    setLocalMessages([]);
  }, [agent?.id]);

  // Auto-scroll on new content
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [liveOutput, agent?.output, localMessages]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!agent || !input.trim()) return;

    const text = input.trim();
    // Show the message locally immediately
    setLocalMessages((prev) => [...prev, text]);
    // Send to server
    onSendInput(agent.id, text);
    setInput('');
    inputRef.current?.focus();
  };

  if (!agent) {
    return (
      <div className="flex items-center justify-center h-full text-gray-600">
        <div className="text-center">
          <Terminal size={32} className="mx-auto mb-2" />
          <p className="text-sm">Select an agent to view output</p>
        </div>
      </div>
    );
  }

  // Combine all output sources:
  // 1. agent.output — persisted output from state (previous turns)
  // 2. liveOutput — streaming content from WebSocket (current turn)
  // 3. localMessages — user inputs shown immediately before server echo
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
      <div className="flex items-center justify-between px-4 py-2 border-b border-gray-800 bg-gray-900">
        <div className="flex items-center gap-2">
          <Terminal size={14} className="text-gray-500" />
          <span className="text-sm font-medium">{agent.name}</span>
          <span className="text-xs text-gray-600">({agent.persona}/{agent.stack})</span>
        </div>
        <div className="flex items-center gap-2">
          {isRunning && (
            <span className="flex items-center gap-1.5 text-xs text-cyan-400">
              <span className="w-1.5 h-1.5 bg-cyan-400 rounded-full animate-pulse" />
              streaming
            </span>
          )}
          <span className="text-xs text-gray-600">{agent.id.slice(0, 8)}</span>
        </div>
      </div>

      {/* Output content */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-auto p-4 font-mono text-xs leading-relaxed bg-gray-950"
      >
        {baseOutput || streamedExtra || localMessages.length > 0 ? (
          <>
            {/* Base output (persisted) */}
            {baseOutput && (
              <pre className="whitespace-pre-wrap break-words text-gray-300">{baseOutput}</pre>
            )}
            {/* Streamed content from current turn */}
            {streamedExtra && (
              <pre className="whitespace-pre-wrap break-words text-gray-300">{streamedExtra}</pre>
            )}
            {/* Local user messages (shown immediately) */}
            {localMessages.map((msg, i) => (
              <div key={i} className="my-2 flex items-start gap-2">
                <span className="text-cyan-500 font-bold shrink-0">&gt;</span>
                <pre className="whitespace-pre-wrap break-words text-cyan-400">{msg}</pre>
              </div>
            ))}
            {/* Waiting indicator after user input */}
            {isRunning && localMessages.length > 0 && (
              <span className="text-gray-600 animate-pulse">Agent is responding...</span>
            )}
          </>
        ) : (
          <span className="text-gray-600 italic">
            {isRunning ? 'Waiting for output...' : 'No output yet.'}
          </span>
        )}
      </div>

      {/* Input bar */}
      {showInput && (
        <form
          onSubmit={handleSubmit}
          className="flex items-center gap-2 px-3 py-2 border-t border-gray-800 bg-gray-900"
        >
          <CornerDownLeft size={14} className="text-gray-600 shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={
              isRunning
                ? 'Send input to running agent...'
                : 'Send follow-up message (resumes session)...'
            }
            className="flex-1 px-3 py-1.5 bg-gray-800 border border-gray-700 rounded text-sm text-gray-200 placeholder-gray-600 focus:border-cyan-500 focus:outline-none font-mono"
          />
          <button
            type="submit"
            disabled={!input.trim()}
            className="p-1.5 rounded bg-cyan-600 hover:bg-cyan-500 disabled:bg-gray-700 disabled:text-gray-500 text-white transition-colors shrink-0"
            title="Send (Enter)"
          >
            <Send size={14} />
          </button>
        </form>
      )}
    </div>
  );
}
