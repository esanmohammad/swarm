import { useState, useEffect, useRef, useCallback } from 'react';
import type { PipelineState, PipelineInfo, WsMessage, WsCommand, GuardrailViolation, AgentActivity, HistoryEntry, StageName, AutopilotState, InboxState, StandupReport, JournalData, ScopeAnalysis, ContextIndex, PairSessionState, DelegateState, ReportData, TeamActivity, RetroReport, SurfacesState, ArchReviewData, OnboardData, RoadmapData, SystemGraphData, SloData, DebtData, ForecastData, ComplianceData, PluginRegistryData, ModelConfig, ModelInfo, ProviderStatus } from '../types';

// WS port is injected by the dashboard HTTP server into window.__SWARM_WS_PORT__
// Falls back to deriving from dashboard port (wsPort = dashboardPort - 1) or default 3847
const wsPort = (window as unknown as Record<string, unknown>).__SWARM_WS_PORT__
  ?? (parseInt(new URLSearchParams(window.location.search).get('wsPort') || '', 10)
  || (window.location.port ? parseInt(window.location.port, 10) - 1 : 3847));
const wsToken = (window as unknown as Record<string, unknown>).__SWARM_WS_TOKEN__ as string | undefined;
const WS_URL = wsToken
  ? `ws://${window.location.hostname}:${wsPort}?token=${wsToken}`
  : `ws://${window.location.hostname}:${wsPort}`;
const RECONNECT_DELAY = 2000;
const MAX_RECONNECT_DELAY = 30000;

interface UseWebSocketReturn {
  state: PipelineState | null;
  connected: boolean;
  agentOutputs: Map<string, string>;
  agentActivities: Map<string, AgentActivity[]>;
  violations: GuardrailViolation[];
  historyEntries: HistoryEntry[];
  artifactContent: Map<StageName, string>;
  pipelines: PipelineInfo[];
  activePipeline: string;
  conventions: string | null;
  conventionsLoading: boolean;
  memories: Array<{ id: string; kind: string; content: string; createdAt: string; expiresAt: string; confidence: number; source: string; tags: string[] }>;
  prReviews: Array<{ number: number; sha: string; reviewedAt: string; verdict: string; cost: number }>;
  watchResults: Array<{ passed: boolean; output: string; testCmd: string; timestamp: number }>;
  busMessages: Array<{ id: string; fromAgentId: string; fromPersona: string; toAgentId: string; toPersona: string; kind: string; content: string; timestamp: number; delivered: boolean }>;
  deployResult: { environment: string; steps: Array<{ name: string; cmd: string; status: 'pass' | 'fail' | 'skip' | 'pending'; output?: string; durationMs: number }>; success: boolean; rolledBack: boolean; timestamp: number } | null;
  stats: { totalRuns: number; passed: number; failed: number; successRate: number; totalCost: number; avgCostPerRun: number; avgDurationMs: number; avgFixIterations: number; stageCosts: Array<{ stage: string; totalCost: number; avgCost: number; avgDurationMs: number; count: number }>; weeklySpend: Array<{ week: string; cost: number; runs: number }>; recommendations: string[] } | null;
  autopilotState: AutopilotState | null;
  healthReport: { overall: number; metrics: Array<{ name: string; score: number; status: string; detail: string; suggestion?: string }>; timestamp: number } | null;
  inboxState: InboxState | null;
  standupReport: StandupReport | null;
  journalData: JournalData | null;
  scopeAnalysis: ScopeAnalysis | null;
  contextIndex: ContextIndex | null;
  pairSession: PairSessionState | null;
  delegateState: DelegateState | null;
  reportData: ReportData | null;
  teamActivity: TeamActivity | null;
  retroReport: RetroReport | null;
  surfacesState: SurfacesState | null;
  archReview: ArchReviewData | null;
  onboardData: OnboardData | null;
  roadmapData: RoadmapData | null;
  systemGraph: SystemGraphData | null;
  sloData: SloData | null;
  debtData: DebtData | null;
  forecastData: ForecastData | null;
  complianceData: ComplianceData | null;
  pluginRegistry: PluginRegistryData | null;
  modelConfig: ModelConfig | null;
  availableModels: ModelInfo[] | null;
  providerStatus: ProviderStatus[] | null;
  budgetExceeded: { spent: number; budget: number; message: string } | null;
  clearBudgetExceeded: () => void;
  lastError: { message: string; timestamp: number } | null;
  clearLastError: () => void;
  sendCommand: (cmd: WsCommand) => void;
  switchPipeline: (namespace: string) => void;
  listPipelines: () => void;
}

export function useWebSocket(): UseWebSocketReturn {
  const [state, setState] = useState<PipelineState | null>(null);
  const [connected, setConnected] = useState(false);
  const [violations, setViolations] = useState<GuardrailViolation[]>([]);
  const [historyEntries, setHistoryEntries] = useState<HistoryEntry[]>([]);
  const [pipelines, setPipelines] = useState<PipelineInfo[]>([]);
  const [activePipeline, setActivePipeline] = useState('default');
  const [conventions, setConventions] = useState<string | null>(null);
  const [conventionsLoading, setConventionsLoading] = useState(false);
  const [memories, setMemories] = useState<Array<{ id: string; kind: string; content: string; createdAt: string; expiresAt: string; confidence: number; source: string; tags: string[] }>>([]);
  const [prReviews, setPrReviews] = useState<Array<{ number: number; sha: string; reviewedAt: string; verdict: string; cost: number }>>([]);
  const [watchResults, setWatchResults] = useState<Array<{ passed: boolean; output: string; testCmd: string; timestamp: number }>>([]);
  const [deployResult, setDeployResult] = useState<UseWebSocketReturn['deployResult']>(null);
  const [busMessages, setBusMessages] = useState<Array<{ id: string; fromAgentId: string; fromPersona: string; toAgentId: string; toPersona: string; kind: string; content: string; timestamp: number; delivered: boolean }>>([]);
  const [stats, setStats] = useState<UseWebSocketReturn['stats']>(null);
  const [autopilotState, setAutopilotState] = useState<AutopilotState | null>(null);
  const [healthReport, setHealthReport] = useState<UseWebSocketReturn['healthReport']>(null);
  const [inboxState, setInboxState] = useState<InboxState | null>(null);
  const [standupReport, setStandupReport] = useState<StandupReport | null>(null);
  const [journalData, setJournalData] = useState<JournalData | null>(null);
  const [scopeAnalysis, setScopeAnalysis] = useState<ScopeAnalysis | null>(null);
  const [contextIndex, setContextIndex] = useState<ContextIndex | null>(null);
  const [pairSession, setPairSession] = useState<PairSessionState | null>(null);
  const [delegateState, setDelegateState] = useState<DelegateState | null>(null);
  const [reportData, setReportData] = useState<ReportData | null>(null);
  const [teamActivity, setTeamActivity] = useState<TeamActivity | null>(null);
  const [retroReport, setRetroReport] = useState<RetroReport | null>(null);
  const [surfacesState, setSurfacesState] = useState<SurfacesState | null>(null);
  const [archReview, setArchReview] = useState<ArchReviewData | null>(null);
  const [onboardData, setOnboardData] = useState<OnboardData | null>(null);
  const [roadmapData, setRoadmapData] = useState<RoadmapData | null>(null);
  const [systemGraph, setSystemGraph] = useState<SystemGraphData | null>(null);
  const [sloData, setSloData] = useState<SloData | null>(null);
  const [debtData, setDebtData] = useState<DebtData | null>(null);
  const [forecastData, setForecastData] = useState<ForecastData | null>(null);
  const [complianceData, setComplianceData] = useState<ComplianceData | null>(null);
  const [pluginRegistry, setPluginRegistry] = useState<PluginRegistryData | null>(null);
  const [budgetExceeded, setBudgetExceeded] = useState<UseWebSocketReturn['budgetExceeded']>(null);
  const [lastError, setLastError] = useState<UseWebSocketReturn['lastError']>(null);
  const [modelConfig, setModelConfig] = useState<ModelConfig | null>(null);
  const [availableModels, setAvailableModels] = useState<ModelInfo[] | null>(null);
  const [providerStatus, setProviderStatus] = useState<ProviderStatus[] | null>(null);
  const agentOutputsRef = useRef(new Map<string, string>());
  const agentActivitiesRef = useRef(new Map<string, AgentActivity[]>());
  const artifactContentRef = useRef(new Map<StageName, string>());
  const [, forceUpdate] = useState(0);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectDelay = useRef(RECONNECT_DELAY);

  const connect = useCallback(() => {
    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      reconnectDelay.current = RECONNECT_DELAY;
      // Request pipeline list and history after connecting
      ws.send(JSON.stringify({ action: 'list-pipelines' }));
      ws.send(JSON.stringify({ action: 'get-history' }));
    };

    ws.onclose = () => {
      setConnected(false);
      // Auto-reconnect with exponential backoff
      setTimeout(() => {
        reconnectDelay.current = Math.min(reconnectDelay.current * 1.5, MAX_RECONNECT_DELAY);
        connect();
      }, reconnectDelay.current);
    };

    ws.onerror = () => {
      ws.close();
    };

    ws.onmessage = (event) => {
      try {
        const msg: WsMessage = JSON.parse(event.data);

        switch (msg.type) {
          case 'state':
            setState(msg.payload);
            // Load violations from state (e.g. from evaluate command run in another terminal)
            if (msg.payload.violations && msg.payload.violations.length > 0) {
              setViolations(msg.payload.violations);
            }
            break;

          case 'agent-update':
            // Ignore malformed agent-update messages (e.g. server error responses with no id)
            if (!msg.payload?.id) break;
            setState((prev) => {
              if (!prev) return prev;
              const agents = prev.agents.map((a) =>
                a.id === msg.payload.id ? msg.payload : a,
              );
              if (!agents.find((a) => a.id === msg.payload.id)) {
                agents.push(msg.payload);
              }
              return { ...prev, agents };
            });
            // Refresh history when an agent completes (new history entry may exist)
            if (msg.payload.status === 'done' || msg.payload.status === 'error') {
              ws.send(JSON.stringify({ action: 'get-history' }));
            }
            break;

          case 'agent-output':
            agentOutputsRef.current.set(
              msg.payload.agentId,
              (agentOutputsRef.current.get(msg.payload.agentId) || '') + msg.payload.chunk,
            );
            forceUpdate((n) => n + 1);
            break;

          case 'agent-activity': {
            const aid = msg.payload.agentId;
            const existing = agentActivitiesRef.current.get(aid) || [];
            // Keep last 1000 activities per agent to avoid unbounded growth
            const updated = [...existing, msg.payload].slice(-1000);
            agentActivitiesRef.current.set(aid, updated);
            forceUpdate((n) => n + 1);
            break;
          }

          case 'agent-logs': {
            const { agentId: logAgentId, output: logOutput, activities: logActivities } = msg.payload;
            if (logOutput) {
              // Prepend historical output (only if we don't already have content for this agent)
              const current = agentOutputsRef.current.get(logAgentId) || '';
              if (!current) {
                agentOutputsRef.current.set(logAgentId, logOutput);
              }
            }
            if (logActivities && logActivities.length > 0) {
              const currentActs = agentActivitiesRef.current.get(logAgentId) || [];
              if (currentActs.length === 0) {
                agentActivitiesRef.current.set(logAgentId, logActivities.slice(-1000));
              }
            }
            forceUpdate((n) => n + 1);
            break;
          }

          case 'guardrail-alert':
            setViolations((prev) => [...prev, msg.payload]);
            break;

          case 'cost-update':
            setState((prev) => prev ? { ...prev, totalCost: msg.payload } : prev);
            break;

          case 'history-list':
            setHistoryEntries(msg.payload);
            break;

          case 'agent-log':
            if (msg.payload?.agentId && msg.payload?.log) {
              agentOutputsRef.current.set(msg.payload.agentId, msg.payload.log);
              forceUpdate(n => n + 1);
            }
            break;

          case 'artifact-content':
            if (msg.payload.content) {
              artifactContentRef.current.set(msg.payload.stage, msg.payload.content);
              forceUpdate((n) => n + 1);
            }
            break;

          case 'pipeline-list':
            setPipelines(msg.payload.pipelines);
            setActivePipeline(msg.payload.active);
            break;

          case 'conventions':
            setConventions(msg.payload.content);
            setConventionsLoading(msg.payload.loading);
            break;

          case 'memories':
            setMemories(msg.payload.entries);
            break;

          case 'pr-reviews':
            setPrReviews(msg.payload.reviews);
            break;

          case 'watch-result':
            setWatchResults(prev => [...prev, msg.payload]);
            break;

          case 'deploy-result':
            setDeployResult(msg.payload);
            break;

          case 'bus-messages':
            setBusMessages(msg.payload.messages);
            break;

          case 'stats':
            setStats(msg.payload);
            break;

          case 'autopilot-state':
            setAutopilotState(msg.payload);
            break;

          case 'health-report':
            setHealthReport(msg.payload);
            break;

          case 'inbox-state':
            setInboxState(msg.payload);
            break;

          case 'standup-report':
            setStandupReport(msg.payload);
            break;

          case 'journal-data':
            setJournalData(msg.payload);
            break;

          case 'scope-analysis':
            setScopeAnalysis(msg.payload);
            break;

          case 'context-index':
            setContextIndex(msg.payload);
            break;

          case 'pair-session':
            setPairSession(msg.payload);
            break;

          case 'delegate-state':
            setDelegateState(msg.payload);
            break;

          case 'report-data':
            setReportData(msg.payload);
            break;

          case 'team-activity':
            setTeamActivity(msg.payload);
            break;

          case 'retro-report':
            setRetroReport(msg.payload);
            break;

          case 'surfaces-state':
            setSurfacesState(msg.payload);
            break;

          case 'arch-review':
            setArchReview(msg.payload);
            break;

          case 'onboard-data':
            setOnboardData(msg.payload);
            break;

          case 'roadmap-data':
            setRoadmapData(msg.payload);
            break;

          case 'system-graph':
            setSystemGraph(msg.payload);
            break;

          case 'slo-data':
            setSloData(msg.payload);
            break;

          case 'debt-data':
            setDebtData(msg.payload);
            break;

          case 'forecast-data':
            setForecastData(msg.payload);
            break;

          case 'compliance-data':
            setComplianceData(msg.payload);
            break;

          case 'plugin-registry':
            setPluginRegistry(msg.payload);
            break;

          case 'budget-exceeded':
            setBudgetExceeded(msg.payload);
            break;

          case 'model-config':
            setModelConfig(msg.payload);
            break;

          case 'models-list':
            setAvailableModels(msg.payload);
            break;

          case 'providers-list':
            setProviderStatus(msg.payload);
            break;

          case 'error':
            setLastError({ message: msg.payload?.message || 'An unknown error occurred', timestamp: Date.now() });
            break;
        }
      } catch {
        // ignore malformed messages
      }
    };
  }, []);

  useEffect(() => {
    connect();
    return () => {
      wsRef.current?.close();
    };
  }, [connect]);

  const sendCommand = useCallback((cmd: WsCommand) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(cmd));
    }
  }, []);

  const switchPipeline = useCallback((namespace: string) => {
    sendCommand({ action: 'switch-pipeline', namespace });
  }, [sendCommand]);

  const listPipelines = useCallback(() => {
    sendCommand({ action: 'list-pipelines' });
  }, [sendCommand]);

  return {
    state,
    connected,
    agentOutputs: agentOutputsRef.current,
    agentActivities: agentActivitiesRef.current,
    violations,
    historyEntries,
    artifactContent: artifactContentRef.current,
    pipelines,
    activePipeline,
    conventions,
    conventionsLoading,
    memories,
    prReviews,
    watchResults,
    deployResult,
    busMessages,
    stats,
    autopilotState,
    healthReport,
    inboxState,
    standupReport,
    journalData,
    scopeAnalysis,
    contextIndex,
    pairSession,
    delegateState,
    reportData,
    teamActivity,
    retroReport,
    surfacesState,
    archReview,
    onboardData,
    roadmapData,
    systemGraph,
    sloData,
    debtData,
    forecastData,
    complianceData,
    pluginRegistry,
    budgetExceeded,
    clearBudgetExceeded: useCallback(() => setBudgetExceeded(null), []),
    lastError,
    clearLastError: useCallback(() => setLastError(null), []),
    modelConfig,
    availableModels,
    providerStatus,
    sendCommand,
    switchPipeline,
    listPipelines,
  };
}
