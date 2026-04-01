import { useState, useEffect, useCallback, useRef } from 'react';
import { Wifi, WifiOff, Rocket, BarChart3, Clock, Home } from 'lucide-react';
import { useWebSocket } from './hooks/useWebSocket';
import { LaunchView } from './views/LaunchView';
import { PipelineView } from './views/PipelineView';
import { ResultsView } from './views/ResultsView';
import { HistoryView } from './views/HistoryView';
import { SpawnDialog } from './components/SpawnDialog';
type View = 'launch' | 'pipeline' | 'results' | 'history';

function getInitialView(): View {
  const hash = window.location.hash.replace('#', '');
  if (['launch', 'pipeline', 'results', 'history'].includes(hash)) return hash as View;
  return 'launch';
}

// Toast system
interface Toast {
  id: number;
  message: string;
  type: 'info' | 'success' | 'error' | 'warning';
  timestamp: number;
}

let toastId = 0;

export default function App() {
  const { state, connected, agentOutputs, agentActivities, violations, historyEntries, sendCommand } = useWebSocket();
  const [view, setView] = useState<View>(getInitialView);
  const [showSpawn, setShowSpawn] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const prevMaydayStageRef = useRef<string | undefined>(undefined);
  const prevConnectedRef = useRef(connected);

  // Navigate and update hash
  const navigate = useCallback((v: View) => {
    setView(v);
    window.location.hash = v;
  }, []);

  // Auto-navigate based on pipeline state
  useEffect(() => {
    if (!state) return;

    const hasRunning = Object.values(state.stages).some((s) => s.status === 'running');
    const maydayActive = state.mayday?.active;
    const maydayComplete = state.mayday?.currentStage === 'complete';

    // If pipeline just started running, navigate to pipeline view
    if ((hasRunning || maydayActive) && view === 'launch') {
      navigate('pipeline');
    }

    // If pipeline just completed, navigate to results
    if (maydayComplete && view === 'pipeline') {
      navigate('results');
    }
  }, [state, view, navigate]);

  // Toast helper
  const addToast = useCallback((message: string, type: Toast['type'] = 'info') => {
    const id = ++toastId;
    setToasts((prev) => [...prev.slice(-4), { id, message, type, timestamp: Date.now() }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 5000);
  }, []);

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
        addToast('Pipeline complete!', 'success');
        // Browser notification
        if ('Notification' in window && Notification.permission === 'granted' && !document.hasFocus()) {
          new Notification('Swarm', { body: 'Pipeline completed!' });
        }
      } else if (currentStage === 'fix-loop') {
        addToast('Starting fix iteration...', 'info');
      }
    }
    prevMaydayStageRef.current = currentStage;
  }, [state?.mayday?.currentStage, addToast]);

  // Request notification permission
  useEffect(() => {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }
  }, []);

  // Update browser title
  useEffect(() => {
    document.title = state?.projectName ? `Swarm — ${state.projectName}` : 'Swarm';
  }, [state?.projectName]);

  const NAV_ITEMS: { key: View; label: string; icon: typeof Home }[] = [
    { key: 'launch', label: 'Launch', icon: Home },
    { key: 'pipeline', label: 'Pipeline', icon: Rocket },
    { key: 'results', label: 'Results', icon: BarChart3 },
    { key: 'history', label: 'History', icon: Clock },
  ];

  return (
    <div className="h-screen flex flex-col bg-[#0c0a09] text-stone-300">
      {/* Navigation bar */}
      <header className="flex items-center justify-between px-4 py-2 border-b border-stone-800/50 bg-[#0e0c0b]">
        <div className="flex items-center gap-4">
          <h1 className="text-sm font-semibold tracking-wide text-stone-300">
            swarm
            {state && <span className="text-blue-400 ml-1 font-normal">/ {state.projectName}</span>}
          </h1>

          <nav className="flex items-center gap-1 ml-2">
            {NAV_ITEMS.map(({ key, label, icon: Icon }) => (
              <button
                key={key}
                onClick={() => navigate(key)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                  view === key
                    ? 'bg-stone-800/60 text-stone-200'
                    : 'text-stone-500 hover:text-stone-300 hover:bg-stone-800/30'
                }`}
              >
                <Icon size={13} />
                {label}
              </button>
            ))}
          </nav>
        </div>

        <div className="flex items-center gap-3">
          {/* Cost display */}
          {state && state.totalCost.totalUsd > 0 && (
            <span className="text-xs text-amber-400 font-mono">
              ${state.totalCost.totalUsd.toFixed(2)}
            </span>
          )}

          {/* Connection status */}
          <div className="flex items-center gap-1.5">
            {connected ? (
              <Wifi size={12} className="text-green-500" />
            ) : (
              <WifiOff size={12} className="text-red-500" />
            )}
            <span className={`text-[10px] font-medium ${connected ? 'text-green-500' : 'text-red-500'}`}>
              {connected ? 'connected' : 'offline'}
            </span>
          </div>
        </div>
      </header>

      {/* Reconnecting banner */}
      {!connected && (
        <div className="px-4 py-1.5 bg-amber-950/30 border-b border-amber-800/30 text-center">
          <span className="text-xs text-amber-400">Reconnecting to server...</span>
        </div>
      )}

      {/* Main content */}
      {!state ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center text-stone-500">
            <Rocket size={36} className="mx-auto mb-3 opacity-20" />
            <p className="text-sm">Connecting to Swarm...</p>
          </div>
        </div>
      ) : (
        <>
          {view === 'launch' && (
            <LaunchView
              sendCommand={sendCommand}
              historyEntries={historyEntries}
              onNavigate={navigate}
            />
          )}
          {view === 'pipeline' && (
            <PipelineView
              pipeline={state}
              sendCommand={sendCommand}
              agentOutputs={agentOutputs}
              agentActivities={agentActivities}
              violations={violations}
            />
          )}
          {view === 'results' && (
            <ResultsView
              pipeline={state}
              agentActivities={agentActivities}
              onNavigate={navigate}
            />
          )}
          {view === 'history' && (
            <HistoryView
              entries={historyEntries}
              sendCommand={sendCommand}
            />
          )}
        </>
      )}

      {/* Toast notifications */}
      {toasts.length > 0 && (
        <div className="fixed bottom-4 right-4 space-y-2 z-50">
          {toasts.map((toast) => (
            <div
              key={toast.id}
              className={`px-4 py-2 rounded-lg text-xs font-medium shadow-lg border transition-all animate-fade-in ${
                toast.type === 'success' ? 'bg-green-950/80 text-green-300 border-green-800/50' :
                toast.type === 'error' ? 'bg-red-950/80 text-red-300 border-red-800/50' :
                toast.type === 'warning' ? 'bg-amber-950/80 text-amber-300 border-amber-800/50' :
                'bg-stone-900/80 text-stone-300 border-stone-700/50'
              }`}
            >
              {toast.message}
            </div>
          ))}
        </div>
      )}

      {/* Spawn dialog (accessible via keyboard shortcut) */}
      {showSpawn && (
        <SpawnDialog
          onSpawn={sendCommand}
          onClose={() => setShowSpawn(false)}
        />
      )}
    </div>
  );
}
