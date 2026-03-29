import { Bot, Clock, DollarSign, Hash, Loader2, CheckCircle, XCircle, Skull, Shield } from 'lucide-react';
import type { Agent } from '../types';

const STATUS_STYLES: Record<string, { color: string; bg: string }> = {
  pending: { color: 'text-gray-400', bg: 'bg-gray-800' },
  running: { color: 'text-cyan-400', bg: 'bg-cyan-950/50' },
  done: { color: 'text-green-400', bg: 'bg-green-950/50' },
  error: { color: 'text-red-400', bg: 'bg-red-950/50' },
  killed: { color: 'text-yellow-400', bg: 'bg-yellow-950/50' },
};

const PERMISSION_LABELS: Record<string, string> = {
  default: 'ask',
  acceptEdits: 'edits',
  bypassPermissions: 'bypass',
  plan: 'plan',
  auto: 'auto',
};

const PERSONA_COLORS: Record<string, string> = {
  analyst: 'bg-purple-600',
  architect: 'bg-blue-600',
  lead: 'bg-amber-600',
  engineer: 'bg-green-600',
};

function StatusIcon({ status }: { status: string }) {
  switch (status) {
    case 'running': return <Loader2 size={14} className="animate-spin text-cyan-400" />;
    case 'done': return <CheckCircle size={14} className="text-green-400" />;
    case 'error': return <XCircle size={14} className="text-red-400" />;
    case 'killed': return <Skull size={14} className="text-yellow-400" />;
    default: return <Clock size={14} className="text-gray-500" />;
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
      className={`p-3 rounded-lg border cursor-pointer transition-colors ${style.bg} ${
        selected
          ? 'border-cyan-500 shadow-lg shadow-cyan-500/10'
          : 'border-gray-700 hover:border-gray-600'
      }`}
    >
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <Bot size={14} className={style.color} />
          <span className="font-medium text-sm">{agent.name}</span>
        </div>
        <div className="flex items-center gap-2">
          <StatusIcon status={agent.status} />
          {agent.status === 'running' && (
            <button
              onClick={(e) => { e.stopPropagation(); onKill(); }}
              className="text-xs text-red-400 hover:text-red-300 px-1.5 py-0.5 rounded bg-red-950/50 hover:bg-red-950"
            >
              Kill
            </button>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2 mb-2 flex-wrap">
        <span className={`text-xs px-1.5 py-0.5 rounded ${PERSONA_COLORS[agent.persona]} text-white`}>
          {agent.persona}
        </span>
        <span className="text-xs text-gray-500">{agent.stack}</span>
        <span className="text-xs text-gray-600">{agent.model}</span>
        <span className="flex items-center gap-0.5 text-xs text-gray-500" title={`Permission: ${agent.permissionMode}`}>
          <Shield size={9} />
          {PERMISSION_LABELS[agent.permissionMode] ?? agent.permissionMode}
        </span>
      </div>

      <div className="flex items-center gap-3 text-xs text-gray-400">
        <span className="flex items-center gap-1">
          <DollarSign size={10} />
          {agent.cost.totalUsd.toFixed(4)}
        </span>
        <span className="flex items-center gap-1">
          <Hash size={10} />
          {agent.cost.inputTokens.toLocaleString()}/{agent.cost.outputTokens.toLocaleString()}
        </span>
        {elapsed > 0 && (
          <span className="flex items-center gap-1">
            <Clock size={10} />
            {formatDuration(elapsed)}
          </span>
        )}
      </div>

      {agent.error && (
        <div className="mt-2 text-xs text-red-400 truncate">
          {agent.error}
        </div>
      )}
    </div>
  );
}
