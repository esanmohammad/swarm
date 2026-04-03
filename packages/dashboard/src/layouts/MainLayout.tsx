import { useState, useEffect, useRef, useCallback } from 'react';
import { Outlet } from 'react-router-dom';
import { Sidebar } from '../components/Sidebar';
import { NewTopBar } from '../components/NewTopBar';
import { CommandPalette } from '../components/CommandPalette';
import { SpawnDialog } from '../components/SpawnDialog';
import { PipelineSelector } from '../components/PipelineSelector';
import { PipelineCompare } from '../components/PipelineCompare';
import { ActionsProvider } from '../context/ActionsContext';
import { WebSocketProvider, useWs } from '../context/WebSocketContext';

// Toast system
interface Toast {
  id: number;
  message: string;
  type: 'info' | 'success' | 'error' | 'warning';
  timestamp: number;
}

let toastId = 0;

function MainLayoutInner() {
  const ws = useWs();
  const { connected, state, pipelines, activePipeline, switchPipeline, sendCommand, artifactContent } = ws;

  const [showSpawn, setShowSpawn] = useState(false);
  const [showCompare, setShowCompare] = useState(false);
  const [showPalette, setShowPalette] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const prevConnectedRef = useRef(connected);
  const prevMaydayStageRef = useRef<string | undefined>(undefined);

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

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        if (e.shiftKey) {
          setShowSpawn((prev) => !prev);
        } else {
          setShowPalette((prev) => !prev);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  return (
    <div className="h-screen flex bg-[#0c0a09] text-stone-300">
      {/* Skip to content */}
      <a href="#main-content" className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:px-3 focus:py-1.5 focus:bg-blue-600 focus:text-white focus:rounded-md focus:text-xs">
        Skip to content
      </a>

      <Sidebar />

      <div className="flex-1 flex flex-col min-w-0">
        <NewTopBar
          connected={connected}
          totalCost={state?.totalCost?.totalUsd}
          projectName={state?.projectName}
          pipelinesCount={pipelines.length}
          onSpawnAgent={() => setShowSpawn(true)}
          onComparePipelines={() => setShowCompare(true)}
          onOpenPalette={() => setShowPalette(true)}
        />

        {/* Pipeline selector when multiple pipelines */}
        {state && pipelines.length > 1 && (
          <div className="px-4 py-1 border-b border-stone-800/30">
            <PipelineSelector
              pipelines={pipelines}
              activePipeline={activePipeline}
              onSwitch={switchPipeline}
              sendCommand={sendCommand}
            />
          </div>
        )}

        {/* Reconnecting banner */}
        {!connected && (
          <div className="px-4 py-1.5 bg-amber-950/30 border-b border-amber-800/30 text-center">
            <span className="text-xs text-amber-400">Reconnecting to server...</span>
          </div>
        )}

        <main id="main-content" className="flex-1 flex flex-col overflow-hidden">
          {!state ? (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center text-stone-500">
                <div className="w-8 h-8 border-2 border-stone-700 border-t-stone-400 rounded-full animate-spin mx-auto mb-3" />
                <p className="text-sm">Connecting to Swarm...</p>
              </div>
            </div>
          ) : (
            <Outlet />
          )}
        </main>
      </div>

      {/* Toast notifications */}
      {toasts.length > 0 && (
        <div className="fixed bottom-4 right-4 space-y-2 z-50" aria-live="assertive">
          {toasts.map((toast) => (
            <div
              key={toast.id}
              role="alert"
              className={`px-4 py-2 rounded-lg text-xs font-medium shadow-lg border transition-all ${
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

      {/* Command palette */}
      <CommandPalette open={showPalette} onClose={() => setShowPalette(false)} />

      {/* Spawn dialog */}
      {showSpawn && (
        <SpawnDialog onSpawn={sendCommand} onClose={() => setShowSpawn(false)} />
      )}

      {/* Pipeline comparison */}
      {showCompare && (
        <PipelineCompare
          pipelines={pipelines}
          activePipeline={activePipeline}
          sendCommand={sendCommand}
          artifactContent={artifactContent}
          onClose={() => setShowCompare(false)}
        />
      )}
    </div>
  );
}

export function MainLayout() {
  return (
    <WebSocketProvider>
      <ActionsProvider>
        <MainLayoutInner />
      </ActionsProvider>
    </WebSocketProvider>
  );
}
