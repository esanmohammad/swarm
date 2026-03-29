import { useState } from 'react';
import { Wifi, WifiOff, Plus, Zap } from 'lucide-react';
import { useWebSocket } from './hooks/useWebSocket';
import { TopBar } from './components/TopBar';
import { AgentCard } from './components/AgentCard';
import { CostPanel } from './components/CostPanel';
import { OutputStream } from './components/OutputStream';
import { GuardrailAlerts } from './components/GuardrailAlerts';
import { SpawnDialog } from './components/SpawnDialog';
import { KillConfirmDialog } from './components/KillConfirmDialog';
import type { Agent } from './types';

export default function App() {
  const { state, connected, agentOutputs, violations, sendCommand } = useWebSocket();
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [showSpawn, setShowSpawn] = useState(false);
  const [killTarget, setKillTarget] = useState<Agent | null>(null);

  const selectedAgent = state?.agents.find((a) => a.id === selectedAgentId) ?? null;

  return (
    <div className="h-screen flex flex-col">
      {/* Header */}
      <header className="flex items-center justify-between px-4 py-3 border-b border-gray-800 bg-gray-900">
        <div className="flex items-center gap-3">
          <Zap size={20} className="text-cyan-400" />
          <h1 className="text-lg font-bold">Swarm</h1>
          {state && (
            <span className="text-sm text-gray-500">
              {state.projectName} ({state.stack})
            </span>
          )}
        </div>

        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1.5">
            {connected ? (
              <Wifi size={14} className="text-green-400" />
            ) : (
              <WifiOff size={14} className="text-red-400" />
            )}
            <span className={`text-xs ${connected ? 'text-green-400' : 'text-red-400'}`}>
              {connected ? 'Connected' : 'Disconnected'}
            </span>
          </div>
        </div>
      </header>

      {!state ? (
        <div className="flex-1 flex items-center justify-center text-gray-600">
          <div className="text-center">
            <Zap size={48} className="mx-auto mb-4 opacity-20" />
            <p>Waiting for connection...</p>
            <p className="text-sm mt-1">Start the dashboard server with: swarm dashboard</p>
          </div>
        </div>
      ) : (
        <div className="flex-1 flex overflow-hidden">
          {/* Left sidebar: cost + agents */}
          <aside className="w-72 border-r border-gray-800 flex flex-col overflow-hidden">
            <CostPanel pipeline={state} />

            <div className="border-t border-gray-800 flex-1 overflow-y-auto">
              <div className="flex items-center justify-between px-4 py-2">
                <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                  Agents ({state.agents.length})
                </h3>
                <button
                  onClick={() => setShowSpawn(true)}
                  className="p-1 rounded hover:bg-gray-800 text-gray-500 hover:text-cyan-400 transition-colors"
                  title="Spawn agent"
                >
                  <Plus size={14} />
                </button>
              </div>

              <div className="px-3 pb-3 space-y-2">
                {state.agents.map((agent) => (
                  <AgentCard
                    key={agent.id}
                    agent={agent}
                    selected={agent.id === selectedAgentId}
                    onClick={() => setSelectedAgentId(agent.id)}
                    onKill={() => setKillTarget(agent)}
                  />
                ))}
                {state.agents.length === 0 && (
                  <p className="text-xs text-gray-600 text-center py-4">
                    No agents running
                  </p>
                )}
              </div>
            </div>
          </aside>

          {/* Main content */}
          <main className="flex-1 flex flex-col overflow-hidden">
            {/* Top metrics bar */}
            <TopBar pipeline={state} violationCount={violations.length} />

            {/* Guardrail alerts */}
            {violations.length > 0 && (
              <div className="border-b border-gray-800">
                <GuardrailAlerts violations={violations} />
              </div>
            )}

            {/* Output stream */}
            <div className="flex-1 overflow-hidden">
              <OutputStream
                agent={selectedAgent}
                liveOutput={selectedAgentId ? agentOutputs.get(selectedAgentId) || '' : ''}
                onSendInput={(agentId, text) =>
                  sendCommand({ action: 'send-input', agentId, text })
                }
              />
            </div>
          </main>
        </div>
      )}

      {/* Spawn dialog */}
      {showSpawn && (
        <SpawnDialog
          onSpawn={sendCommand}
          onClose={() => setShowSpawn(false)}
        />
      )}

      {/* Kill confirmation dialog */}
      {killTarget && (
        <KillConfirmDialog
          agent={killTarget}
          onConfirm={() => {
            sendCommand({ action: 'kill', agentId: killTarget.id });
            setKillTarget(null);
          }}
          onCancel={() => setKillTarget(null)}
        />
      )}
    </div>
  );
}
