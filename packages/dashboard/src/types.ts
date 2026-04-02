export type AgentStatus = 'pending' | 'running' | 'done' | 'error' | 'killed';
export type PermissionMode = 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan' | 'auto';
export type Persona = 'analyst' | 'architect' | 'lead' | 'engineer' | 'tester';
export type TechStack = 'react' | 'node' | 'go' | 'python' | 'rust' | 'swift' | 'custom';
export type StageName = 'analyze' | 'architect' | 'plan' | 'build' | 'test' | 'evaluate';

export interface CostInfo {
  totalUsd: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  durationMs: number;
}

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
  /** Tool restrictions */
  allowedTools?: string[];
  disallowedTools?: string[];
  /** System enforcement prompt */
  appendSystemPrompt?: string;
}

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
  /** Cost of this stage */
  stageCost?: number;
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

export interface StageBreakdown {
  name: string;
  cost: number;
  durationMs: number;
  model?: string;
  status: 'done' | 'error' | 'skipped' | 'pending';
}

export interface HistoryEntry {
  runId: string;
  timestamp: number;
  projectName: string;
  stack: TechStack;
  totalCost: CostInfo;
  stagesSummary: Record<StageName, 'done' | 'error' | 'skipped' | 'pending'>;
  featureRequest?: string;
  durationMs: number;
  stageBreakdowns?: StageBreakdown[];
  fixIterations?: number;
  model?: string;
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

export interface GuardrailViolation {
  rule: string;
  check: string;
  file: string;
  message: string;
  severity: 'error' | 'warning';
}

// Agent activity — tool use, file operations, thinking, etc.
export type ActivityKind = 'tool_use' | 'tool_result' | 'thinking' | 'text';

export interface AgentActivity {
  id: string;
  agentId: string;
  kind: ActivityKind;
  tool?: string;
  summary: string;
  content?: string;
  timestamp: number;
}

export interface PipelineInfo {
  namespace: string;
  projectName: string;
  currentStage: string;
  status: 'running' | 'complete' | 'error' | 'idle';
  updatedAt: number;
  totalCost: CostInfo;
  worktreePath?: string;
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
}

export interface StandupReport {
  date: string;
  completed: Array<{ summary: string; type: string; cost: number; prUrl?: string }>;
  impact: { prsCreated: number; prsMerged: number; issuesClosed: number; testsGenerated: number; linesGenerated: number };
  cost: { total: number; byType: Array<{ type: string; cost: number }> };
  blockers: Array<{ summary: string; reason: string }>;
  upcoming: Array<{ title: string; estimatedCost: number }>;
  velocity: { thisWeek: number; lastWeek: number; trend: 'up' | 'down' | 'stable' };
}

export interface JournalData {
  decisions: Array<{ id: string; timestamp: number; type: string; context: string; decision: string; reasoning: string; confidence: number; outcome?: string; outcomeDetail?: string }>;
  rules: Array<{ id: string; rule: string; enabled: boolean; appliesTo: string[] }>;
  calibration?: { totalDecisions: number; accuracyByType: Array<{ type: string; accuracy: number; total: number }>; recommendations: string[] };
}

export interface ScopeAnalysis {
  request: string;
  vaguenessScore: number;
  classification: string;
  riskFactors: string[];
  missingContext: string[];
  questions: string[];
  options: Array<{ name: string; description: string; estimatedCost: number; estimatedTime: string; risk: string; tradeoffs: string[]; recommended: boolean }>;
}

export interface ContextIndex {
  totalFiles: number;
  totalSymbols: number;
  modules: Array<{ path: string; purpose: string; fileCount: number }>;
  fragileFiles: Array<{ path: string; failureRate: number; reason: string }>;
  coChangePatterns: Array<{ fileA: string; fileB: string; frequency: number }>;
  builtAt: number;
  queryResult?: string;
}

export interface PairSessionState {
  id: string;
  startedAt: number;
  mode: string;
  focusDir?: string;
  filesWatched: number;
  suggestions: Array<{ id: string; type: string; file: string; line?: number; message: string; severity: string; timestamp: number; accepted?: boolean }>;
  changedFiles: string[];
}

export interface DelegateState {
  featureRequest: string;
  workstreams: Array<{ id: string; name: string; tasks: string[]; branch: string; status: string; cost: number; startedAt?: number; completedAt?: number; error?: string; prUrl?: string; dependsOn: string[] }>;
  totalBudget: number;
  totalCost: number;
  status: string;
  startedAt: number;
}

export interface ReportData {
  period: { start: string; end: string; label: string };
  output: { issuesResolved: number; prsCreated: number; prsMerged: number; linesGenerated: number; testsGenerated: number };
  quality: { mergeRate: number; revertRate: number; fixLoopSuccessRate: number };
  cost: { total: number; byCommand: Array<{ command: string; cost: number }>; perIssue: number; perPr: number };
  roi: { estimatedHoursSaved: number; estimatedValueSaved: number; roiMultiple: number };
  trends: { velocity: Array<{ period: string; items: number }>; costEfficiency: Array<{ period: string; costPerItem: number }> };
}

export interface TeamActivity {
  members: Array<{ github: string; areas: string[]; activeBranches: string[]; recentPrs: Array<{ number: number; title: string; state: string }> }>;
  swarmActivity: Array<{ task: string; status: string; startedAt: number; cost: number }>;
  conflicts: Array<{ file: string; humanDeveloper: string; swarmTask: string }>;
}

export interface RetroReport {
  period: { start: string; end: string };
  wentWell: Array<{ summary: string; evidence: string }>;
  wentPoorly: Array<{ summary: string; evidence: string; impact: string }>;
  actionItems: Array<{ description: string; configChange?: { key: string; oldValue: unknown; newValue: unknown }; priority: string }>;
  metrics: { totalRuns: number; successRate: number; avgCost: number; revertRate: number; fixIterationAvg: number };
}

// Wave 4 types
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

export interface OnboardData {
  step: number;
  totalSteps: number;
  currentTopic: string;
  content: string;
  completed: string[];
  remaining: string[];
  mentorHistory: Array<{ question: string; answer: string; timestamp: number }>;
}

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

export interface ForecastData {
  velocity: { current: number; predicted: number; confidence: number; history: Array<{ week: string; items: number }> };
  costEstimates: Array<{ feature: string; estimatedCost: number; confidence: number; basis: string }>;
  risks: Array<{ name: string; probability: number; impact: string; mitigation: string }>;
  healthProjection: Array<{ metric: string; current: number; projected: number; timeframe: string; warning?: string }>;
}

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

export interface PluginRegistryData {
  installed: Array<{ name: string; type: string; version: string; enabled: boolean; description: string }>;
  available: Array<{ name: string; type: string; version: string; description: string; downloads: number }>;
}

// Wave 5 — Observability types
export interface ObserveState {
  sources: Array<{ name: string; type: string; status: 'connected' | 'error' | 'pending'; metricCount: number; lastSync: number }>;
  anomalies: Array<{ id: string; metric: string; type: string; severity: string; value: number; baseline: number; deviation: number; deployCorrelation?: { sha: string; confidence: number; filesChanged: string[] }; timestamp: number; resolved: boolean }>;
  predictions: Array<{ metric: string; type: string; message: string; predictedAt: number; confidence: number; timeToImpact: string }>;
  deployMarkers: Array<{ sha: string; timestamp: number; author: string; message: string; filesChanged: string[] }>;
  metricCount: number;
  lastUpdated: number;
}

// Wave 5 — Experiment types
export interface ExperimentState {
  experiments: Array<{
    id: string; name: string; hypothesis: string; flag: string;
    status: 'draft' | 'running' | 'analyzing' | 'shipped' | 'killed';
    currentPercentage: number; rampSchedule: number[];
    startedAt?: number; endedAt?: number; duration: number;
    results: Array<{ metric: string; control: { mean: number; stddev: number; sampleSize: number }; treatment: { mean: number; stddev: number; sampleSize: number }; pValue: number; significant: boolean; liftPercent: number }>;
    guardrailStatus: 'ok' | 'warning' | 'breached';
    recommendation?: 'ship' | 'kill' | 'extend' | 'ramp';
    sampleSize: number;
  }>;
  flagProvider: string;
  totalExperiments: number;
  activeCount: number;
}

// Wave 5 — Self-Improvement types
export interface SelfImprovementData {
  records: Array<{ runId: string; timestamp: number; taskType: string; predictedCost: number; actualCost: number; predictedDuration: number; actualDuration: number; testPassFirstAttempt: boolean; fixIterations: number; humanEditRate: number; reverted: boolean; postMergeIncident: boolean; model: string; strategy: string }>;
  strategies: Array<{ strategy: string; taskType: string; successRate: number; avgCost: number; avgDuration: number; sampleSize: number; recommendation: string }>;
  tuning: { modelOverrides: Record<string, string>; strategyOverrides: Record<string, string>; promptVariants: Array<{ persona: string; variant: string; effectivenessScore: number }> };
  report?: { period: string; accuracyTrend: Array<{ metric: string; current: number; previous: number; change: number }>; qualityTrend: Array<{ metric: string; current: number; previous: number; change: number }>; efficiencyTrend: Array<{ metric: string; current: number; previous: number; change: number }>; recommendations: string[]; generatedAt: number };
}

// Wave 5 — Optimize types
export interface OptimizeReport {
  type: string;
  hotPaths: Array<{ function: string; file: string; line: number; cpuPercent: number; memoryMb?: number; callCount: number }>;
  queryIssues: Array<{ query: string; file: string; line: number; type: string; estimatedImpactMs: number; suggestion: string }>;
  bundleSize?: { totalBytes: number; largestModules: Array<{ name: string; bytes: number }> };
  memoryLeaks?: Array<{ location: string; growthRateMbPerHour: number; description: string }>;
  improvements: Array<{ description: string; beforeMetric: string; afterMetric: string; improvementPercent: number }>;
  recommendations: string[];
  timestamp: number;
}

// Wave 5 — Business Impact types
export interface ImpactReport {
  period: string;
  features: Array<{ name: string; prUrl?: string; metrics: Array<{ name: string; source: string; before: number; after: number; changePercent: number; monetaryValue?: number; confidence: number }>; totalValue: number; cost: number }>;
  roi: { swarmCost: number; estimatedValue: number; multiple: number };
  highlights: string[];
  timestamp: number;
}

// Wave 5 — Fleet types
export interface FleetState {
  instances: Array<{ id: string; team: string; repo: string; status: 'active' | 'idle' | 'offline'; version: string; lastHeartbeat: number; stats: { totalRuns: number; successRate: number; totalCost: number } }>;
  budget: { total: number; allocated: Record<string, number>; spent: Record<string, number> };
  knowledgeItems: number;
  crossTeamAlerts: Array<{ from: string; to: string[]; type: string; message: string; timestamp: number }>;
  lastSync: number;
}

// Wave 5 — API Contract types
export interface ContractData {
  endpoints: Array<{ path: string; method: string; version: string; requestSchema?: string; responseSchema?: string; consumers: string[] }>;
  breakingChanges: Array<{ endpoint: string; type: string; description: string; affectedConsumers: string[]; severity: string }>;
  versions: Array<{ version: string; endpoints: number; publishedAt: number }>;
  consumers: Array<{ name: string; endpoints: string[]; sdkVersion?: string }>;
  lastGenerated: number;
}

// Wave 5 — Simulation types
export interface SimulationReport {
  scenarios: Array<{ scenario: string; passed: boolean; metrics: Array<{ name: string; value: number; threshold: number; status: string }>; issues: Array<{ severity: string; description: string; location?: string }>; duration: number }>;
  overallPass: boolean;
  riskLevel: string;
  recommendations: string[];
  timestamp: number;
}

// Wave 5 — Teach types
export interface TeachState {
  examples: number;
  byTaskType: Record<string, number>;
  trainingJobs: Array<{ id: string; model: string; status: string; startedAt: number; completedAt?: number; metrics?: { loss: number; accuracy: number } }>;
  deployedModels: Array<{ id: string; taskTypes: string[]; costReduction: number; qualityDelta: number; deployedAt: number }>;
  lastCollected: number;
}

// Wave 6 — Negotiate types
export interface NegotiateState {
  negotiations: Array<{ id: string; request: string; feasible: boolean; options: Array<{ name: string; description: string; timeline: string; cost: number; coverage: number; deferred: string[]; risk: string; recommended: boolean }>; selectedOption?: string; audience: string; status: string; createdAt: number }>;
  reports: Array<{ id: string; period: string; audience: string; content: string; generatedAt: number }>;
  channels: Array<{ type: string; configured: boolean; lastUsed?: number }>;
}

// Wave 6 — Specialize types
export interface SpecializeState {
  specialists: Array<{ id: string; domain: string; name: string; expertiseScore: number; tasksCompleted: number; successRate: number; memoryItems: number; status: string; createdAt: number; lastUsed: number }>;
  routingHistory: Array<{ taskDescription: string; routed: string; confidence: number; outcome?: string; timestamp: number }>;
  collaborations: Array<{ from: string; to: string; type: string; timestamp: number }>;
}

// Wave 6 — Govern types
export interface GovernState {
  policies: Array<{ domain: string; level: number; trustScore: number; autoPromoteThreshold: number; autoDemoteOnRevert: boolean }>;
  decisions: Array<{ id: string; action: string; domain: string; level: number; confidence: number; reasoning: string; alternatives: string[]; status: string; outcome?: string; timestamp: number; resolvedAt?: number; resolvedBy?: string }>;
  trustScores: Record<string, number>;
  overrides: number;
  totalDecisions: number;
  autonomousRate: number;
  budgetAllocation: Record<string, { allocated: number; spent: number }>;
}

// Wave 6 — Empathize types
export interface EmpathizeState {
  journeys: Array<{
    id: string;
    name: string;
    touchpoints: Array<{ stage: string; timestamp: number; status: 'completed' | 'failed' | 'in-progress'; durationMs: number; sentiment: 'positive' | 'negative' | 'neutral' }>;
    satisfaction: number;
    painPoints: string[];
    dropOffPoints: string[];
    analyzedAt: number;
  }>;
  themes: Array<{ id: string; theme: string; occurrences: number; sentiment: 'positive' | 'negative' | 'neutral'; sources: string[]; firstSeen: number; lastSeen: number; impact: 'high' | 'medium' | 'low' }>;
  improvements: string[];
  lastAnalyzed: number;
}

// Wave 6 — Allocate types
export interface AllocateState {
  currentPlan: {
    id: string;
    generatedAt: number;
    compositeScore: number;
    scores: { businessImpact: number; techRisk: number; userImpact: number };
    allocations: Array<{ category: string; percentage: number; rationale: string }>;
    insights: string[];
    totalBudgetContext: { historicalCost: number; runsAnalyzed: number };
  } | null;
  scenarios: Array<{
    id: string;
    description: string;
    type: 'increase-features' | 'increase-reliability' | 'reduce-budget' | 'scale-up' | 'custom';
    adjustments: Array<{ category: string; currentPct: number; proposedPct: number }>;
    predictedOutcome: { velocityChange: string; riskChange: string; costChange: string; recommendation: string };
    runAt: number;
    confidence: number;
  }>;
  okrs: Array<{ objective: string; keyResults: Array<{ metric: string; current: number; target: number; unit: string }>; category: string; confidence: number }>;
  lastGenerated: number;
}

// Wave 6 — Compete types
export interface CompeteState {
  competitors: Array<{ name: string; repo?: string; stars?: number; lastRelease?: string; recentFeatures: string[]; trend: string }>;
  featureGaps: Array<{ feature: string; competitor: string; priority: string; effort: string }>;
  radar: Array<{ name: string; category: string; ring: string; relevance: string }>;
  lastScanned: number;
}

// Wave 6 — Spawn types
export interface SpawnState {
  capabilities: Array<{ id: string; name: string; type: string; source: string; effectiveness: number; tasksUsed: number; status: string; acquiredAt: number }>;
  gaps: Array<{ domain: string; failureCount: number; lastFailed: number; attemptedAcquisitions: number }>;
  evaluations: Array<{ capabilityId: string; tasksRun: number; successRate: number; verdict: string }>;
}

// Wave 6 — Federate types
export interface FederateState {
  optedIn: boolean;
  sharedPatterns: Array<{ id: string; type: string; description: string; stack: string; effectiveness: number; adoptions: number; sharedAt: number }>;
  receivedPatterns: Array<{ id: string; type: string; description: string; stack: string; effectiveness: number; adoptions: number; sharedAt: number }>;
  benchmarks: Array<{ metric: string; myValue: number; communityAvg: number; percentile: number }>;
  lastSync: number;
}

export type WsMessage =
  | { type: 'state'; payload: PipelineState }
  | { type: 'agent-update'; payload: Agent }
  | { type: 'agent-output'; payload: { agentId: string; chunk: string } }
  | { type: 'agent-activity'; payload: AgentActivity }
  | { type: 'agent-logs'; payload: { agentId: string; output: string; activities: AgentActivity[] } }
  | { type: 'guardrail-alert'; payload: GuardrailViolation }
  | { type: 'cost-update'; payload: CostInfo }
  | { type: 'history-list'; payload: HistoryEntry[] }
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
  | { action: 'autopilot-start'; label?: string; interval?: number; maxConcurrent?: number; budget?: number; dryRun?: boolean }
  | { action: 'autopilot-stop' }
  | { action: 'autopilot-status' }
  | { action: 'run-test-gen'; scope?: string; model?: string; framework?: string; coverage?: boolean; verify?: boolean; budget?: number }
  | { action: 'run-deps-check' }
  | { action: 'run-deps-update'; level?: string; model?: string; verify?: boolean; budget?: number }
  | { action: 'run-deps-audit' }
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
  | { action: 'run-prompt-guard-scan'; text: string }
  | { action: 'get-provenance'; file?: string; runId?: string; limit?: number }
  | { action: 'get-runtime-events'; since?: number; severity?: string }
  | { action: 'save-runtime-baseline' }
  | { action: 'run-secrets-scan'; scope?: string; includeTests?: boolean }
  | { action: 'run-fingerprint'; scope?: string }
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
  // Wave 6
  | { action: 'negotiate-feasibility'; request: string; deadline?: string }
  | { action: 'negotiate-status'; audience?: string }
  | { action: 'negotiate-report'; period?: string; audience?: string }
  | { action: 'get-negotiate-state' }
  | { action: 'specialize-list' }
  | { action: 'specialize-create'; domain: string; name?: string }
  | { action: 'specialize-route'; task: string }
  | { action: 'specialize-stats' }
  | { action: 'govern-status' }
  | { action: 'govern-policy'; domain?: string; level?: number }
  | { action: 'govern-audit'; limit?: number }
  | { action: 'govern-trust'; domain?: string }
  | { action: 'govern-override'; decisionId: string; verdict: string }
  | { action: 'empathize-journey'; name: string }
  | { action: 'empathize-feedback' }
  | { action: 'empathize-impact'; feature: string }
  | { action: 'empathize-suggest' }
  | { action: 'allocate-plan' }
  | { action: 'allocate-scenario'; scenario: string }
  | { action: 'allocate-okrs'; goals?: string }
  | { action: 'compete-scan' }
  | { action: 'compete-gaps' }
  | { action: 'compete-radar' }
  | { action: 'spawn-capability'; domain: string }
  | { action: 'spawn-list' }
  | { action: 'spawn-evaluate' }
  | { action: 'federate-opt-in' }
  | { action: 'federate-opt-out' }
  | { action: 'federate-share' }
  | { action: 'federate-benchmarks' }
  | { action: 'get-federate-state' };
