import { useState } from 'react';
import { Wifi, WifiOff, Plus, Skull } from 'lucide-react';
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
    <div className="h-screen flex flex-col bg-[#080808]">
      {/* Header */}
      <header className="flex items-center justify-between px-5 py-3 border-b border-stone-800/40 bg-[#0a0a0a]">
        <div className="flex items-center gap-3">
          <Skull size={22} className="text-red-700" />
          <h1 className="text-lg font-bold tracking-wider text-stone-200">SWARM</h1>
          {state && (
            <span className="text-sm text-stone-400 font-light">
              {state.projectName} <span className="text-stone-500">/</span> {state.stack}
            </span>
          )}
        </div>

        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1.5">
            {connected ? (
              <Wifi size={13} className="text-emerald-700" />
            ) : (
              <WifiOff size={13} className="text-red-700" />
            )}
            <span className={`text-xs ${connected ? 'text-emerald-700' : 'text-red-700'}`}>
              {connected ? 'Live' : 'Offline'}
            </span>
          </div>
        </div>
      </header>

      {!state ? (
        <div className="flex-1 flex items-center justify-center text-stone-500">
          <div className="text-center">
            <Skull size={56} className="mx-auto mb-4 opacity-10" />
            <p className="text-sm">Awaiting connection...</p>
            <p className="text-xs mt-1 text-stone-500">swarm dashboard</p>
          </div>
        </div>
      ) : (
        <div className="flex-1 flex overflow-hidden">
          {/* Left sidebar */}
          <aside className="w-72 border-r border-stone-800/40 flex flex-col overflow-hidden bg-[#0a0a0a]">
            <CostPanel pipeline={state} />

            <div className="border-t border-stone-800/40 flex-1 overflow-y-auto">
              <div className="flex items-center justify-between px-4 py-2.5">
                <h3 className="text-[11px] font-semibold text-stone-400 uppercase tracking-widest">
                  Agents ({state.agents.length})
                </h3>
                <button
                  onClick={() => setShowSpawn(true)}
                  className="p-1 rounded hover:bg-stone-800/50 text-stone-400 hover:text-red-500 transition-colors"
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
                  <p className="text-xs text-stone-500 text-center py-6">
                    No agents spawned
                  </p>
                )}
              </div>
            </div>
          </aside>

          {/* Main content */}
          <main className="flex-1 flex flex-col overflow-hidden bg-[#080808]">
            <TopBar pipeline={state} violationCount={violations.length} />

            {violations.length > 0 && (
              <div className="border-b border-stone-800/40">
                <GuardrailAlerts violations={violations} />
              </div>
            )}

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

      {showSpawn && (
        <SpawnDialog
          onSpawn={sendCommand}
          onClose={() => setShowSpawn(false)}
        />
      )}

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
