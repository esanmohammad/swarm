import { useState } from 'react';
import { Wifi, WifiOff, Plus, Terminal } from 'lucide-react';
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
  const { state, connected, agentOutputs, agentActivities, violations, sendCommand } = useWebSocket();
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [showSpawn, setShowSpawn] = useState(false);
  const [killTarget, setKillTarget] = useState<Agent | null>(null);

  const selectedAgent = state?.agents.find((a) => a.id === selectedAgentId) ?? null;

  return (
    <div className="h-screen flex flex-col bg-[#0c0a09]">
      {/* Header — terminal title bar */}
      <header className="flex items-center justify-between px-4 py-2 border-b border-stone-800/50 bg-[#0c0a09]">
        <div className="flex items-center gap-3">
          {/* Terminal window dots */}
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-red-600/80" />
            <span className="w-2.5 h-2.5 rounded-full bg-amber-600/60" />
            <span className="w-2.5 h-2.5 rounded-full bg-green-600/60" />
          </div>
          <div className="w-px h-4 bg-stone-800/50 mx-1" />
          <Terminal size={14} className="text-red-600" />
          <h1 className="text-sm font-semibold tracking-[0.2em] text-stone-300 uppercase">swarm</h1>
          {state && (
            <span className="text-xs text-stone-500 font-light">
              <span className="text-stone-600">//</span> {state.projectName}
              <span className="text-stone-600">:</span>{state.stack}
            </span>
          )}
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            {connected ? (
              <Wifi size={12} className="text-green-500" />
            ) : (
              <WifiOff size={12} className="text-red-500" />
            )}
            <span className={`text-[10px] font-medium uppercase tracking-wider ${connected ? 'text-green-500' : 'text-red-500'}`}>
              {connected ? 'connected' : 'offline'}
            </span>
          </div>
        </div>
      </header>

      {!state ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center text-stone-600">
            <Terminal size={48} className="mx-auto mb-4 opacity-20" />
            <p className="text-sm font-mono">$ swarm dashboard --connect</p>
            <p className="text-xs mt-2 text-stone-700">awaiting connection...</p>
          </div>
        </div>
      ) : (
        <div className="flex-1 flex overflow-hidden">
          {/* Left sidebar — agent list */}
          <aside className="w-72 border-r border-stone-800/50 flex flex-col overflow-hidden bg-[#0e0c0b]">
            <CostPanel pipeline={state} />

            <div className="border-t border-stone-800/50 flex-1 overflow-y-auto">
              <div className="flex items-center justify-between px-3 py-2">
                <span className="text-[10px] text-stone-500 font-medium tracking-widest uppercase">
                  processes <span className="text-stone-600">({state.agents.length})</span>
                </span>
                <button
                  onClick={() => setShowSpawn(true)}
                  className="p-1 rounded hover:bg-stone-800/50 text-stone-500 hover:text-green-500 transition-colors"
                  title="Spawn agent"
                >
                  <Plus size={13} />
                </button>
              </div>

              <div className="px-2 pb-3 space-y-1">
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
                  <p className="text-[10px] text-stone-600 text-center py-8 font-mono">
                    no active processes
                  </p>
                )}
              </div>
            </div>
          </aside>

          {/* Main content */}
          <main className="flex-1 flex flex-col overflow-hidden bg-[#0c0a09]">
            <TopBar pipeline={state} violationCount={violations.length} onRunStage={sendCommand} />

            {violations.length > 0 && (
              <div className="border-b border-stone-800/50">
                <GuardrailAlerts violations={violations} />
              </div>
            )}

            <div className="flex-1 overflow-hidden">
              <OutputStream
                agent={selectedAgent}
                liveOutput={selectedAgentId ? agentOutputs.get(selectedAgentId) || '' : ''}
                activities={selectedAgentId ? agentActivities.get(selectedAgentId) || [] : []}
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
