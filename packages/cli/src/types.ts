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
}

export interface PipelineState {
  projectName: string;
  stack: TechStack;
  stages: Record<StageName, StageState>;
  agents: Agent[];
  totalCost: CostInfo;
  violations: GuardrailViolation[];
  updatedAt: number;
  mayday?: MaydayState;
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
  | { type: 'approval-request'; payload: { stage: StageName; summary: string } };

export type WsCommand =
  | { action: 'spawn'; name: string; persona: Persona; stack: TechStack; model?: string; prompt?: string; permissionMode?: PermissionMode }
  | { action: 'kill'; agentId: string }
  | { action: 'send-input'; agentId: string; text: string }
  | { action: 'get-state' }
  | { action: 'run-stage'; stage: 'analyze' | 'architect' | 'plan' | 'build' | 'test'; prompt?: string; parallel?: number; taskId?: string; figmaUrl?: string; baseUrl?: string; authStorageState?: string }
  | { action: 'run-mayday'; prompt: string; maxIterations?: number; figmaUrl?: string; parallel?: number; resume?: boolean; model?: string; maxFixBudgetUsd?: number | null; fromStage?: StageName; approvalRequired?: boolean }
  | { action: 'mayday-input'; text: string }
  | { action: 'mayday-stop' }
  | { action: 'mayday-approve'; stage: StageName }
  | { action: 'mayday-reject'; stage: StageName; reason?: string }
  | { action: 'get-history' };

// Guardrail types
export interface GuardrailRule {
  name: string;
  target: string;
  checks: GuardrailCheck[];
}

export interface GuardrailCheck {
  type: 'section-exists' | 'pattern-match' | 'command';
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
}

export const DEFAULT_CONFIG: SwarmConfig = {
  projectName: 'my-project',
  stack: 'react',
  model: 'opus',
  maxBudgetUsd: 20,
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
