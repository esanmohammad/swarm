import { Square, RotateCcw, Play, AlertTriangle } from 'lucide-react';
import { OutputPanel } from '../output/OutputPanel';
import type { Agent, AgentActivity, WsCommand } from '../../types';

interface WorkflowCanvasProps {
  agent: Agent;
  agentOutput: string;
  agentActivities: AgentActivity[];
  sendCommand: (cmd: WsCommand) => void;
}

function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${m}m ${rem}s`;
}

const STATUS_LABEL: Record<string, string> = {
  running: 'In progress',
  done: 'Completed',
  error: 'Failed',
  killed: 'Stopped',
  pending: 'Waiting',
};

export function WorkflowCanvas({ agent, agentOutput, agentActivities, sendCommand }: WorkflowCanvasProps) {
  const isRunning = agent.status === 'running';
  const isDone = agent.status === 'done';
  const isError = agent.status === 'error';
  const isKilled = agent.status === 'killed';
  const isStopped = isError || isKilled;
  const duration = agent.startedAt
    ? (agent.finishedAt ?? Date.now()) - agent.startedAt
    : 0;

  return (
    <div className="flex flex-col h-full">
      {/* Status header */}
      <div
        className="flex items-center justify-between px-4 py-2.5 shrink-0"
        style={{ backgroundColor: 'var(--bg-surface)', borderBottom: '1px solid var(--border-muted)' }}
      >
        <div className="flex items-center gap-3">
          {/* Status badge */}
          <span
            className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium"
            style={{
              backgroundColor: isRunning ? 'var(--status-running-bg)'
                : isError || isKilled ? 'var(--status-error-bg)'
                : 'var(--status-success-bg)',
              color: isRunning ? 'var(--status-running)'
                : isError || isKilled ? 'var(--status-error)'
                : 'var(--status-success)',
            }}
          >
            {isRunning && <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ backgroundColor: 'var(--status-running)' }} />}
            {STATUS_LABEL[agent.status] || agent.status}
          </span>
          <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
            {agent.name}
          </span>
          <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
            {agent.model}
          </span>
        </div>

        {/* Controls */}
        <div className="flex items-center gap-2">
          {agent.cost?.totalUsd > 0 && (
            <span className="text-xs font-code tabular-nums" style={{ color: 'var(--text-secondary)' }}>
              ${agent.cost.totalUsd.toFixed(2)}
            </span>
          )}
          {duration > 0 && (
            <span className="text-xs font-code tabular-nums" style={{ color: 'var(--text-tertiary)' }}>
              {formatDuration(duration)}
            </span>
          )}

          {/* Stop — visible when running */}
          {isRunning && (
            <button
              onClick={() => sendCommand({ action: 'kill', agentId: agent.id })}
              className="flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium transition-colors"
              style={{ backgroundColor: 'var(--status-error-bg)', color: 'var(--status-error)', border: '1px solid var(--border-muted)' }}
            >
              <Square size={10} />
              Stop
            </button>
          )}

          {/* Resume — visible when done (sends a follow-up message via send-input) */}
          {isDone && agent.sessionId && (
            <button
              onClick={() => {
                const text = prompt('Send a follow-up message to this agent:');
                if (text?.trim()) {
                  sendCommand({ action: 'send-input', agentId: agent.id, text: text.trim() });
                }
              }}
              className="flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium transition-colors"
              style={{ backgroundColor: 'var(--accent-muted)', color: 'var(--accent)', border: '1px solid var(--border-muted)' }}
            >
              <Play size={10} />
              Continue
            </button>
          )}

          {/* Retry — visible when errored or killed */}
          {isStopped && (
            <button
              onClick={() => {
                // Re-spawn with same config
                sendCommand({
                  action: 'spawn',
                  name: agent.name,
                  persona: agent.persona,
                  stack: agent.stack,
                  model: agent.model,
                  permissionMode: agent.permissionMode === 'default' ? 'auto' : agent.permissionMode,
                } as WsCommand);
              }}
              className="flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium transition-colors"
              style={{ backgroundColor: 'var(--status-warning-bg)', color: 'var(--status-warning)', border: '1px solid var(--border-muted)' }}
            >
              <RotateCcw size={10} />
              Retry
            </button>
          )}
        </div>
      </div>

      {/* Error banner */}
      {isError && agent.error && (
        <div
          className="flex items-center gap-2 px-4 py-2 text-xs"
          style={{ backgroundColor: 'var(--status-error-bg)', color: 'var(--status-error)', borderBottom: '1px solid var(--border-muted)' }}
        >
          <AlertTriangle size={11} className="shrink-0" />
          {agent.error}
        </div>
      )}

      {/* Output panel */}
      <div className="flex-1 min-h-0">
        <OutputPanel
          agent={agent}
          liveOutput={agentOutput}
          activities={agentActivities}
          onSendInput={(agentId, text) => {
            sendCommand({ action: 'send-input', agentId, text });
          }}
        />
      </div>
    </div>
  );
}
