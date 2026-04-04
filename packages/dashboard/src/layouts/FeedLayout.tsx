import { useState, useEffect, useRef, useCallback } from 'react';
import { Header } from '../components/header/Header';
import { Feed } from '../components/feed/Feed';
import { Canvas } from '../components/canvas/Canvas';
import { ActionBar } from '../components/actionbar/ActionBar';
import { CommandPalette } from '../components/CommandPalette';
import { KillConfirmDialog } from '../components/KillConfirmDialog';
import { BudgetDialog } from '../components/BudgetDialog';
import { WebSocketProvider, useWs } from '../context/WebSocketContext';
import { ActionsProvider } from '../context/ActionsContext';
import { useFeedStore } from '../store/feed-store';
import type { Agent, WsCommand } from '../types';

// Toast system
interface Toast {
  id: number;
  message: string;
  type: 'info' | 'success' | 'error' | 'warning';
}

let toastId = 0;

// Human-friendly action labels
const ACTION_LABELS: Record<string, string> = {
  'run-mayday': 'Building feature',
  'run-fix': 'Fixing bug',
  'run-review': 'Starting code review',
  'run-spike': 'Researching',
  'run-refactor': 'Refactoring code',
  'run-simplify': 'Cleaning up code',
  'run-learn': 'Scanning conventions',
  'run-babysit-prs': 'Reviewing open PRs',
};

function FeedLayoutInner() {
  const ws = useWs();
  const { connected, state, sendCommand: rawSendCommand } = ws;
  const { selectedId, select, selectNext, selectPrev } = useFeedStore();

  const [showPalette, setShowPalette] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [killAgent, setKillAgent] = useState<Agent | null>(null);
  const prevConnectedRef = useRef(connected);
  const prevMaydayStageRef = useRef<string | undefined>(undefined);

  const addToast = useCallback((message: string, type: Toast['type'] = 'info') => {
    const id = ++toastId;
    setToasts((prev) => [...prev.slice(-4), { id, message, type, timestamp: Date.now() }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 4000);
  }, []);

  // Wrap sendCommand to show action toasts
  const sendCommand = useCallback((cmd: WsCommand) => {
    rawSendCommand(cmd);
    const label = ACTION_LABELS[cmd.action];
    if (label) {
      addToast(`${label}...`, 'info');
    }
  }, [rawSendCommand, addToast]);

  // Connection status toasts
  useEffect(() => {
    if (prevConnectedRef.current && !connected) {
      addToast('Connection lost — reconnecting...', 'warning');
    } else if (!prevConnectedRef.current && connected) {
      addToast('Connected', 'success');
    }
    prevConnectedRef.current = connected;
  }, [connected, addToast]);

  // Mayday stage transition notifications
  useEffect(() => {
    const currentStage = state?.mayday?.currentStage;
    const prevStage = prevMaydayStageRef.current;
    if (prevStage && prevStage !== currentStage) {
      if (currentStage === 'complete') {
        addToast('Build complete!', 'success');
        if ('Notification' in window && Notification.permission === 'granted' && !document.hasFocus()) {
          new Notification('Hivemind', { body: 'Build complete!' });
        }
      } else if (currentStage === 'fix-loop') {
        addToast('Starting fix iteration...', 'info');
      }
    }
    prevMaydayStageRef.current = currentStage;
  }, [state?.mayday?.currentStage, addToast]);

  // Auto-select new running agents
  const prevAgentIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!state) return;
    const currentIds = new Set(state.agents.filter((a) => a.status === 'running').map((a) => a.id));
    const prevIds = prevAgentIdsRef.current;
    for (const id of currentIds) {
      if (!prevIds.has(id)) {
        if (state.mayday?.active) select('mayday');
        else select(`agent:${id}`);
        break;
      }
    }
    if (state.mayday?.active && prevIds.size === 0 && currentIds.size > 0) select('mayday');
    prevAgentIdsRef.current = currentIds;
  }, [state, select]);

  // Notification for completed agents
  const prevAgentStatusRef = useRef<Map<string, string>>(new Map());
  useEffect(() => {
    if (!state) return;
    for (const agent of state.agents) {
      const prev = prevAgentStatusRef.current.get(agent.id);
      if (prev === 'running' && (agent.status === 'done' || agent.status === 'error')) {
        const status = agent.status === 'done' ? 'success' : 'error';
        addToast(`${agent.name} ${agent.status === 'done' ? 'completed' : 'failed'}`, status);
        if ('Notification' in window && Notification.permission === 'granted' && !document.hasFocus()) {
          new Notification('Hivemind', { body: `${agent.name} ${agent.status === 'done' ? 'completed' : 'failed'}` });
        }
      }
      prevAgentStatusRef.current.set(agent.id, agent.status);
    }
  }, [state, addToast]);

  // Request notification permission
  useEffect(() => {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }
  }, []);

  // Update browser title
  useEffect(() => {
    document.title = state?.projectName ? `Hivemind — ${state.projectName}` : 'Hivemind';
  }, [state?.projectName]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore when typing in inputs
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setShowPalette((prev) => !prev);
        return;
      }

      // Arrow key feed navigation
      if (e.key === 'ArrowDown' || e.key === 'j') {
        e.preventDefault();
        selectNext();
      } else if (e.key === 'ArrowUp' || e.key === 'k') {
        e.preventDefault();
        selectPrev();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectNext, selectPrev]);

  return (
    <div className="h-screen flex flex-col font-ui" style={{ backgroundColor: 'var(--bg-base)' }}>
      <a href="#main-content" className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:px-3 focus:py-1.5 focus:bg-blue-600 focus:text-white focus:rounded-md focus:text-xs">
        Skip to content
      </a>

      <Header
        projectName={state?.projectName}
        totalCost={state?.totalCost?.totalUsd}
        connected={connected}
        onOpenPalette={() => setShowPalette(true)}
      />

      {!connected && (
        <div
          className="px-4 py-1.5 text-center text-xs"
          style={{ backgroundColor: 'var(--status-warning-bg)', borderBottom: '1px solid var(--border-muted)', color: 'var(--status-warning)' }}
        >
          Reconnecting to server...
        </div>
      )}

      <div id="main-content" className="flex-1 flex min-h-0">
        {state ? (
          <>
            <Feed state={state} historyEntries={ws.historyEntries} agentOutputs={ws.agentOutputs} onKillAgent={setKillAgent} />
            <Canvas state={state} ws={ws} selectedId={selectedId} />
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center" style={{ color: 'var(--text-tertiary)' }}>
              <div className="w-8 h-8 border-2 rounded-full animate-spin mx-auto mb-3" style={{ borderColor: 'var(--border-default)', borderTopColor: 'var(--text-secondary)' }} />
              <p className="text-sm">Connecting...</p>
            </div>
          </div>
        )}
      </div>

      {state && <ActionBar sendCommand={sendCommand} state={state} />}

      {/* Toasts */}
      {toasts.length > 0 && (
        <div className="fixed bottom-16 right-4 space-y-2 z-50" aria-live="assertive">
          {toasts.map((toast) => (
            <div
              key={toast.id}
              role="alert"
              className="px-4 py-2 rounded-lg text-xs font-medium shadow-lg animate-fade-in"
              style={{
                backgroundColor: toast.type === 'success' ? 'var(--status-success-bg)'
                  : toast.type === 'error' ? 'var(--status-error-bg)'
                  : toast.type === 'warning' ? 'var(--status-warning-bg)'
                  : 'var(--bg-raised)',
                color: toast.type === 'success' ? 'var(--status-success)'
                  : toast.type === 'error' ? 'var(--status-error)'
                  : toast.type === 'warning' ? 'var(--status-warning)'
                  : 'var(--text-primary)',
                border: '1px solid var(--border-muted)',
              }}
            >
              {toast.message}
            </div>
          ))}
        </div>
      )}

      <CommandPalette open={showPalette} onClose={() => setShowPalette(false)} sendCommand={sendCommand} />

      {killAgent && (
        <KillConfirmDialog
          agent={killAgent}
          onConfirm={() => { sendCommand({ action: 'kill', agentId: killAgent.id }); setKillAgent(null); }}
          onCancel={() => setKillAgent(null)}
        />
      )}

      {ws.budgetExceeded && (
        <BudgetDialog
          spent={ws.budgetExceeded.spent}
          budget={ws.budgetExceeded.budget}
          message={ws.budgetExceeded.message}
          sendCommand={sendCommand}
          onDismiss={() => ws.clearBudgetExceeded()}
        />
      )}
    </div>
  );
}

export function FeedLayout() {
  return (
    <WebSocketProvider>
      <ActionsProvider>
        <FeedLayoutInner />
      </ActionsProvider>
    </WebSocketProvider>
  );
}
