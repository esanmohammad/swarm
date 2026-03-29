// Agent lifecycle states
export type AgentStatus = 'pending' | 'running' | 'done' | 'error' | 'killed';

// Claude CLI permission modes
export type PermissionMode = 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan' | 'auto';

// The four personas
export type Persona = 'analyst' | 'architect' | 'lead' | 'engineer';

// Supported tech stacks
export type TechStack = 'react' | 'node' | 'go';

// Pipeline stage names
export type StageName = 'analyze' | 'architect' | 'plan' | 'build' | 'evaluate';

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
}

// Pipeline stage tracking
export interface StageState {
  status: 'pending' | 'running' | 'done' | 'error' | 'skipped';
  agentIds: string[];
  artifact: string | null;
}

export interface PipelineState {
  projectName: string;
  stack: TechStack;
  stages: Record<StageName, StageState>;
  agents: Agent[];
  totalCost: CostInfo;
  updatedAt: number;
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
      evaluate: emptyStage(),
    },
    agents: [],
    totalCost: emptyCost(),
    updatedAt: Date.now(),
  };
}

// WebSocket message types
export type WsMessage =
  | { type: 'state'; payload: PipelineState }
  | { type: 'agent-update'; payload: Agent }
  | { type: 'agent-output'; payload: { agentId: string; chunk: string } }
  | { type: 'guardrail-alert'; payload: GuardrailViolation }
  | { type: 'cost-update'; payload: CostInfo };

export type WsCommand =
  | { action: 'spawn'; name: string; persona: Persona; stack: TechStack; model?: string; prompt?: string; permissionMode?: PermissionMode }
  | { action: 'kill'; agentId: string }
  | { action: 'send-input'; agentId: string; text: string }
  | { action: 'get-state' };

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

// .swarm/config.yaml shape
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
}

export const DEFAULT_CONFIG: SwarmConfig = {
  projectName: 'my-project',
  stack: 'react',
  model: 'opus',
  maxBudgetUsd: null,
  promptsDir: '~/.claude/prompts',
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
    content?: Array<{ type: string; text?: string }>;
    role?: string;
    stop_reason?: string | null;
  };
}

// Persona → stage mapping
export const PERSONA_STAGE_MAP: Record<Persona, StageName> = {
  analyst: 'analyze',
  architect: 'architect',
  lead: 'plan',
  engineer: 'build',
};

// Stage → expected artifact
export const STAGE_ARTIFACT_MAP: Record<StageName, string | null> = {
  analyze: 'REQUIREMENTS.md',
  architect: 'SPEC.md',
  plan: 'TASKS.md',
  build: null,
  evaluate: null,
};
