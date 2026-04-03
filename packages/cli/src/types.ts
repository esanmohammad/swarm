// Agent lifecycle states
export type AgentStatus = 'pending' | 'running' | 'done' | 'error' | 'killed';

// Claude CLI permission modes
export type PermissionMode = 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan' | 'auto';

// The five personas
export type Persona = 'analyst' | 'architect' | 'lead' | 'engineer' | 'tester';

// Supported tech stacks
export type TechStack = 'react' | 'node' | 'go' | 'python' | 'rust' | 'swift' | 'custom';

// Pipeline stage names
export type StageName = 'analyze' | 'architect' | 'plan' | 'build' | 'test' | 'evaluate';

export interface CostInfo {
  totalUsd: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  durationMs: number;
}

export function emptyCost(): CostInfo {
  return { totalUsd: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, durationMs: 0 };
}

export function addCosts(a: CostInfo, b: CostInfo): CostInfo {
  return {
    totalUsd: a.totalUsd + b.totalUsd,
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
    cacheWriteTokens: a.cacheWriteTokens + b.cacheWriteTokens,
    durationMs: a.durationMs + b.durationMs,
  };
}

// Core agent representation
export interface Agent {
  id: string;
  name: string;
  persona: Persona;
  stack: TechStack;
  status: AgentStatus;
  pid: number | null;
  sessionId: string;
  model: string;
  permissionMode: PermissionMode;
  startedAt: number | null;
  finishedAt: number | null;
  cost: CostInfo;
  output: string;
  error: string | null;
  /** ID of parent orchestrator agent (for sub-engineers) */
  parentId: string | null;
  /** IDs of child sub-engineer agents (for orchestrator) */
  childIds: string[];
  /** Tool restrictions (persisted so resumes carry them) */
  allowedTools?: string[];
  disallowedTools?: string[];
  /** System enforcement prompt (persisted so resumes carry it) */
  appendSystemPrompt?: string;
}

// Pipeline stage tracking
export interface StageState {
  status: 'pending' | 'running' | 'done' | 'error' | 'skipped';
  agentIds: string[];
  artifact: string | null;
  startedAt?: number;
  /** Claude session ID for --resume (persists across restarts) */
  sessionId?: string;
  /** Short summary of stage output (~500 chars) for context feeding */
  contextSummary?: string;
  /** When stage completed */
  finishedAt?: number;
  /** Cost of this stage (tracked from pipeline totalCost delta) */
  stageCost?: number;
}

// Fix history entry for intelligent fix loop
export interface FixHistoryEntry {
  iteration: number;
  failedTests: string[];
  fixedTests: string[];
  newFailures: string[];
  approach: string;
  agentId: string;
  cost: number;
  timestamp: number;
}

// MayDay autonomous pipeline state
export interface MaydayState {
  active: boolean;
  featureRequest: string;
  currentStage: StageName | 'fix-loop' | 'complete';
  fixIteration: number;
  maxFixIterations: number;
  lastTestOutput: string | null;
  lastTestPassed: boolean | null;
  failureCount: number | null;
  fixAgentIds: string[];
  userMessages: string[];
  startedAt: number;
  pausedAt: number | null;
  error: string | null;
  figmaUrl?: string;
  /** Maximum total USD to spend on fix iterations before aborting */
  maxFixBudgetUsd: number | null;
  approvalRequired: boolean;
  pendingApproval?: { stage: StageName; requestedAt: number } | null;
  prUrl?: string;
  /** Fix loop history — tracks what was tried and what happened */
  fixHistory?: FixHistoryEntry[];
}

export interface QualityScoreInfo {
  stage: StageName;
  artifact: string;
  overall: number;
  dimensions: Array<{ name: string; score: number; detail: string }>;
  timestamp: number;
}

export interface PipelineState {
  projectName: string;
  stack: TechStack;
  stages: Record<StageName, StageState>;
  agents: Agent[];
  totalCost: CostInfo;
  violations: GuardrailViolation[];
  qualityScores?: QualityScoreInfo[];
  updatedAt: number;
  mayday?: MaydayState;
  /** Absolute path to git worktree for this pipeline (non-default pipelines only) */
  worktreePath?: string;
}

export interface StageBreakdown {
  name: string;
  cost: number;
  durationMs: number;
  model?: string;
  status: 'done' | 'error' | 'skipped' | 'pending';
}

export type ActivityType = 'pipeline' | 'fix' | 'review' | 'spike' | 'refactor' | 'simplify' | 'test-gen' | 'learn' | 'pr' | 'check';

export interface HistoryEntry {
  runId: string;
  timestamp: number;
  projectName: string;
  stack: TechStack;
  totalCost: CostInfo;
  stagesSummary: Record<StageName, 'done' | 'error' | 'skipped' | 'pending'>;
  featureRequest?: string;
  durationMs: number;
  /** Per-stage cost and timing breakdowns (added in v2) */
  stageBreakdowns?: StageBreakdown[];
  /** Number of fix iterations in this run */
  fixIterations?: number;
  /** Default model used for this run */
  model?: string;
  /** Type of activity — pipeline run, quick workflow, etc. Defaults to 'pipeline' for backward compat. */
  activityType?: ActivityType;
  /** Short summary of what was done (for quick workflows) */
  summary?: string;
  /** Status of the activity */
  activityStatus?: 'success' | 'error' | 'partial';
  /** Agent IDs involved in this activity (for retrieving logs) */
  agentIds?: string[];
}

export function createEmptyPipeline(projectName: string, stack: TechStack): PipelineState {
  const emptyStage = (): StageState => ({ status: 'pending', agentIds: [], artifact: null });
  return {
    projectName,
    stack,
    stages: {
      analyze: emptyStage(),
      architect: emptyStage(),
      plan: emptyStage(),
      build: emptyStage(),
      test: emptyStage(),
      evaluate: emptyStage(),
    },
    agents: [],
    totalCost: emptyCost(),
    violations: [],
    updatedAt: Date.now(),
  };
}

// Agent activity — tool use, file operations, thinking, etc.
export type ActivityKind = 'tool_use' | 'tool_result' | 'thinking' | 'text';

export interface AgentActivity {
  id: string;
  agentId: string;
  kind: ActivityKind;
  /** Tool name (Read, Edit, Bash, Grep, Glob, Write, etc.) */
  tool?: string;
  /** Short summary — file path, command, or first ~200 chars */
  summary: string;
  /** Full content (tool input JSON, result text, thinking text) */
  content?: string;
  timestamp: number;
}

// WebSocket message types
export type WsMessage =
  | { type: 'state'; payload: PipelineState }
  | { type: 'agent-update'; payload: Agent }
  | { type: 'agent-output'; payload: { agentId: string; chunk: string } }
  | { type: 'agent-activity'; payload: AgentActivity }
  | { type: 'agent-logs'; payload: { agentId: string; output: string; activities: AgentActivity[] } }
  | { type: 'guardrail-alert'; payload: GuardrailViolation }
  | { type: 'cost-update'; payload: CostInfo }
  | { type: 'history-list'; payload: HistoryEntry[] }
  | { type: 'agent-log'; payload: { agentId: string; log: string } }
  | { type: 'approval-request'; payload: { stage: StageName; summary: string } }
  | { type: 'artifact-content'; payload: { stage: StageName; artifact: string; content: string | null } }
  | { type: 'pipeline-list'; payload: { pipelines: PipelineInfo[]; active: string } }
  | { type: 'conventions'; payload: { content: string | null; loading: boolean } }
  | { type: 'memories'; payload: { entries: Array<{ id: string; kind: string; content: string; createdAt: string; expiresAt: string; confidence: number; source: string; tags: string[] }> } }
  | { type: 'pr-reviews'; payload: { reviews: Array<{ number: number; sha: string; reviewedAt: string; verdict: string; cost: number }> } }
  | { type: 'watch-result'; payload: { passed: boolean; output: string; testCmd: string; timestamp: number } }
  | { type: 'bus-messages'; payload: { messages: Array<{ id: string; fromAgentId: string; fromPersona: string; toAgentId: string; toPersona: string; kind: string; content: string; timestamp: number; delivered: boolean }> } }
  | { type: 'deploy-result'; payload: { environment: string; steps: Array<{ name: string; cmd: string; status: 'pass' | 'fail' | 'skip' | 'pending'; output?: string; durationMs: number }>; success: boolean; rolledBack: boolean; timestamp: number } }
  | { type: 'stats'; payload: { totalRuns: number; passed: number; failed: number; successRate: number; totalCost: number; avgCostPerRun: number; avgDurationMs: number; avgFixIterations: number; stageCosts: Array<{ stage: string; totalCost: number; avgCost: number; avgDurationMs: number; count: number }>; weeklySpend: Array<{ week: string; cost: number; runs: number }>; recommendations: string[] } }
  | { type: 'autopilot-state'; payload: AutopilotState }
  | { type: 'risk-scores'; payload: { scores: Array<{ file: string; overall: number; level: string; dimensions: Array<{ name: string; score: number; weight: number; detail: string }> }> } }
  | { type: 'incidents'; payload: { incidents: Array<{ id: string; description: string; severity: string; status: string; startedAt: number; resolvedAt?: number; rootCause?: string; cost: number }> } }
  | { type: 'benchmark-report'; payload: { results: Array<{ name: string; opsPerSec?: number; avgMs?: number }>; regressions: Array<{ name: string; changePercent: number }>; bundleSize?: { totalBytes: number }; timestamp: number } }
  | { type: 'health-report'; payload: { overall: number; metrics: Array<{ name: string; score: number; status: string; detail: string; suggestion?: string }>; timestamp: number } }
  | { type: 'security-report'; payload: { findings: Array<{ id: string; category: string; severity: string; file: string; line: number; message: string; suggestion: string }>; summary: { critical: number; high: number; medium: number; low: number }; scannedFiles: number } }
  | { type: 'provenance'; payload: { records: Array<{ runId: string; timestamp: number; model: string; files: Array<{ path: string; action: string }>; cost: number }> } }
  | { type: 'runtime-events'; payload: { events: Array<{ type: string; detail: string; timestamp: number; severity: string; source: string }>; anomalyCount: number } }
  | { type: 'secrets-report'; payload: { findings: Array<{ type: string; file: string; line: number; severity: string; message: string }>; gitignoreIssues: string[] } }
  | { type: 'fingerprint-report'; payload: { files: Array<{ file: string; origin: string; confidence: number; aiPercentage: number; model?: string }>; summary: { totalFiles: number; aiFiles: number; humanFiles: number; mixedFiles: number; aiLinesEstimate: number; totalLines: number } } }
  | { type: 'inbox-state'; payload: InboxState }
  | { type: 'standup-report'; payload: StandupReport }
  | { type: 'journal-data'; payload: JournalData }
  | { type: 'scope-analysis'; payload: ScopeAnalysis }
  | { type: 'context-index'; payload: ContextIndex }
  | { type: 'pair-session'; payload: PairSessionState }
  | { type: 'delegate-state'; payload: DelegateState }
  | { type: 'report-data'; payload: ReportData }
  | { type: 'team-activity'; payload: TeamActivity }
  | { type: 'retro-report'; payload: RetroReport }
  | { type: 'surfaces-state'; payload: SurfacesState }
  | { type: 'arch-review'; payload: ArchReviewData }
  | { type: 'onboard-data'; payload: OnboardData }
  | { type: 'roadmap-data'; payload: RoadmapData }
  | { type: 'system-graph'; payload: SystemGraphData }
  | { type: 'slo-data'; payload: SloData }
  | { type: 'debt-data'; payload: DebtData }
  | { type: 'forecast-data'; payload: ForecastData }
  | { type: 'compliance-data'; payload: ComplianceData }
  | { type: 'plugin-registry'; payload: PluginRegistryData }
  | { type: 'observe-state'; payload: ObserveState }
  | { type: 'experiment-state'; payload: ExperimentState }
  | { type: 'self-improvement'; payload: SelfImprovementData }
  | { type: 'optimize-report'; payload: OptimizeReport }
  | { type: 'impact-report'; payload: ImpactReport }
  | { type: 'fleet-state'; payload: FleetState }
  | { type: 'contract-data'; payload: ContractData }
  | { type: 'simulation-report'; payload: SimulationReport }
  | { type: 'teach-state'; payload: TeachState }
  | { type: 'negotiate-state'; payload: NegotiateState }
  | { type: 'specialize-state'; payload: SpecializeState }
  | { type: 'govern-state'; payload: GovernState }
  | { type: 'empathize-state'; payload: EmpathizeState }
  | { type: 'allocate-state'; payload: AllocateState }
  | { type: 'compete-state'; payload: CompeteState }
  | { type: 'spawn-state'; payload: SpawnState }
  | { type: 'federate-state'; payload: FederateState }
  | { type: 'error'; payload: { message: string } };

export interface PipelineInfo {
  namespace: string;
  projectName: string;
  currentStage: string;
  status: 'running' | 'complete' | 'error' | 'idle';
  updatedAt: number;
  totalCost: CostInfo;
  worktreePath?: string;
}

export type WsCommand =
  | { action: 'spawn'; name: string; persona: Persona; stack: TechStack; model?: string; prompt?: string; permissionMode?: PermissionMode }
  | { action: 'kill'; agentId: string }
  | { action: 'send-input'; agentId: string; text: string }
  | { action: 'get-state' }
  | { action: 'run-stage'; stage: 'analyze' | 'architect' | 'plan' | 'build' | 'test'; prompt?: string; parallel?: number; taskId?: string; figmaUrl?: string; baseUrl?: string; authStorageState?: string }
  | { action: 'run-mayday'; prompt: string; maxIterations?: number; figmaUrl?: string; parallel?: number; resume?: boolean; model?: string; maxFixBudgetUsd?: number | null; fromStage?: StageName; approvalRequired?: boolean; lean?: boolean }
  | { action: 'mayday-input'; text: string }
  | { action: 'mayday-stop' }
  | { action: 'mayday-approve'; stage: StageName }
  | { action: 'mayday-reject'; stage: StageName; reason?: string }
  | { action: 'get-history' }
  | { action: 'get-agent-log'; agentId: string }
  | { action: 'get-artifact'; stage: StageName }
  | { action: 'list-pipelines' }
  | { action: 'switch-pipeline'; namespace: string }
  | { action: 'delete-pipeline'; namespace: string }
  | { action: 'create-pipeline'; namespace: string }
  | { action: 'run-fix'; prompt?: string; issue?: string; model?: string }
  | { action: 'run-spike'; prompt: string; model?: string }
  | { action: 'run-review'; target?: string; model?: string }
  | { action: 'run-refactor'; prompt: string; scope?: string; model?: string }
  | { action: 'run-simplify'; scope?: string; dryRun?: boolean; model?: string }
  | { action: 'run-learn'; refresh?: boolean }
  | { action: 'get-conventions' }
  | { action: 'save-conventions'; content: string }
  | { action: 'get-memories' }
  | { action: 'add-memory'; content: string; kind?: string; tags?: string[] }
  | { action: 'remove-memory'; id: string }
  | { action: 'clear-memories' }
  | { action: 'run-babysit-prs'; label?: string; autoApprove?: boolean; model?: string }
  | { action: 'get-pr-reviews' }
  | { action: 'run-watch-test'; scope?: string }
  | { action: 'run-watch-fix'; testOutput: string; changedFiles: string[]; model?: string }
  | { action: 'run-explain'; target?: string; depth?: string; diagram?: boolean; model?: string }
  | { action: 'agent-message'; fromAgentId: string; toAgentId: string; kind: string; content: string }
  | { action: 'get-bus-messages' }
  | { action: 'get-stats'; period?: number }
  | { action: 'run-deploy'; environment: string; dryRun?: boolean }
  | { action: 'run-migrate'; description: string; dryRun?: boolean; model?: string }
  | { action: 'autopilot-start'; label?: string; interval?: number; maxConcurrent?: number; budget?: number; stack?: TechStack; dryRun?: boolean }
  | { action: 'autopilot-stop' }
  | { action: 'autopilot-status' }
  | { action: 'run-deps-check' }
  | { action: 'run-deps-update'; level?: string; model?: string; verify?: boolean; budget?: number }
  | { action: 'run-deps-audit' }
  | { action: 'run-test-gen'; scope?: string; model?: string; framework?: string; coverage?: boolean; verify?: boolean; budget?: number }
  | { action: 'run-risk'; files?: string[] }
  | { action: 'run-incident'; description: string; severity?: string; logs?: string; model?: string; fix?: boolean }
  | { action: 'get-incidents' }
  | { action: 'run-pm-sync'; provider?: string; project?: string }
  | { action: 'run-pm-import'; ticketId: string; provider?: string; model?: string }
  | { action: 'run-benchmark'; cmd?: string; threshold?: number }
  | { action: 'run-multi-repo'; feature: string; repos?: string[]; model?: string; budget?: number; parallel?: boolean }
  | { action: 'get-multi-repo-status' }
  | { action: 'run-health' }
  | { action: 'run-secure'; full?: boolean; fix?: boolean; scope?: string; model?: string }
  | { action: 'run-supply-chain-check'; package?: string }
  | { action: 'get-sandbox-status' }
  | { action: 'set-sandbox-mode'; mode: string }
  | { action: 'get-provenance'; file?: string; runId?: string; limit?: number }
  | { action: 'run-prompt-guard-scan'; text: string }
  | { action: 'get-runtime-events'; since?: number; severity?: string }
  | { action: 'save-runtime-baseline' }
  | { action: 'run-fingerprint'; scope?: string }
  | { action: 'run-secrets-scan'; scope?: string; includeTests?: boolean }
  | { action: 'inbox-start'; label?: string; interval?: number; maxConcurrent?: number; budget?: number }
  | { action: 'inbox-stop' }
  | { action: 'inbox-pause' }
  | { action: 'inbox-status' }
  | { action: 'inbox-add'; task: string }
  | { action: 'inbox-skip'; itemId: string }
  | { action: 'inbox-prioritize'; itemId: string }
  | { action: 'get-standup'; weekly?: boolean }
  | { action: 'post-standup'; weekly?: boolean }
  | { action: 'get-journal' }
  | { action: 'run-journal-analyze' }
  | { action: 'run-journal-calibrate' }
  | { action: 'run-scope'; request: string }
  | { action: 'get-context-index' }
  | { action: 'run-context-build' }
  | { action: 'run-context-query'; query: string }
  | { action: 'pair-start'; mode?: string; focusDir?: string }
  | { action: 'pair-stop' }
  | { action: 'get-pair-session' }
  | { action: 'run-delegate'; feature: string; maxParallel?: number; budget?: number; dryRun?: boolean }
  | { action: 'get-delegate-status' }
  | { action: 'run-delegate-merge' }
  | { action: 'get-report'; period?: string }
  | { action: 'get-team-activity' }
  | { action: 'team-notify'; message: string }
  | { action: 'get-retro'; period?: string }
  | { action: 'run-retro'; period?: string; autoApply?: boolean }
  | { action: 'get-surfaces' }
  | { action: 'own-surface'; name: string; slos?: Record<string, string> }
  | { action: 'release-surface'; name: string }
  | { action: 'run-arch-review'; focus?: string }
  | { action: 'get-arch-review' }
  | { action: 'run-onboard'; role?: string; area?: string }
  | { action: 'run-mentor'; question: string }
  | { action: 'get-onboard-data' }
  | { action: 'get-roadmap' }
  | { action: 'run-roadmap'; goal: string }
  | { action: 'run-roadmap-execute'; phase: string }
  | { action: 'get-system-graph' }
  | { action: 'run-system-map' }
  | { action: 'run-system-check' }
  | { action: 'get-slos' }
  | { action: 'add-slo'; name: string; target: string; source?: string }
  | { action: 'run-slo-check' }
  | { action: 'get-debt' }
  | { action: 'run-debt-scan' }
  | { action: 'run-debt-fix'; itemId: string }
  | { action: 'get-forecast'; type?: string }
  | { action: 'run-forecast'; feature?: string }
  | { action: 'get-compliance'; framework?: string }
  | { action: 'run-compliance-check'; framework?: string }
  | { action: 'get-plugins' }
  | { action: 'install-plugin'; name: string }
  | { action: 'remove-plugin'; name: string }
  // Wave 5 — Observability
  | { action: 'observe-status' }
  | { action: 'observe-query'; query: string }
  | { action: 'observe-correlate'; sha: string }
  | { action: 'observe-anomalies' }
  | { action: 'observe-predict' }
  | { action: 'observe-watch-start' }
  | { action: 'observe-watch-stop' }
  // Wave 5 — Experiments
  | { action: 'experiment-create'; name: string; hypothesis: string; flag: string; primaryMetric: string; duration?: number }
  | { action: 'experiment-start'; name: string }
  | { action: 'experiment-status' }
  | { action: 'experiment-analyze'; name: string }
  | { action: 'experiment-ship'; name: string }
  | { action: 'experiment-kill'; name: string }
  | { action: 'experiment-history' }
  // Wave 5 — Self-Improvement
  | { action: 'improve-analyze'; count?: number }
  | { action: 'improve-report' }
  | { action: 'improve-apply' }
  | { action: 'improve-reset' }
  // Wave 5 — Optimize
  | { action: 'run-optimize'; goal?: string; type?: string }
  | { action: 'get-optimize-report' }
  // Wave 5 — Impact
  | { action: 'run-impact'; period?: string }
  | { action: 'run-impact-estimate'; feature: string }
  | { action: 'run-impact-roi' }
  // Wave 5 — Fleet
  | { action: 'fleet-register'; team: string }
  | { action: 'fleet-status' }
  | { action: 'fleet-budget'; team?: string; amount?: number }
  | { action: 'fleet-sync' }
  // Wave 5 — Contract
  | { action: 'contract-generate'; scope?: string }
  | { action: 'contract-check' }
  | { action: 'contract-publish'; version?: string }
  | { action: 'contract-sdk'; language?: string }
  | { action: 'get-contracts' }
  // Wave 5 — Simulate
  | { action: 'run-simulate'; scale?: string; chaos?: string }
  | { action: 'get-simulation-report' }
  // Wave 5 — Teach
  | { action: 'teach-collect' }
  | { action: 'teach-train'; model?: string }
  | { action: 'teach-evaluate' }
  | { action: 'teach-deploy' }
  | { action: 'get-teach-state' }
  // Wave 6 — Negotiate
  | { action: 'negotiate-feasibility'; request: string; deadline?: string }
  | { action: 'negotiate-status'; audience?: string }
  | { action: 'negotiate-report'; period?: string; audience?: string }
  | { action: 'get-negotiate-state' }
  // Wave 6 — Specialize
  | { action: 'specialize-list' }
  | { action: 'specialize-create'; domain: string; name?: string }
  | { action: 'specialize-route'; task: string }
  | { action: 'specialize-stats' }
  // Wave 6 — Govern
  | { action: 'govern-status' }
  | { action: 'govern-policy'; domain?: string; level?: number }
  | { action: 'govern-audit'; limit?: number }
  | { action: 'govern-trust'; domain?: string }
  | { action: 'govern-override'; decisionId: string; verdict: string }
  // Wave 6 — Empathize
  | { action: 'empathize-journey'; name: string }
  | { action: 'empathize-feedback' }
  | { action: 'empathize-impact'; feature: string }
  | { action: 'empathize-suggest' }
  // Wave 6 — Allocate
  | { action: 'allocate-plan' }
  | { action: 'allocate-scenario'; scenario: string }
  | { action: 'allocate-okrs'; goals?: string }
  // Wave 6 — Compete
  | { action: 'compete-scan' }
  | { action: 'compete-gaps' }
  | { action: 'compete-radar' }
  // Wave 6 — Spawn Capability
  | { action: 'spawn-capability'; domain: string }
  | { action: 'spawn-list' }
  | { action: 'spawn-evaluate' }
  // Wave 6 — Federate
  | { action: 'federate-opt-in' }
  | { action: 'federate-opt-out' }
  | { action: 'federate-share' }
  | { action: 'federate-benchmarks' }
  | { action: 'get-federate-state' }
  // Wave 8 — Multi-LLM model management
  | { action: 'list-models' }
  | { action: 'test-model'; model: string }
  | { action: 'get-model-config' }
  | { action: 'set-model-config'; stage: string; model: string }
  | { action: 'add-provider'; provider: string; config: Record<string, string> }
  | { action: 'list-providers' }
  | { action: 'test-provider'; provider: string }
  | { action: 'save-provider-key'; provider: string; apiKey: string }
  | { action: 'save-provider-url'; provider: string; baseUrl: string };

// Guardrail types
export interface GuardrailFix {
  type: 'insert-section' | 'insert-pattern' | 'extend-content';
  description: string;
  patch: string;
  location: 'append' | 'after-section';
  afterSection?: string;
}

export type GuardrailPreset = 'strict' | 'standard' | 'lenient' | 'off';

export interface GuardrailRule {
  name: string;
  target: string;
  checks: GuardrailCheck[];
}

export interface GuardrailCheck {
  type: 'section-exists' | 'pattern-match' | 'command' | 'min-length' | 'word-count' | 'required-patterns';
  value: string;
  message: string;
  severity?: 'error' | 'warning';
  fix?: GuardrailFix;
}

export interface GuardrailViolation {
  rule: string;
  check: string;
  file: string;
  message: string;
  severity: 'error' | 'warning';
  fix?: GuardrailFix;
}

// Custom pipeline definition types
export interface PipelineStageDefinition {
  name: string;
  persona: Persona;
  artifact?: string;
  dependsOn?: string[];
  parallel?: boolean;
  condition?: string;
  prompt?: string;
}

export interface PipelineDefinition {
  stages: PipelineStageDefinition[];
}

// Test framework configuration per stack
export type TestFrameworkKind = 'playwright' | 'vitest' | 'jest' | 'go-test' | 'pytest' | 'swift-test' | 'cargo-test';

export interface TestFrameworkConfig {
  kind: TestFrameworkKind;
  /** Human-readable name */
  name: string;
  /** Directory for test files */
  testDir: string;
  /** File extension for test files */
  testFilePattern: string;
  /** Command to install the framework */
  installCmd: string;
  /** Command to run tests with JSON output to .swarm/test-results.json */
  runCmd: string;
  /** Command to run tests normally (human-readable output) */
  runCmdHuman: string;
  /** Whether this framework tests UI (browser-based) or backend (API/unit) */
  category: 'e2e' | 'unit' | 'integration' | 'api';
}

// .swarm/config.yaml shape
export interface PlaywrightConfig {
  baseUrl?: string;
  authStorageState?: string;
  globalSetupScript?: string;
  testDir?: string;
}

export interface SwarmConfig {
  projectName: string;
  stack: TechStack;
  model: string;
  /** Per-persona model overrides. E.g., { analyst: 'haiku', architect: 'sonnet', engineer: 'opus' } */
  models?: Partial<Record<Persona, string>>;
  maxBudgetUsd: number | null;
  promptsDir: string;
  wsPort: number;
  dashboardPort: number;
  permissions: {
    allowedTools?: string[];
    disallowedTools?: string[];
    permissionMode?: string;
  };
  playwright?: PlaywrightConfig;
  /** Path to custom pipeline YAML (relative to .swarm/ or absolute). Defaults to .swarm/pipeline.yaml */
  customPipeline?: string;
  /** Active pipeline namespace (for multi-pipeline support). Default: 'default' */
  activePipeline?: string;
  /** Additional repos for multi-repo mode. Each entry maps a label to an absolute path. */
  repos?: Record<string, string>;
  /** Monorepo package paths to scope agent work (e.g., ["packages/api", "packages/web"]) */
  packages?: string[];
  /** Plugin package names or local paths for custom stages/personas */
  plugins?: string[];
  /** Enable LLM-powered quality gate (uses haiku to evaluate artifacts). Cost: ~$0.01/artifact */
  llmQualityGate?: boolean;
  /** Minimum quality score (0-100) to pass LLM quality gate. Default: 60 */
  llmQualityThreshold?: number;
  /** Webhook configurations for event notifications */
  webhooks?: Array<{
    url: string;
    events?: string[];
    secret?: string;
    format?: 'slack' | 'discord' | 'generic';
  }>;
  /** Multi-LLM provider configurations (Wave 8) */
  providers?: Record<string, import('./core/providers/types.js').ProviderConfig>;
  /** Custom model aliases, e.g. { 'fast': 'openai/gpt-4o-mini' } */
  aliases?: Record<string, string>;
  /** Custom model registry entries for models not auto-discovered */
  modelRegistry?: Record<string, {
    provider: string;
    modelId: string;
    contextWindow?: number;
    supportsTools?: boolean;
    supportsStreaming?: boolean;
    costPer1kInput?: number;
    costPer1kOutput?: number;
  }>;
}

export const DEFAULT_CONFIG: SwarmConfig = {
  projectName: 'my-project',
  stack: 'react',
  model: 'sonnet',
  maxBudgetUsd: 5,
  promptsDir: 'bundled',
  wsPort: 3847,
  dashboardPort: 3848,
  permissions: {
    permissionMode: 'default',
  },
};

// Claude CLI stream-json message types
// Actual format from `claude -p --output-format stream-json --verbose`:
//   {"type":"system","subtype":"init", ...}
//   {"type":"assistant","message":{"content":[{"type":"text","text":"..."}], ...}}
//   {"type":"result","result":"...", "total_cost_usd":0.03, "usage":{...}}
export interface ClaudeStreamMessage {
  type: string;
  subtype?: string;
  // result message fields
  result?: string;
  total_cost_usd?: number;
  duration_ms?: number;
  duration_api_ms?: number;
  session_id?: string;
  usage?: {
    input_tokens: number;
    output_tokens: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  };
  is_error?: boolean;
  // assistant message wrapper (actual Claude CLI format)
  message?: {
    content?: Array<{
      type: string;
      text?: string;
      // tool_use fields
      id?: string;
      name?: string;
      input?: Record<string, unknown>;
    }>;
    role?: string;
    stop_reason?: string | null;
  };
  // tool_result top-level message
  content?: string | Array<{ type: string; text?: string }>;
  tool_use_id?: string;
}

// Autopilot types
export interface AutopilotIssue {
  number: number;
  title: string;
  body: string;
  labels: string[];
  author: string;
  url: string;
  updatedAt: string;
  status: 'pending' | 'running' | 'done' | 'failed';
  prUrl?: string;
  cost?: number;
  duration?: number;
  error?: string;
  startedAt?: number;
  completedAt?: number;
}

export interface AutopilotState {
  running: boolean;
  label: string;
  pollInterval: number;
  maxConcurrent: number;
  budgetPerIssue: number;
  processedIssues: AutopilotIssue[];
  queue: AutopilotIssue[];
  stats: {
    totalProcessed: number;
    successful: number;
    failed: number;
    totalCost: number;
  };
}

// Wave 3 — Inbox types
export interface WorkItem {
  id: string;
  source: 'github-issue' | 'github-pr' | 'ci-failure' | 'stale-pr' | 'slack' | 'scheduled' | 'manual';
  title: string;
  body: string;
  url?: string;
  labels: string[];
  author?: string;
  createdAt: string;
  priority: number;
  type: 'bug-fix' | 'feature' | 'maintenance' | 'incident' | 'review';
  status: 'queued' | 'triaging' | 'running' | 'done' | 'failed' | 'skipped' | 'needs-human';
  confidence: number;
  estimatedCost: number;
  estimatedMinutes: number;
  result?: { prUrl?: string; cost?: number; duration?: number; error?: string };
  startedAt?: number;
  completedAt?: number;
}

export interface InboxState {
  running: boolean;
  paused: boolean;
  label: string;
  pollInterval: number;
  maxConcurrent: number;
  queue: WorkItem[];
  processed: WorkItem[];
  stats: {
    totalProcessed: number;
    successful: number;
    failed: number;
    skipped: number;
    totalCost: number;
    dailyBudget: number;
    dailySpent: number;
  };
  workHours?: { start: string; end: string; timezone: string };
}

// Wave 3 — Standup types
export interface StandupReport {
  date: string;
  completed: Array<{ summary: string; type: string; cost: number; prUrl?: string }>;
  impact: { prsCreated: number; prsMerged: number; issuesClosed: number; testsGenerated: number; linesGenerated: number };
  cost: { total: number; byType: Array<{ type: string; cost: number }> };
  blockers: Array<{ summary: string; reason: string }>;
  upcoming: Array<{ title: string; estimatedCost: number }>;
  velocity: { thisWeek: number; lastWeek: number; trend: 'up' | 'down' | 'stable' };
}

// Wave 3 — Decision Journal types
export interface JournalData {
  decisions: Array<{ id: string; timestamp: number; type: string; context: string; decision: string; reasoning: string; confidence: number; outcome?: string; outcomeDetail?: string }>;
  rules: Array<{ id: string; rule: string; enabled: boolean; appliesTo: string[] }>;
  calibration?: { totalDecisions: number; accuracyByType: Array<{ type: string; accuracy: number; total: number }>; recommendations: string[] };
}

// Wave 3 — Scope types
export interface ScopeAnalysis {
  request: string;
  vaguenessScore: number;
  classification: string;
  riskFactors: string[];
  missingContext: string[];
  questions: string[];
  options: Array<{ name: string; description: string; estimatedCost: number; estimatedTime: string; risk: string; tradeoffs: string[]; recommended: boolean }>;
}

// Wave 3 — Context Index types
export interface ContextIndex {
  totalFiles: number;
  totalSymbols: number;
  modules: Array<{ path: string; purpose: string; fileCount: number }>;
  fragileFiles: Array<{ path: string; failureRate: number; reason: string }>;
  coChangePatterns: Array<{ fileA: string; fileB: string; frequency: number }>;
  builtAt: number;
  queryResult?: string;
}

// Wave 3 — Pair Session types
export interface PairSessionState {
  id: string;
  startedAt: number;
  mode: string;
  focusDir?: string;
  filesWatched: number;
  suggestions: Array<{ id: string; type: string; file: string; line?: number; message: string; severity: string; timestamp: number; accepted?: boolean }>;
  changedFiles: string[];
}

// Wave 3 — Delegate types
export interface DelegateState {
  featureRequest: string;
  workstreams: Array<{ id: string; name: string; tasks: string[]; branch: string; status: string; cost: number; startedAt?: number; completedAt?: number; error?: string; prUrl?: string; dependsOn: string[] }>;
  totalBudget: number;
  totalCost: number;
  status: string;
  startedAt: number;
}

// Wave 3 — Report types
export interface ReportData {
  period: { start: string; end: string; label: string };
  output: { issuesResolved: number; prsCreated: number; prsMerged: number; linesGenerated: number; testsGenerated: number };
  quality: { mergeRate: number; revertRate: number; fixLoopSuccessRate: number };
  cost: { total: number; byCommand: Array<{ command: string; cost: number }>; perIssue: number; perPr: number };
  roi: { estimatedHoursSaved: number; estimatedValueSaved: number; roiMultiple: number };
  trends: { velocity: Array<{ period: string; items: number }>; costEfficiency: Array<{ period: string; costPerItem: number }> };
}

// Wave 3 — Team types
export interface TeamActivity {
  members: Array<{ github: string; areas: string[]; activeBranches: string[]; recentPrs: Array<{ number: number; title: string; state: string }> }>;
  swarmActivity: Array<{ task: string; status: string; startedAt: number; cost: number }>;
  conflicts: Array<{ file: string; humanDeveloper: string; swarmTask: string }>;
}

// Wave 3 — Retro types
export interface RetroReport {
  period: { start: string; end: string };
  wentWell: Array<{ summary: string; evidence: string }>;
  wentPoorly: Array<{ summary: string; evidence: string; impact: string }>;
  actionItems: Array<{ description: string; configChange?: { key: string; oldValue: unknown; newValue: unknown }; priority: string }>;
  metrics: { totalRuns: number; successRate: number; avgCost: number; revertRate: number; fixIterationAvg: number };
}

// Wave 4 — Surface Ownership types
export interface SurfaceDefinition {
  name: string;
  description: string;
  paths: string[];
  slos: Record<string, string>;
  monitoring?: Record<string, string>;
  owners?: { human: string[]; swarm: boolean };
  budget?: { monthly: number };
}

export interface SurfaceStatus {
  name: string;
  description: string;
  paths: string[];
  slos: Array<{ name: string; target: string; current: string; status: 'ok' | 'warning' | 'breach' }>;
  healthScore: number;
  lastChecked: number;
  maintenanceHistory: Array<{ action: string; timestamp: number; cost: number }>;
  budgetUsed: number;
  budgetTotal: number;
}

export interface SurfacesState {
  surfaces: SurfaceStatus[];
  totalBudget: number;
  totalSpent: number;
}

// Wave 4 — Architecture Review types
export interface ArchReviewData {
  summary: string;
  issues: Array<{
    id: string;
    title: string;
    severity: 'critical' | 'high' | 'medium' | 'low';
    category: string;
    evidence: string;
    impact: string;
    solutions: Array<{ name: string; description: string; effort: string; risk: string; recommended: boolean }>;
  }>;
  couplingScore: number;
  complexityScore: number;
  trends: Array<{ metric: string; direction: 'improving' | 'degrading' | 'stable'; detail: string }>;
  actionPlan: Array<{ priority: number; action: string; effort: string; impact: string }>;
  timestamp: number;
}

// Wave 4 — Onboarding & Mentoring types
export interface OnboardData {
  step: number;
  totalSteps: number;
  currentTopic: string;
  content: string;
  completed: string[];
  remaining: string[];
  mentorHistory: Array<{ question: string; answer: string; timestamp: number }>;
}

// Wave 4 — Roadmap types
export interface RoadmapData {
  goal: string;
  phases: Array<{
    id: string;
    name: string;
    description: string;
    status: 'pending' | 'in-progress' | 'done' | 'blocked';
    progress: number;
    estimatedWeeks: number;
    actualWeeks?: number;
    dependencies: string[];
    riskLevel: 'low' | 'medium' | 'high';
    rollbackStrategy: string;
    successMetrics: string[];
  }>;
  criticalPath: string[];
  estimatedTotalWeeks: number;
  estimatedTotalCost: number;
  startedAt?: number;
  status: 'planning' | 'executing' | 'complete' | 'paused';
}

// Wave 4 — System Graph types
export interface SystemGraphData {
  services: Array<{
    name: string;
    repo: string;
    type: string;
    apis: Array<{ path: string; method: string; description: string }>;
    dependencies: string[];
    healthStatus: 'healthy' | 'degraded' | 'unknown';
  }>;
  contracts: Array<{ provider: string; consumer: string; type: string; version: string; status: 'compatible' | 'breaking' | 'unknown' }>;
  crossRepoPrs: Array<{ repo: string; prNumber: number; title: string; status: string }>;
}

// Wave 4 — SLO types
export interface SloData {
  slos: Array<{
    id: string;
    name: string;
    target: string;
    current: string;
    status: 'ok' | 'warning' | 'breach';
    trend: 'improving' | 'degrading' | 'stable';
    errorBudget: { total: number; remaining: number; burnRate: number };
    source: string;
    lastChecked: number;
  }>;
  alerts: Array<{ sloId: string; message: string; severity: string; timestamp: number }>;
}

// Wave 4 — Tech Debt types
export interface DebtData {
  score: number;
  trend: 'improving' | 'degrading' | 'stable';
  items: Array<{
    id: string;
    type: 'code-quality' | 'architecture' | 'dependency' | 'test' | 'documentation';
    severity: number;
    file: string;
    description: string;
    estimatedEffort: string;
    autoFixable: boolean;
    age: number;
  }>;
  burndown: Array<{ date: string; score: number }>;
  byType: Array<{ type: string; count: number; totalSeverity: number }>;
}

// Wave 4 — Forecast types
export interface ForecastData {
  velocity: { current: number; predicted: number; confidence: number; history: Array<{ week: string; items: number }> };
  costEstimates: Array<{ feature: string; estimatedCost: number; confidence: number; basis: string }>;
  risks: Array<{ name: string; probability: number; impact: string; mitigation: string }>;
  healthProjection: Array<{ metric: string; current: number; projected: number; timeframe: string; warning?: string }>;
}

// Wave 4 — Compliance types
export interface ComplianceData {
  framework: string;
  overallScore: number;
  checks: Array<{
    id: string;
    requirement: string;
    category: string;
    status: 'pass' | 'fail' | 'partial' | 'not-applicable';
    evidence?: string;
    remediation?: string;
  }>;
  gaps: Array<{ requirement: string; severity: string; remediation: string }>;
  lastAudit: number;
}

// Wave 4 — Platform/Plugin types
export interface PluginRegistryData {
  installed: Array<{ name: string; type: string; version: string; enabled: boolean; description: string }>;
  available: Array<{ name: string; type: string; version: string; description: string; downloads: number }>;
}

// Wave 5 — Observability types
export interface ObservabilitySource {
  type: 'grafana' | 'datadog' | 'cloudwatch' | 'prometheus' | 'opentelemetry' | 'custom';
  url: string;
  apiKeyEnv?: string;
  metrics: string[];
  dashboards?: Array<{ uid: string; metrics: string[] }>;
}

export interface ObservabilityConfig {
  sources: Record<string, ObservabilitySource>;
  alerting: {
    sigma: number;
    cooldown: number;
    channels: Array<{ type: string; url: string }>;
  };
}

export interface MetricDataPoint {
  name: string;
  value: number;
  timestamp: number;
  source: string;
  tags?: Record<string, string>;
}

export interface DeployMarker {
  sha: string;
  timestamp: number;
  author: string;
  message: string;
  filesChanged: string[];
}

export interface AnomalyAlert {
  id: string;
  metric: string;
  type: 'spike' | 'drop' | 'trend' | 'correlation';
  severity: 'info' | 'warning' | 'critical';
  value: number;
  baseline: number;
  deviation: number;
  deployCorrelation?: { sha: string; confidence: number; filesChanged: string[] };
  timestamp: number;
  resolved: boolean;
}

export interface PredictiveAlert {
  metric: string;
  type: 'capacity' | 'trend' | 'pattern';
  message: string;
  predictedAt: number;
  confidence: number;
  timeToImpact: string;
}

export interface ObserveState {
  sources: Array<{ name: string; type: string; status: 'connected' | 'error' | 'pending'; metricCount: number; lastSync: number }>;
  anomalies: AnomalyAlert[];
  predictions: PredictiveAlert[];
  deployMarkers: DeployMarker[];
  metricCount: number;
  lastUpdated: number;
}

// Wave 5 — Experiment types
export interface ExperimentDefinition {
  name: string;
  hypothesis: string;
  flag: string;
  metrics: {
    primary: string;
    secondary: string[];
    guardrail: string[];
  };
  targeting: {
    percentage: number;
    rampSchedule: number[];
  };
  duration: number;
  minSampleSize: number;
  significanceLevel: number;
}

export interface ExperimentResult {
  metric: string;
  control: { mean: number; stddev: number; sampleSize: number };
  treatment: { mean: number; stddev: number; sampleSize: number };
  pValue: number;
  significant: boolean;
  liftPercent: number;
}

export interface ExperimentState {
  experiments: Array<{
    id: string;
    name: string;
    hypothesis: string;
    flag: string;
    status: 'draft' | 'running' | 'analyzing' | 'shipped' | 'killed';
    currentPercentage: number;
    rampSchedule: number[];
    startedAt?: number;
    endedAt?: number;
    duration: number;
    results: ExperimentResult[];
    guardrailStatus: 'ok' | 'warning' | 'breached';
    recommendation?: 'ship' | 'kill' | 'extend' | 'ramp';
    sampleSize: number;
  }>;
  flagProvider: string;
  totalExperiments: number;
  activeCount: number;
}

// Wave 5 — Self-Improvement types
export interface PerformanceRecord {
  runId: string;
  timestamp: number;
  taskType: string;
  predictedCost: number;
  actualCost: number;
  predictedDuration: number;
  actualDuration: number;
  testPassFirstAttempt: boolean;
  fixIterations: number;
  humanEditRate: number;
  reverted: boolean;
  postMergeIncident: boolean;
  model: string;
  strategy: string;
}

export interface StrategyAnalysis {
  strategy: string;
  taskType: string;
  successRate: number;
  avgCost: number;
  avgDuration: number;
  sampleSize: number;
  recommendation: string;
}

export interface SelfImprovementData {
  records: PerformanceRecord[];
  strategies: StrategyAnalysis[];
  tuning: {
    modelOverrides: Record<string, string>;
    strategyOverrides: Record<string, string>;
    promptVariants: Array<{ persona: string; variant: string; effectivenessScore: number }>;
  };
  report?: {
    period: string;
    accuracyTrend: Array<{ metric: string; current: number; previous: number; change: number }>;
    qualityTrend: Array<{ metric: string; current: number; previous: number; change: number }>;
    efficiencyTrend: Array<{ metric: string; current: number; previous: number; change: number }>;
    recommendations: string[];
    generatedAt: number;
  };
}

// Wave 5 — Optimize types
export interface HotPath {
  function: string;
  file: string;
  line: number;
  cpuPercent: number;
  memoryMb?: number;
  callCount: number;
}

export interface QueryIssue {
  query: string;
  file: string;
  line: number;
  type: 'n-plus-one' | 'missing-index' | 'full-scan' | 'slow';
  estimatedImpactMs: number;
  suggestion: string;
}

export interface OptimizeReport {
  type: 'profile' | 'bundle' | 'queries' | 'memory' | 'goal';
  hotPaths: HotPath[];
  queryIssues: QueryIssue[];
  bundleSize?: { totalBytes: number; largestModules: Array<{ name: string; bytes: number }> };
  memoryLeaks?: Array<{ location: string; growthRateMbPerHour: number; description: string }>;
  improvements: Array<{ description: string; beforeMetric: string; afterMetric: string; improvementPercent: number }>;
  recommendations: string[];
  timestamp: number;
}

// Wave 5 — Business Impact types
export interface ImpactMetric {
  name: string;
  source: string;
  before: number;
  after: number;
  changePercent: number;
  monetaryValue?: number;
  confidence: number;
}

export interface ImpactReport {
  period: string;
  features: Array<{ name: string; prUrl?: string; metrics: ImpactMetric[]; totalValue: number; cost: number }>;
  roi: { swarmCost: number; estimatedValue: number; multiple: number };
  highlights: string[];
  timestamp: number;
}

// Wave 5 — Fleet types
export interface FleetInstance {
  id: string;
  team: string;
  repo: string;
  status: 'active' | 'idle' | 'offline';
  version: string;
  lastHeartbeat: number;
  stats: { totalRuns: number; successRate: number; totalCost: number };
}

export interface FleetState {
  instances: FleetInstance[];
  budget: { total: number; allocated: Record<string, number>; spent: Record<string, number> };
  knowledgeItems: number;
  crossTeamAlerts: Array<{ from: string; to: string[]; type: string; message: string; timestamp: number }>;
  lastSync: number;
}

// Wave 5 — API Contract types
export interface ApiEndpoint {
  path: string;
  method: string;
  version: string;
  requestSchema?: string;
  responseSchema?: string;
  consumers: string[];
}

export interface BreakingChange {
  endpoint: string;
  type: 'removed' | 'type-change' | 'required-field' | 'response-change';
  description: string;
  affectedConsumers: string[];
  severity: 'breaking' | 'deprecation' | 'compatible';
}

export interface ContractData {
  endpoints: ApiEndpoint[];
  breakingChanges: BreakingChange[];
  versions: Array<{ version: string; endpoints: number; publishedAt: number }>;
  consumers: Array<{ name: string; endpoints: string[]; sdkVersion?: string }>;
  lastGenerated: number;
}

// Wave 5 — Simulation types
export interface SimulationScenario {
  name: string;
  type: 'traffic-replay' | 'scale' | 'chaos';
  config: Record<string, unknown>;
}

export interface SimulationResult {
  scenario: string;
  passed: boolean;
  metrics: Array<{ name: string; value: number; threshold: number; status: 'pass' | 'fail' | 'warn' }>;
  issues: Array<{ severity: string; description: string; location?: string }>;
  duration: number;
}

export interface SimulationReport {
  scenarios: SimulationResult[];
  overallPass: boolean;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  recommendations: string[];
  timestamp: number;
}

// Wave 5 — Teach / Fine-Tuning types
export interface TrainingExample {
  id: string;
  taskType: string;
  input: string;
  output: string;
  quality: number;
  source: 'approved-pr' | 'human-edited' | 'high-quality';
  collectedAt: number;
}

export interface TeachState {
  examples: number;
  byTaskType: Record<string, number>;
  trainingJobs: Array<{ id: string; model: string; status: 'pending' | 'training' | 'complete' | 'failed'; startedAt: number; completedAt?: number; metrics?: { loss: number; accuracy: number } }>;
  deployedModels: Array<{ id: string; taskTypes: string[]; costReduction: number; qualityDelta: number; deployedAt: number }>;
  lastCollected: number;
}

// Wave 6 — Negotiate / Stakeholder types
export interface ScopeOption {
  name: string;
  description: string;
  timeline: string;
  cost: number;
  coverage: number;
  deferred: string[];
  risk: string;
  recommended: boolean;
}

export interface NegotiateState {
  negotiations: Array<{
    id: string;
    request: string;
    feasible: boolean;
    options: ScopeOption[];
    selectedOption?: string;
    audience: 'engineer' | 'pm' | 'executive' | 'customer';
    status: 'analyzing' | 'proposed' | 'accepted' | 'rejected';
    createdAt: number;
  }>;
  reports: Array<{ id: string; period: string; audience: string; content: string; generatedAt: number }>;
  channels: Array<{ type: 'slack' | 'email' | 'github' | 'linear'; configured: boolean; lastUsed?: number }>;
}

// Wave 6 — Specialize / Sub-Swarm types
export interface SpecialistAgent {
  id: string;
  domain: 'security' | 'performance' | 'database' | 'frontend' | 'infrastructure' | 'testing' | 'custom';
  name: string;
  expertiseScore: number;
  tasksCompleted: number;
  successRate: number;
  memoryItems: number;
  status: 'active' | 'idle' | 'disabled';
  createdAt: number;
  lastUsed: number;
}

export interface SpecializeState {
  specialists: SpecialistAgent[];
  routingHistory: Array<{ taskDescription: string; routed: string; confidence: number; outcome?: 'success' | 'failure'; timestamp: number }>;
  collaborations: Array<{ from: string; to: string; type: string; timestamp: number }>;
}

// Wave 6 — Govern / Decision Governance types
export type GovernanceLevel = 1 | 2 | 3 | 4 | 5;

export interface GovernancePolicy {
  domain: string;
  level: GovernanceLevel;
  trustScore: number;
  autoPromoteThreshold: number;
  autoDemoteOnRevert: boolean;
}

export interface GovernanceDecision {
  id: string;
  action: string;
  domain: string;
  level: GovernanceLevel;
  confidence: number;
  reasoning: string;
  alternatives: string[];
  status: 'auto-approved' | 'pending' | 'approved' | 'rejected' | 'overridden';
  outcome?: 'success' | 'failure' | 'reverted';
  timestamp: number;
  resolvedAt?: number;
  resolvedBy?: string;
}

export interface GovernState {
  policies: GovernancePolicy[];
  decisions: GovernanceDecision[];
  trustScores: Record<string, number>;
  overrides: number;
  totalDecisions: number;
  autonomousRate: number;
  budgetAllocation: Record<string, { allocated: number; spent: number }>;
}

// Wave 6 — Empathize / User Intelligence types
export interface UserJourney {
  id: string;
  name: string;
  touchpoints: Array<{
    stage: string;
    timestamp: number;
    status: 'completed' | 'failed' | 'in-progress';
    durationMs: number;
    sentiment: 'positive' | 'negative' | 'neutral';
  }>;
  satisfaction: number;
  painPoints: string[];
  dropOffPoints: string[];
  analyzedAt: number;
}

export interface FeedbackTheme {
  id: string;
  theme: string;
  occurrences: number;
  sentiment: 'positive' | 'negative' | 'neutral';
  sources: string[];
  firstSeen: number;
  lastSeen: number;
  impact: 'high' | 'medium' | 'low';
}

export interface EmpathizeState {
  journeys: UserJourney[];
  themes: FeedbackTheme[];
  improvements: string[];
  lastAnalyzed: number;
}

// Wave 6 — Allocate / Resource Allocation types
export interface AllocationRecommendation {
  id: string;
  generatedAt: number;
  compositeScore: number;
  scores: {
    businessImpact: number;
    techRisk: number;
    userImpact: number;
  };
  allocations: Array<{
    category: string;
    percentage: number;
    rationale: string;
  }>;
  insights: string[];
  totalBudgetContext: {
    historicalCost: number;
    runsAnalyzed: number;
  };
}

export interface WhatIfScenario {
  id: string;
  description: string;
  type: 'increase-features' | 'increase-reliability' | 'reduce-budget' | 'scale-up' | 'custom';
  adjustments: Array<{
    category: string;
    currentPct: number;
    proposedPct: number;
  }>;
  predictedOutcome: {
    velocityChange: string;
    riskChange: string;
    costChange: string;
    recommendation: string;
  };
  runAt: number;
  confidence: number;
}

export interface AllocateState {
  currentPlan: AllocationRecommendation | null;
  scenarios: WhatIfScenario[];
  okrs: Array<{
    objective: string;
    keyResults: Array<{ metric: string; current: number; target: number; unit: string }>;
    category: string;
    confidence: number;
  }>;
  lastGenerated: number;
}

// Wave 6 — Compete / Competitive Intel types
export interface CompetitorInfo {
  name: string;
  repo?: string;
  stars?: number;
  lastRelease?: string;
  recentFeatures: string[];
  trend: 'growing' | 'stable' | 'declining';
}

export interface TechRadarEntry {
  name: string;
  category: 'language' | 'framework' | 'tool' | 'platform';
  ring: 'adopt' | 'trial' | 'assess' | 'hold';
  relevance: string;
}

export interface CompeteState {
  competitors: CompetitorInfo[];
  featureGaps: Array<{ feature: string; competitor: string; priority: string; effort: string }>;
  radar: TechRadarEntry[];
  lastScanned: number;
}

// Wave 6 — Spawn / Capability Acquisition types
export interface AcquiredCapability {
  id: string;
  name: string;
  type: 'mcp-tool' | 'custom-persona' | 'plugin';
  source: string;
  effectiveness: number;
  tasksUsed: number;
  status: 'testing' | 'active' | 'disabled' | 'discarded';
  acquiredAt: number;
}

export interface SpawnState {
  capabilities: AcquiredCapability[];
  gaps: Array<{ domain: string; failureCount: number; lastFailed: number; attemptedAcquisitions: number }>;
  evaluations: Array<{ capabilityId: string; tasksRun: number; successRate: number; verdict: string }>;
}

// Wave 6 — Federate / Cross-Org Learning types
export interface SharedPattern {
  id: string;
  type: 'strategy' | 'guardrail' | 'prompt' | 'pipeline-config';
  description: string;
  stack: string;
  effectiveness: number;
  adoptions: number;
  sharedAt: number;
}

export interface FederateState {
  optedIn: boolean;
  sharedPatterns: SharedPattern[];
  receivedPatterns: SharedPattern[];
  benchmarks: Array<{ metric: string; myValue: number; communityAvg: number; percentile: number }>;
  lastSync: number;
}

// Persona → stage mapping
export const PERSONA_STAGE_MAP: Record<Persona, StageName> = {
  analyst: 'analyze',
  architect: 'architect',
  lead: 'plan',
  engineer: 'build',
  tester: 'test',
};

// Stage → expected artifact
export const STAGE_ARTIFACT_MAP: Record<StageName, string | null> = {
  analyze: 'REQUIREMENTS.md',
  architect: 'SPEC.md',
  plan: 'TASKS.md',
  build: null,
  test: 'TESTPLAN.md',
  evaluate: null,
};
