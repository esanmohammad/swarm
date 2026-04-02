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
  | { action: 'run-migrate'; description: string; dryRun?: boolean; model?: string };
