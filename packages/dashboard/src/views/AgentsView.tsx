import { useState } from 'react';
import { Users, UserPlus, Trash2, ChevronDown, ChevronUp, Clock } from 'lucide-react';
import type { WsCommand, Agent } from '../types';

interface AgentsViewProps {
  agents: Agent[];
  agentOutputs: Map<string, string>;
  sendCommand: (cmd: WsCommand) => void;
  onSpawnAgent: () => void;
}

function formatElapsed(ms: number): string {
  if (ms < 1000) return '<1s';
  if (ms < 60000) return `${Math.round(ms / 1000)}s`;
  return `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`;
}

const statusColor: Record<string, string> = {
  running: 'bg-green-500',
  done: 'bg-stone-600',
  error: 'bg-red-500',
  idle: 'bg-stone-700',
};

export function AgentsView({ agents, agentOutputs, sendCommand, onSpawnAgent }: AgentsViewProps) {
  const [expandedAgent, setExpandedAgent] = useState<string | null>(null);
  const agentList = agents;
  const running = agentList.filter(a => a.status === 'running');
  const finished = agentList.filter(a => a.status !== 'running');

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Users size={18} className="text-stone-400" />
            <h1 className="text-lg font-semibold text-stone-200">Agents</h1>
            <span className="text-xs text-stone-600">{running.length} running</span>
          </div>
          <button
            onClick={onSpawnAgent}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium text-stone-300 bg-stone-800 hover:bg-stone-700 transition-colors"
          >
            <UserPlus size={12} /> Spawn Agent
          </button>
        </div>

        {agentList.length === 0 ? (
          <div className="text-center py-12 text-stone-600">
            <Users size={32} className="mx-auto mb-3 opacity-30" />
            <p className="text-sm mb-2">No agents running</p>
            <p className="text-xs">Click "Spawn Agent" to create one, or launch a workflow from the homepage.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {/* Running agents first */}
            {running.length > 0 && (
              <>
                <h3 className="text-xs font-medium text-green-400 mb-1">Running</h3>
                {running.map(agent => {
                  const output = agentOutputs.get(agent.id) || '';
                  const isExpanded = expandedAgent === agent.id;
                  const preview = output.split('\n').slice(-3).join('\n');

                  return (
                    <div key={agent.id} className="rounded-lg border border-stone-800/50 bg-stone-900/30 overflow-hidden">
                      <div className="px-4 py-3">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <div className={`w-2 h-2 rounded-full ${statusColor[agent.status]} ${agent.status === 'running' ? 'animate-pulse' : ''}`} />
                            <span className="text-xs font-medium text-stone-300">{agent.persona}</span>
                            {agent.name && <span className="text-xs text-stone-500 truncate max-w-xs">— {agent.name}</span>}
                          </div>
                          <div className="flex items-center gap-2">
                            {agent.cost && <span className="text-[10px] text-amber-400">${agent.cost.totalUsd.toFixed(2)}</span>}
                            {agent.startedAt && (
                              <span className="text-[10px] text-stone-600 flex items-center gap-1">
                                <Clock size={10} /> {formatElapsed(Date.now() - agent.startedAt)}
                              </span>
                            )}
                            <button
                              onClick={() => sendCommand({ action: 'kill', agentId: agent.id } as WsCommand)}
                              className="text-stone-600 hover:text-red-400 transition-colors p-1"
                              title="Kill agent"
                            >
                              <Trash2 size={12} />
                            </button>
                          </div>
                        </div>

                        <pre className={`mt-2 text-[10px] text-stone-600 font-mono bg-stone-950/50 rounded p-2 overflow-x-auto ${isExpanded ? 'max-h-60' : 'max-h-12'} overflow-y-auto whitespace-pre-wrap`}>
                          {isExpanded ? output.slice(-5000) : preview}
                        </pre>

                        <button
                          onClick={() => setExpandedAgent(isExpanded ? null : agent.id)}
                          className="flex items-center gap-1 mt-1.5 text-[10px] text-stone-600 hover:text-stone-400"
                        >
                          {isExpanded ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
                          {isExpanded ? 'Collapse' : 'Expand'}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </>
            )}

            {/* Finished agents */}
            {finished.length > 0 && (
              <>
                <h3 className="text-xs font-medium text-stone-500 mt-4 mb-1">Finished ({finished.length})</h3>
                {finished.slice(0, 10).map(agent => (
                  <div key={agent.id} className="flex items-center gap-2 px-3 py-2 rounded-md bg-stone-900/20 border border-stone-800/30">
                    <div className={`w-2 h-2 rounded-full ${statusColor[agent.status]}`} />
                    <span className="text-xs text-stone-400">{agent.persona}</span>
                    {agent.name && <span className="text-xs text-stone-600 truncate flex-1">— {agent.name}</span>}
                    {agent.cost && <span className="text-[10px] text-amber-400">${agent.cost.totalUsd.toFixed(2)}</span>}
                    <span className={`text-[10px] ${agent.status === 'error' ? 'text-red-400' : 'text-green-400'}`}>{agent.status}</span>
                  </div>
                ))}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
