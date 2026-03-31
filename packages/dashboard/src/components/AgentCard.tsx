import { Clock, DollarSign, GitBranch, Crown } from 'lucide-react';
import type { Agent } from '../types';

const STATUS_INDICATOR: Record<string, { char: string; color: string }> = {
  pending: { char: '-', color: 'text-stone-400' },
  running: { char: '*', color: 'text-red-400' },
  done: { char: '+', color: 'text-green-500' },
  error: { char: 'x', color: 'text-red-500' },
  killed: { char: '!', color: 'text-stone-400' },
};

const PERSONA_COLORS: Record<string, string> = {
  analyst: 'text-purple-400',
  architect: 'text-blue-400',
  lead: 'text-amber-400',
  engineer: 'text-red-400',
  tester: 'text-green-400',
};

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

interface AgentCardProps {
  agent: Agent;
  selected: boolean;
  onClick: () => void;
  onKill: () => void;
}

export function AgentCard({ agent, selected, onClick, onKill }: AgentCardProps) {
  const status = STATUS_INDICATOR[agent.status] ?? STATUS_INDICATOR.pending;
  const elapsed = agent.startedAt
    ? (agent.finishedAt ?? Date.now()) - agent.startedAt
    : 0;
  const isRunning = agent.status === 'running';

  return (
    <div
      onClick={onClick}
      className={`px-2.5 py-2 rounded cursor-pointer transition-all font-mono border ${
        selected
          ? 'bg-stone-900/60 border-red-900/50 glow-red'
          : isRunning
            ? 'bg-stone-900/30 border-stone-800/40 hover:border-stone-600/60'
            : 'bg-transparent border-transparent hover:bg-stone-800/20 hover:border-stone-700/30'
      }`}
    >
      {/* Line 1: status + name + kill */}
      <div className="flex items-center gap-1.5 mb-1">
        <span className={`text-xs font-bold ${status.color}`}>[{status.char}]</span>
        <span className={`text-xs font-medium truncate flex-1 ${
          isRunning ? 'text-stone-200' : agent.status === 'done' ? 'text-stone-400' : 'text-stone-300'
        }`}>
          {agent.name}
        </span>
        {isRunning && (
          <button
            onClick={(e) => { e.stopPropagation(); onKill(); }}
            className="text-[9px] text-red-600 hover:text-red-400 px-1 py-0.5 rounded bg-red-950/40 hover:bg-red-950/60 uppercase tracking-wider font-semibold transition-colors"
          >
            kill
          </button>
        )}
      </div>

      {/* Line 2: persona + badges */}
      <div className="flex items-center gap-1.5 mb-1 flex-wrap">
        <span className={`text-[10px] ${PERSONA_COLORS[agent.persona] ?? 'text-stone-500'}`}>
          {agent.persona}
        </span>
        <span className="text-stone-500">:</span>
        <span className="text-[10px] text-stone-400">{agent.stack}</span>
        {agent.childIds && agent.childIds.length > 0 && (
          <span className="flex items-center gap-0.5 text-[9px] text-amber-500">
            <Crown size={8} />
            orch({agent.childIds.length})
          </span>
        )}
        {agent.parentId && (
          <span className="flex items-center gap-0.5 text-[9px] text-stone-400">
            <GitBranch size={8} />
            sub
          </span>
        )}
      </div>

      {/* Line 3: cost + tokens + time */}
      <div className="flex items-center gap-2.5 text-[10px] text-stone-400">
        <span className="flex items-center gap-0.5 text-amber-500">
          <DollarSign size={8} />
          {agent.cost.totalUsd.toFixed(4)}
        </span>
        {(agent.cost.inputTokens > 0 || agent.cost.outputTokens > 0) && (
          <span className="text-stone-400">
            {Math.round(agent.cost.inputTokens / 1000)}k<span className="text-stone-500">/</span>{Math.round(agent.cost.outputTokens / 1000)}k
          </span>
        )}
        {elapsed > 0 && (
          <span className="flex items-center gap-0.5">
            <Clock size={8} />
            {formatDuration(elapsed)}
          </span>
        )}
      </div>

      {/* Error line */}
      {agent.error && (
        <div className="mt-1 text-[10px] text-red-500 truncate">
          err: {agent.error.slice(0, 80)}
        </div>
      )}
    </div>
  );
}
