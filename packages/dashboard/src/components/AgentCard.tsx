import { Bot, Clock, DollarSign, Hash, CheckCircle, XCircle, Skull, Shield, GitBranch, Crown } from 'lucide-react';
import type { Agent } from '../types';

const STATUS_STYLES: Record<string, { color: string; bg: string; border: string }> = {
  pending: { color: 'text-stone-400', bg: 'bg-stone-900/30', border: 'border-stone-800/30' },
  running: { color: 'text-red-400', bg: 'bg-red-950/20', border: 'border-red-900/30' },
  done: { color: 'text-emerald-600', bg: 'bg-stone-900/30', border: 'border-stone-800/30' },
  error: { color: 'text-red-600', bg: 'bg-red-950/20', border: 'border-red-900/30' },
  killed: { color: 'text-stone-500', bg: 'bg-stone-900/30', border: 'border-stone-800/30' },
};

const PERMISSION_LABELS: Record<string, string> = {
  default: 'ask',
  acceptEdits: 'edits',
  bypassPermissions: 'bypass',
  plan: 'plan',
  auto: 'auto',
};

const PERSONA_COLORS: Record<string, string> = {
  analyst: 'bg-purple-900/60 text-purple-400',
  architect: 'bg-blue-950/60 text-blue-400',
  lead: 'bg-amber-950/60 text-amber-500',
  engineer: 'bg-red-950/60 text-red-400',
};

function StatusIcon({ status }: { status: string }) {
  switch (status) {
    case 'running': return <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />;
    case 'done': return <CheckCircle size={13} className="text-emerald-600" />;
    case 'error': return <XCircle size={13} className="text-red-600" />;
    case 'killed': return <Skull size={13} className="text-stone-500" />;
    default: return <span className="w-2 h-2 bg-stone-700 rounded-full" />;
  }
}

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
  const style = STATUS_STYLES[agent.status] ?? STATUS_STYLES.pending;
  const elapsed = agent.startedAt
    ? (agent.finishedAt ?? Date.now()) - agent.startedAt
    : 0;

  return (
    <div
      onClick={onClick}
      className={`p-3 rounded-lg border cursor-pointer transition-all ${style.bg} ${
        selected
          ? 'border-red-800/50 gothic-glow'
          : `${style.border} hover:border-stone-700`
      }`}
    >
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <Bot size={13} className={style.color} />
          <span className="font-medium text-sm text-stone-300">{agent.name}</span>
        </div>
        <div className="flex items-center gap-2">
          <StatusIcon status={agent.status} />
          {agent.status === 'running' && (
            <button
              onClick={(e) => { e.stopPropagation(); onKill(); }}
              className="text-[10px] text-red-600 hover:text-red-400 px-1.5 py-0.5 rounded bg-red-950/30 hover:bg-red-950/50 uppercase tracking-wider font-semibold"
            >
              Kill
            </button>
          )}
        </div>
      </div>

      <div className="flex items-center gap-1.5 mb-2 flex-wrap">
        <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${PERSONA_COLORS[agent.persona]}`}>
          {agent.persona}
        </span>
        {agent.childIds && agent.childIds.length > 0 && (
          <span className="flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded bg-amber-950/40 text-amber-600 font-medium">
            <Crown size={8} />
            orchestrator ({agent.childIds.length})
          </span>
        )}
        {agent.parentId && (
          <span className="flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded bg-stone-800/50 text-stone-500">
            <GitBranch size={8} />
            sub-task
          </span>
        )}
        <span className="text-[10px] text-stone-400">{agent.stack}</span>
        <span className="text-[10px] text-stone-500">{agent.model}</span>
        <span className="flex items-center gap-0.5 text-[10px] text-stone-500" title={`Permission: ${agent.permissionMode}`}>
          <Shield size={8} />
          {PERMISSION_LABELS[agent.permissionMode] ?? agent.permissionMode}
        </span>
      </div>

      <div className="flex items-center gap-3 text-[10px] text-stone-400 font-mono">
        <span className="flex items-center gap-1">
          <DollarSign size={9} />
          {agent.cost.totalUsd.toFixed(4)}
        </span>
        <span className="flex items-center gap-1">
          <Hash size={9} />
          {agent.cost.inputTokens.toLocaleString()}/{agent.cost.outputTokens.toLocaleString()}
        </span>
        {elapsed > 0 && (
          <span className="flex items-center gap-1">
            <Clock size={9} />
            {formatDuration(elapsed)}
          </span>
        )}
      </div>

      {agent.error && (
        <div className="mt-2 text-[10px] text-red-600 truncate">
          {agent.error}
        </div>
      )}
    </div>
  );
}
