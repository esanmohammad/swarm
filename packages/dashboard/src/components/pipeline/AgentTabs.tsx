import type { Agent } from '../../types';

interface AgentTabsProps {
  agents: Agent[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

export function AgentTabs({ agents, selectedId, onSelect }: AgentTabsProps) {
  if (agents.length <= 1) return null;

  return (
    <div
      className="flex items-center gap-1 px-4 py-1.5 overflow-x-auto shrink-0"
      style={{
        backgroundColor: 'var(--bg-surface)',
        borderBottom: '1px solid var(--border-muted)',
      }}
    >
      {agents.map((agent) => {
        const isSelected = agent.id === selectedId;
        const isRunning = agent.status === 'running';
        const isError = agent.status === 'error';

        return (
          <button
            key={agent.id}
            onClick={() => onSelect(agent.id)}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded text-xs transition-colors whitespace-nowrap"
            style={{
              backgroundColor: isSelected ? 'var(--bg-emphasis)' : 'transparent',
              color: isSelected ? 'var(--text-primary)' : 'var(--text-secondary)',
              border: isSelected ? '1px solid var(--border-default)' : '1px solid transparent',
            }}
          >
            {isRunning && (
              <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ backgroundColor: 'var(--status-running)' }} />
            )}
            {isError && (
              <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: 'var(--status-error)' }} />
            )}
            <span>{agent.name}</span>
            {agent.cost?.totalUsd > 0 && (
              <span className="text-[10px] font-code tabular-nums" style={{ color: 'var(--text-tertiary)' }}>
                ${agent.cost.totalUsd.toFixed(2)}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
