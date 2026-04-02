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
  | { action: 'run-secrets-scan'; scope?: string; includeTests?: boolean };

// Guardrail types
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
}

export interface GuardrailViolation {
  rule: string;
  check: string;
  file: string;
  message: string;
  severity: 'error' | 'warning';
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
