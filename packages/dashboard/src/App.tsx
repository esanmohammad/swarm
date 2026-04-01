import { useState, useEffect, useRef, useCallback } from 'react';
import { Wifi, WifiOff, Plus, Terminal } from 'lucide-react';
import { useWebSocket } from './hooks/useWebSocket';
import { TopBar } from './components/TopBar';
import { AgentCard } from './components/AgentCard';
import { CostPanel } from './components/CostPanel';
import { OutputStream } from './components/OutputStream';
import { GuardrailAlerts } from './components/GuardrailAlerts';
import { SpawnDialog } from './components/SpawnDialog';
import { KillConfirmDialog } from './components/KillConfirmDialog';
import { EmptyState } from './components/EmptyState';
import { HistoryView } from './components/HistoryView';
import type { Agent, AgentStatus, StageName } from './types';

const SHORTCUTS: { keys: string; desc: string }[] = [
  { keys: '\u2318/Ctrl + N', desc: 'Spawn agent' },
  { keys: '\u2191 / \u2193', desc: 'Select prev/next agent' },
  { keys: '\u2318/Ctrl + K', desc: 'Kill selected agent' },
  { keys: '\u2318/Ctrl + Enter', desc: 'Run next pending stage' },
  { keys: 'Escape', desc: 'Close dialog' },
  { keys: '?', desc: 'Toggle this help' },
];

const STAGE_ORDER: StageName[] = ['analyze', 'architect', 'plan', 'build', 'test'];

function ShortcutsHelp({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50" onClick={onClose}>
      <div
        className="bg-[#0e0c0b] rounded border border-stone-700 w-full max-w-sm font-mono"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-stone-700">
          <span className="text-xs text-stone-400">keyboard shortcuts</span>
          <button onClick={onClose} className="text-stone-600 hover:text-stone-400 transition-colors text-xs">
            [esc]
          </button>
        </div>
        <div className="p-4 space-y-2">
          {SHORTCUTS.map((s) => (
            <div key={s.keys} className="flex items-center justify-between">
              <span className="text-xs text-stone-300 bg-stone-800/60 px-2 py-0.5 rounded border border-stone-700/50">{s.keys}</span>
              <span className="text-xs text-stone-400">{s.desc}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const { state, connected, agentOutputs, agentActivities, violations, historyEntries, sendCommand } = useWebSocket();
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [showSpawn, setShowSpawn] = useState(false);
  const [killTarget, setKillTarget] = useState<Agent | null>(null);
  const [showShortcuts, setShowShortcuts] = useState(false);

  const selectedAgent = state?.agents.find((a) => a.id === selectedAgentId) ?? null;
  const allStagesPending = state
    ? Object.values(state.stages).every((s) => s.status === 'pending')
    : false;
  const showEmptyState = state !== null && state.agents.length === 0 && allStagesPending;

  // --- Browser notifications ---
  const prevAgentStatusesRef = useRef<Map<string, AgentStatus>>(new Map());
  const prevMaydayStageRef = useRef<string | undefined>(undefined);
  const prevViolationCountRef = useRef<number>(0);

  // Request notification permission on mount
  useEffect(() => {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }
  }, []);

  const notify = useCallback((title: string, body: string) => {
    if (
      'Notification' in window &&
      Notification.permission === 'granted' &&
      !document.hasFocus()
    ) {
      new Notification(title, { body, icon: '/favicon.ico' });
    }
  }, []);

  // Watch agent status transitions
  useEffect(() => {
    if (!state?.agents) return;

    const prev = prevAgentStatusesRef.current;
    for (const agent of state.agents) {
      const prevStatus = prev.get(agent.id);
      if (prevStatus && prevStatus !== agent.status) {
        if (agent.status === 'done') {
          notify('Agent completed', `${agent.name} finished successfully`);
        } else if (agent.status === 'error') {
          notify('Agent failed', `${agent.name} failed: ${agent.error || 'unknown error'}`);
        }
      }
    }

    const next = new Map<string, AgentStatus>();
    for (const agent of state.agents) {
      next.set(agent.id, agent.status);
    }
    prevAgentStatusesRef.current = next;
  }, [state?.agents, notify]);

  // Watch MayDay pipeline stage transitions
  useEffect(() => {
    const currentStage = state?.mayday?.currentStage;
    const prevStage = prevMaydayStageRef.current;

    if (prevStage && prevStage !== currentStage) {
      if (currentStage === 'complete') {
        notify('Pipeline completed', 'MayDay pipeline completed!');
      } else if (currentStage === 'fix-loop') {
        notify('Fix iteration', 'MayDay fix iteration starting');
      }
    }

    prevMaydayStageRef.current = currentStage;
  }, [state?.mayday?.currentStage, notify]);

  // Watch guardrail violations
  useEffect(() => {
    const currentCount = violations.length;
    const prevCount = prevViolationCountRef.current;

    if (currentCount > prevCount) {
      const latest = violations[currentCount - 1];
      notify('Guardrail violation', latest?.message || 'A guardrail check failed');
    }

    prevViolationCountRef.current = currentCount;
  }, [violations, notify]);

  // Update browser tab title with project name
  useEffect(() => {
    document.title = state?.projectName ? `SWARM-${state.projectName}` : 'SWARM';
  }, [state?.projectName]);

  // --- Global keyboard shortcuts ---
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't trigger shortcuts when typing in inputs
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      const mod = e.metaKey || e.ctrlKey;

      // ? — toggle shortcuts help
      if (e.key === '?' && !mod) {
        e.preventDefault();
        setShowShortcuts((v) => !v);
        return;
      }

      // Escape — close any open dialog
      if (e.key === 'Escape') {
        if (showShortcuts) { setShowShortcuts(false); e.preventDefault(); return; }
        if (showSpawn) { setShowSpawn(false); e.preventDefault(); return; }
        if (killTarget) { setKillTarget(null); e.preventDefault(); return; }
        return;
      }

      // Cmd/Ctrl + N — open spawn dialog
      if (mod && e.key === 'n') {
        e.preventDefault();
        setShowSpawn(true);
        return;
      }

      // Cmd/Ctrl + K — kill selected agent
      if (mod && e.key === 'k') {
        e.preventDefault();
        if (selectedAgentId && state) {
          const agent = state.agents.find((a) => a.id === selectedAgentId);
          if (agent && agent.status === 'running') {
            setKillTarget(agent);
          }
        }
        return;
      }

      // Cmd/Ctrl + Enter — run next pending stage
      if (mod && e.key === 'Enter') {
        e.preventDefault();
        if (state) {
          const nextStage = STAGE_ORDER.find((s) => state.stages[s]?.status === 'pending');
          if (nextStage) {
            // For stages needing prompt (analyze, plan, test), we just trigger the stage click behavior
            // For architect/build, run directly
            if (nextStage === 'architect' || nextStage === 'build') {
              sendCommand({ action: 'run-stage', stage: nextStage });
            }
            // analyze/plan/test need prompt input — user should click the stage button
          }
        }
        return;
      }

      // ArrowUp — select previous agent
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (state && state.agents.length > 0) {
          const idx = state.agents.findIndex((a) => a.id === selectedAgentId);
          if (idx <= 0) {
            setSelectedAgentId(state.agents[state.agents.length - 1].id);
          } else {
            setSelectedAgentId(state.agents[idx - 1].id);
          }
        }
        return;
      }

      // ArrowDown — select next agent
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (state && state.agents.length > 0) {
          const idx = state.agents.findIndex((a) => a.id === selectedAgentId);
          if (idx < 0 || idx >= state.agents.length - 1) {
            setSelectedAgentId(state.agents[0].id);
          } else {
            setSelectedAgentId(state.agents[idx + 1].id);
          }
        }
        return;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [state, selectedAgentId, showSpawn, killTarget, showShortcuts, sendCommand]);

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
          <h1 className="text-sm font-semibold tracking-[0.2em] text-stone-300 uppercase">
            swarm{state ? <span className="text-red-500">-{state.projectName}</span> : ''}
          </h1>
          {state && (
            <span className="text-xs text-stone-400 font-light">
              <span className="text-stone-400">:</span>{state.stack}
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
          <div className="text-center text-stone-400">
            <Terminal size={48} className="mx-auto mb-4 opacity-20" />
            <p className="text-sm font-mono">$ swarm dashboard --connect</p>
            <p className="text-xs mt-2 text-stone-400">awaiting connection...</p>
          </div>
        </div>
      ) : (
        <div className="flex-1 flex overflow-hidden">
          {/* Left sidebar — agent list */}
          <aside className="w-72 border-r border-stone-800/50 flex flex-col overflow-hidden bg-[#0e0c0b]">
            <CostPanel pipeline={state} />

            <div className="border-t border-stone-800/50 flex-1 overflow-y-auto">
              <div className="flex items-center justify-between px-3 py-2">
                <span className="text-[10px] text-stone-400 font-medium tracking-widest uppercase">
                  processes <span className="text-stone-400">({state.agents.length})</span>
                </span>
                <button
                  onClick={() => setShowSpawn(true)}
                  className="p-1 rounded hover:bg-stone-800 text-stone-400 hover:text-green-500 transition-colors"
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
                  <p className="text-[10px] text-stone-400 text-center py-8 font-mono">
                    no active processes
                  </p>
                )}
              </div>
            </div>

            {/* History section */}
            <div className="border-t border-stone-800/50 max-h-64 overflow-hidden flex flex-col">
              <HistoryView entries={historyEntries} sendCommand={sendCommand} />
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
              {showEmptyState ? (
                <EmptyState sendCommand={sendCommand} />
              ) : (
                <OutputStream
                  agent={selectedAgent}
                  liveOutput={selectedAgentId ? agentOutputs.get(selectedAgentId) || '' : ''}
                  activities={selectedAgentId ? agentActivities.get(selectedAgentId) || [] : []}
                  onSendInput={(agentId, text) =>
                    sendCommand({ action: 'send-input', agentId, text })
                  }
                />
              )}
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

      {showShortcuts && (
        <ShortcutsHelp onClose={() => setShowShortcuts(false)} />
      )}
    </div>
  );
}
