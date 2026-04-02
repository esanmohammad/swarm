import { useState, useEffect, useCallback, useRef } from 'react';
import { Wifi, WifiOff, Rocket, BarChart3, Clock, Home, UserPlus, Sun, Moon, Monitor, GitCompareArrows, BookOpen, Brain, GitPullRequest, Eye, HelpCircle, TrendingUp, ChevronDown, Wrench, Upload, Database, Bot, Shield, Package, AlertTriangle, Activity, Gauge, Inbox, FileText, Search, Layers, Users, GitBranch, RefreshCw } from 'lucide-react';
import { useWebSocket } from './hooks/useWebSocket';
import { useOnboarding } from './hooks/useOnboarding';
import { usePersistedState } from './hooks/usePersistedState';
import { LaunchView } from './views/LaunchView';
import { PipelineView } from './views/PipelineView';
import { ResultsView } from './views/ResultsView';
import { HistoryView } from './views/HistoryView';
import { SpawnDialog } from './components/SpawnDialog';
import { PipelineSelector } from './components/PipelineSelector';
import { PipelineCompare } from './components/PipelineCompare';
import { WelcomeScreen } from './components/WelcomeScreen';
import { ConventionsView } from './views/ConventionsView';
import { MemoryView } from './views/MemoryView';
import { PRReviewsView } from './views/PRReviewsView';
import { WatchView } from './views/WatchView';
import { ExplainView } from './views/ExplainView';
import { StatsView } from './views/StatsView';
import { DeployView } from './views/DeployView';
import { MigrateView } from './views/MigrateView';
import { AutopilotView } from './views/AutopilotView';
import { SecurityView } from './views/SecurityView';
import { DepsView } from './views/DepsView';
import { IncidentView } from './views/IncidentView';
import { HealthView } from './views/HealthView';
import { BenchmarkView } from './views/BenchmarkView';
import { InboxView } from './views/InboxView';
import { StandupView } from './views/StandupView';
import { JournalView } from './views/JournalView';
import { ScopeView } from './views/ScopeView';
import { ContextView } from './views/ContextView';
import { PairView } from './views/PairView';
import { DelegateView } from './views/DelegateView';
import { ReportView } from './views/ReportView';
import { TeamView } from './views/TeamView';
import { RetroView } from './views/RetroView';
import { useTheme } from './hooks/useTheme';
type View = 'launch' | 'pipeline' | 'results' | 'history' | 'conventions' | 'memory' | 'reviews' | 'watch' | 'explain' | 'stats' | 'deploy' | 'migrate' | 'autopilot' | 'security' | 'deps' | 'incident' | 'health-check' | 'benchmark' | 'inbox' | 'standup' | 'journal' | 'scope' | 'context' | 'pair' | 'delegate' | 'report' | 'team' | 'retro';

function getInitialView(): View {
  const hash = window.location.hash.replace('#', '');
  if (['launch', 'pipeline', 'results', 'history', 'conventions', 'memory', 'reviews', 'watch', 'explain', 'stats', 'deploy', 'migrate', 'autopilot', 'security', 'deps', 'incident', 'health-check', 'benchmark', 'inbox', 'standup', 'journal', 'scope', 'context', 'pair', 'delegate', 'report', 'team', 'retro'].includes(hash)) return hash as View;
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
  const { state, connected, agentOutputs, agentActivities, violations, historyEntries, artifactContent, pipelines, activePipeline, conventions, conventionsLoading, memories, prReviews, watchResults, deployResult, stats, autopilotState, healthReport, inboxState, standupReport, journalData, scopeAnalysis, contextIndex, pairSession, delegateState, reportData, teamActivity, retroReport, sendCommand, switchPipeline } = useWebSocket();
  const { theme, cycleTheme } = useTheme();
  const [view, setView] = usePersistedState<View>('swarm_view', getInitialView());
  const [showSpawn, setShowSpawn] = useState(false);
  const [showCompare, setShowCompare] = useState(false);
  const [showToolsMenu, setShowToolsMenu] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const prevMaydayStageRef = useRef<string | undefined>(undefined);
  const prevConnectedRef = useRef(connected);
  const { currentStep, advanceStep, completeOnboarding } = useOnboarding();

  // Navigate and update hash
  const navigate = useCallback((v: View) => {
    setView(v);
    window.location.hash = v;
  }, []);

  // Track whether we've already auto-navigated for the current pipeline run
  const autoNavRef = useRef<string | null>(null);

  // Auto-navigate based on pipeline state
  useEffect(() => {
    if (!state) return;

    const hasRunning = Object.values(state.stages).some((s) => s.status === 'running');
    const maydayActive = state.mayday?.active;
    const maydayComplete = state.mayday?.currentStage === 'complete';
    const runKey = state.mayday?.startedAt ? String(state.mayday.startedAt) : null;

    // If pipeline just started running, navigate to pipeline view (once per run)
    if ((hasRunning || maydayActive) && view === 'launch' && autoNavRef.current !== runKey) {
      autoNavRef.current = runKey;
      navigate('pipeline');
    }

    // If pipeline just completed, navigate to results
    if (maydayComplete && view === 'pipeline') {
      navigate('results');
    }

    // Reset auto-nav tracker when no pipeline is active
    if (!maydayActive && !hasRunning) {
      autoNavRef.current = null;
    }

    // Auto-advance onboarding steps based on pipeline state
    // Only advance for mayday pipeline runs, not individual agent spawns
    if (currentStep === 'first-launch' && maydayActive) {
      advanceStep('analyzing');
    }
    if (currentStep === 'analyzing' && state.stages.analyze?.status === 'done') {
      advanceStep('stage-complete');
    }
    if (currentStep === 'stage-complete' && state.stages.build?.status === 'running') {
      advanceStep('building');
    }
    if (currentStep === 'building' && maydayComplete) {
      advanceStep('done');
    }
  }, [state, view, navigate, currentStep, advanceStep]);

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

  // Keyboard shortcut: Ctrl/Cmd+K to open Spawn Agent dialog
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setShowSpawn((prev) => !prev);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Update browser title
  useEffect(() => {
    document.title = state?.projectName ? `Swarm — ${state.projectName}` : 'Swarm';
  }, [state?.projectName]);

  const PRIMARY_NAV: { key: View; label: string; icon: typeof Home }[] = [
    { key: 'launch', label: 'Launch', icon: Home },
    { key: 'pipeline', label: 'Pipeline', icon: Rocket },
    { key: 'results', label: 'Results', icon: BarChart3 },
    { key: 'history', label: 'History', icon: Clock },
  ];

  const TOOLS_NAV: { key: View; label: string; icon: typeof Home; hint: string }[] = [
    { key: 'conventions', label: 'Conventions', icon: BookOpen, hint: 'Project patterns & style' },
    { key: 'memory', label: 'Memory', icon: Brain, hint: 'Cross-run learning' },
    { key: 'reviews', label: 'PR Reviews', icon: GitPullRequest, hint: 'Automated PR review' },
    { key: 'watch', label: 'Watch', icon: Eye, hint: 'File watcher & auto-test' },
    { key: 'explain', label: 'Explain', icon: HelpCircle, hint: 'Codebase Q&A' },
    { key: 'stats', label: 'Cost Intelligence', icon: TrendingUp, hint: 'Spend analytics & ROI' },
    { key: 'deploy', label: 'Deploy', icon: Upload, hint: 'Deploy to staging/production' },
    { key: 'migrate', label: 'Migrate', icon: Database, hint: 'Database migrations' },
    { key: 'autopilot', label: 'Autopilot', icon: Bot, hint: 'Issue-to-PR automation' },
    { key: 'security', label: 'Security', icon: Shield, hint: 'Scans, secrets & sandbox' },
    { key: 'deps', label: 'Dependencies', icon: Package, hint: 'Dependency management' },
    { key: 'incident', label: 'Incident', icon: AlertTriangle, hint: 'Incident response' },
    { key: 'health-check', label: 'Health', icon: Activity, hint: 'Codebase health check' },
    { key: 'benchmark', label: 'Benchmark', icon: Gauge, hint: 'Performance benchmarks' },
    { key: 'inbox', label: 'Inbox', icon: Inbox, hint: 'Self-directed work queue' },
    { key: 'standup', label: 'Standup', icon: FileText, hint: 'Async status reports' },
    { key: 'journal', label: 'Journal', icon: BookOpen, hint: 'Decision tracking & learning' },
    { key: 'scope', label: 'Scope', icon: Search, hint: 'Requirement negotiation' },
    { key: 'context', label: 'Context', icon: Layers, hint: 'Codebase intelligence' },
    { key: 'pair', label: 'Pair', icon: Users, hint: 'Real-time collaboration' },
    { key: 'delegate', label: 'Delegate', icon: GitBranch, hint: 'Multi-agent decomposition' },
    { key: 'report', label: 'Report', icon: BarChart3, hint: 'ROI & impact reports' },
    { key: 'team', label: 'Team', icon: Users, hint: 'Multi-user coordination' },
    { key: 'retro', label: 'Retro', icon: RefreshCw, hint: 'Self-improvement retrospectives' },
  ];

  const isToolView = TOOLS_NAV.some(t => t.key === view);

  return (
    <div className="h-screen flex flex-col bg-[#0c0a09] text-stone-300">
      {/* Skip to content link (accessibility) */}
      <a href="#main-content" className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:px-3 focus:py-1.5 focus:bg-blue-600 focus:text-white focus:rounded-md focus:text-xs">
        Skip to content
      </a>

      {/* Navigation bar */}
      <header className="flex items-center justify-between px-2 sm:px-4 py-2 border-b border-stone-800/50 bg-[#0e0c0b]">
        <div className="flex items-center gap-2 sm:gap-4 min-w-0">
          <h1 className="text-sm font-semibold tracking-wide text-stone-300 shrink-0">
            swarm
          </h1>

          {state && (
            <PipelineSelector
              pipelines={pipelines}
              activePipeline={activePipeline}
              onSwitch={switchPipeline}
              sendCommand={sendCommand}
            />
          )}

          <nav className="flex items-center gap-0.5 sm:gap-1 ml-1 sm:ml-2" role="tablist" aria-label="Main navigation">
            {PRIMARY_NAV.map(({ key, label, icon: Icon }) => (
              <button
                key={key}
                onClick={() => { navigate(key); setShowToolsMenu(false); }}
                role="tab"
                aria-selected={view === key}
                aria-controls={`panel-${key}`}
                className={`flex items-center gap-1 sm:gap-1.5 px-2 sm:px-3 py-1.5 rounded-md text-xs font-medium transition-colors shrink-0 min-h-9 ${
                  view === key
                    ? 'bg-stone-800/60 text-stone-200'
                    : 'text-stone-500 hover:text-stone-300 hover:bg-stone-800/30'
                }`}
              >
                <Icon size={13} />
                <span className="hidden sm:inline">{label}</span>
              </button>
            ))}

            {/* Tools dropdown */}
            <div className="relative">
              <button
                onClick={() => setShowToolsMenu(!showToolsMenu)}
                className={`flex items-center gap-1 sm:gap-1.5 px-2 sm:px-3 py-1.5 rounded-md text-xs font-medium transition-colors shrink-0 min-h-9 ${
                  isToolView
                    ? 'bg-stone-800/60 text-stone-200'
                    : 'text-stone-500 hover:text-stone-300 hover:bg-stone-800/30'
                }`}
              >
                <Wrench size={13} />
                <span className="hidden sm:inline">{isToolView ? TOOLS_NAV.find(t => t.key === view)?.label || 'Tools' : 'Tools'}</span>
                <ChevronDown size={10} className={`transition-transform ${showToolsMenu ? 'rotate-180' : ''}`} />
              </button>
              {showToolsMenu && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setShowToolsMenu(false)} />
                  <div className="absolute top-full left-0 mt-1 z-50 w-56 py-1 rounded-lg bg-stone-900 border border-stone-700/50 shadow-xl">
                    {TOOLS_NAV.map(({ key, label, icon: Icon, hint }) => (
                      <button
                        key={key}
                        onClick={() => { navigate(key); setShowToolsMenu(false); }}
                        className={`flex items-center gap-2.5 w-full px-3 py-2 text-left transition-colors ${
                          view === key
                            ? 'bg-stone-800/60 text-stone-200'
                            : 'text-stone-400 hover:text-stone-200 hover:bg-stone-800/40'
                        }`}
                      >
                        <Icon size={14} className="shrink-0" />
                        <div>
                          <div className="text-xs font-medium">{label}</div>
                          <div className="text-[10px] text-stone-500">{hint}</div>
                        </div>
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          </nav>
        </div>

        <div className="flex items-center gap-1.5 sm:gap-3 shrink-0">
          {/* Compare Pipelines button (only show when multiple pipelines exist) */}
          {connected && state && pipelines.length > 1 && (
            <button
              onClick={() => setShowCompare(true)}
              className="flex items-center gap-1.5 px-2 sm:px-2.5 py-1.5 rounded-md text-xs font-medium text-stone-400 hover:text-stone-200 hover:bg-stone-800/40 border border-stone-800/40 hover:border-stone-700/50 transition-colors min-h-[36px]"
              aria-label="Compare pipelines"
              title="Compare pipelines"
            >
              <GitCompareArrows size={13} />
              <span className="hidden md:inline">Compare</span>
            </button>
          )}

          {/* Spawn Agent button */}
          {connected && state && (
            <button
              onClick={() => setShowSpawn(true)}
              className="flex items-center gap-1.5 px-2 sm:px-2.5 py-1.5 rounded-md text-xs font-medium text-stone-400 hover:text-stone-200 hover:bg-stone-800/40 border border-stone-800/40 hover:border-stone-700/50 transition-colors min-h-[36px]"
              aria-label="Spawn individual agent (Cmd+K)"
              title="Spawn individual agent (⌘K)"
            >
              <UserPlus size={13} />
              <span className="hidden md:inline">Spawn Agent</span>
            </button>
          )}

          {/* Cost display */}
          {state && state.totalCost.totalUsd > 0 && (
            <span className="text-xs text-amber-400 font-mono" aria-label={`Total cost: $${state.totalCost.totalUsd.toFixed(2)}`}>
              ${state.totalCost.totalUsd.toFixed(2)}
            </span>
          )}

          {/* Theme toggle */}
          <button
            onClick={cycleTheme}
            className="p-1.5 rounded-md text-stone-400 hover:text-stone-200 hover:bg-stone-800/40 transition-colors min-h-[36px] min-w-[36px] flex items-center justify-center"
            aria-label={`Theme: ${theme}. Click to cycle.`}
            title={`Theme: ${theme} (click to cycle)`}
          >
            {theme === 'dark' ? <Moon size={13} /> : theme === 'light' ? <Sun size={13} /> : <Monitor size={13} />}
          </button>

          {/* Connection status */}
          <div className="flex items-center gap-1.5" role="status" aria-live="polite" aria-label={connected ? 'Connected to server' : 'Disconnected from server'}>
            {connected ? (
              <Wifi size={12} className="text-green-500" aria-hidden="true" />
            ) : (
              <WifiOff size={12} className="text-red-500" aria-hidden="true" />
            )}
            <span className={`text-[10px] font-medium hidden sm:inline ${connected ? 'text-green-500' : 'text-red-500'}`}>
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
      <main id="main-content" role="tabpanel" aria-label={`${view} view`} className="flex-1 flex flex-col overflow-hidden">
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
              artifactContent={artifactContent}
              onboardingStep={currentStep}
              onDismissOnboarding={() => {
                if (currentStep === 'done') {
                  completeOnboarding();
                } else {
                  advanceStep(null);
                }
              }}
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
          {view === 'conventions' && (
            <ConventionsView
              sendCommand={sendCommand}
              conventions={conventions}
              conventionsLoading={conventionsLoading}
            />
          )}
          {view === 'memory' && (
            <MemoryView
              sendCommand={sendCommand}
              memories={memories}
            />
          )}
          {view === 'reviews' && (
            <PRReviewsView
              sendCommand={sendCommand}
              reviews={prReviews}
            />
          )}
          {view === 'watch' && (
            <WatchView
              sendCommand={sendCommand}
              watchResults={watchResults}
            />
          )}
          {view === 'explain' && (
            <ExplainView
              sendCommand={sendCommand}
              agents={state.agents}
              agentOutputs={agentOutputs}
            />
          )}
          {view === 'stats' && (
            <StatsView
              sendCommand={sendCommand}
              stats={stats}
            />
          )}
          {view === 'deploy' && (
            <DeployView sendCommand={sendCommand} deployResult={deployResult} />
          )}
          {view === 'migrate' && (
            <MigrateView
              sendCommand={sendCommand}
              agents={state.agents}
              agentOutputs={agentOutputs}
            />
          )}
          {view === 'autopilot' && (
            <AutopilotView
              sendCommand={sendCommand}
              autopilotState={autopilotState}
            />
          )}
          {view === 'security' && (
            <SecurityView sendCommand={sendCommand} />
          )}
          {view === 'deps' && (
            <DepsView sendCommand={sendCommand} />
          )}
          {view === 'incident' && (
            <IncidentView sendCommand={sendCommand} />
          )}
          {view === 'health-check' && (
            <HealthView sendCommand={sendCommand} healthReport={healthReport} />
          )}
          {view === 'benchmark' && (
            <BenchmarkView sendCommand={sendCommand} />
          )}
          {view === 'inbox' && (
            <InboxView sendCommand={sendCommand} inboxState={inboxState} />
          )}
          {view === 'standup' && (
            <StandupView sendCommand={sendCommand} standupReport={standupReport} />
          )}
          {view === 'journal' && (
            <JournalView sendCommand={sendCommand} journalData={journalData} />
          )}
          {view === 'scope' && (
            <ScopeView sendCommand={sendCommand} scopeAnalysis={scopeAnalysis} />
          )}
          {view === 'context' && (
            <ContextView sendCommand={sendCommand} contextIndex={contextIndex} />
          )}
          {view === 'pair' && (
            <PairView sendCommand={sendCommand} pairSession={pairSession} />
          )}
          {view === 'delegate' && (
            <DelegateView sendCommand={sendCommand} delegateState={delegateState} />
          )}
          {view === 'report' && (
            <ReportView sendCommand={sendCommand} reportData={reportData} />
          )}
          {view === 'team' && (
            <TeamView sendCommand={sendCommand} teamActivity={teamActivity} />
          )}
          {view === 'retro' && (
            <RetroView sendCommand={sendCommand} retroReport={retroReport} />
          )}
        </>
      )}
      </main>

      {/* Toast notifications */}
      {toasts.length > 0 && (
        <div className="fixed bottom-4 right-4 space-y-2 z-50" aria-live="assertive">
          {toasts.map((toast) => (
            <div
              key={toast.id}
              role="alert"
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

      {/* Pipeline comparison modal */}
      {showCompare && (
        <PipelineCompare
          pipelines={pipelines}
          activePipeline={activePipeline}
          sendCommand={sendCommand}
          artifactContent={artifactContent}
          onClose={() => setShowCompare(false)}
        />
      )}

      {/* Welcome screen for first-time users */}
      {currentStep === 'welcome' && (
        <WelcomeScreen
          onGetStarted={() => advanceStep('first-launch')}
          onSkip={completeOnboarding}
        />
      )}
    </div>
  );
}
