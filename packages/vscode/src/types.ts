// Local copies of Swarm types — decoupled from CLI package

export type AgentStatus = 'pending' | 'running' | 'done' | 'error' | 'killed';
export type Persona = 'analyst' | 'architect' | 'lead' | 'engineer' | 'tester';
export type TechStack = 'react' | 'node' | 'go';
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
  startedAt: number | null;
  finishedAt: number | null;
  cost: CostInfo;
  output: string;
  error: string | null;
  parentId: string | null;
  childIds: string[];
}

export interface StageState {
  status: 'pending' | 'running' | 'done' | 'error' | 'skipped';
  agentIds: string[];
  artifact: string | null;
  startedAt?: number;
}

export interface MaydayState {
  active: boolean;
  featureRequest: string;
  currentStage: StageName | 'fix-loop' | 'complete';
  fixIteration: number;
  maxFixIterations: number;
  startedAt: number;
  error: string | null;
}

export interface PipelineState {
  projectName: string;
  stack: TechStack;
  stages: Record<StageName, StageState>;
  agents: Agent[];
  totalCost: CostInfo;
  updatedAt: number;
  mayday?: MaydayState;
}

export interface AgentActivity {
  id: string;
  agentId: string;
  kind: 'tool_use' | 'tool_result' | 'thinking' | 'text';
  tool?: string;
  summary: string;
  content?: string;
  timestamp: number;
}

// WebSocket message types (server -> client)
export type WsMessage =
  | { type: 'state'; payload: PipelineState }
  | { type: 'agent-update'; payload: Agent }
  | { type: 'agent-output'; payload: { agentId: string; chunk: string } }
  | { type: 'agent-activity'; payload: AgentActivity }
  | { type: 'agent-logs'; payload: { agentId: string; output: string; activities: AgentActivity[] } }
  | { type: 'cost-update'; payload: CostInfo };

// WebSocket command types (client -> server)
export type WsCommand =
  | { action: 'get-state' }
  | { action: 'kill'; agentId: string }
  | { action: 'send-input'; agentId: string; text: string }
  | { action: 'run-stage'; stage: 'analyze' | 'architect' | 'plan' | 'build' | 'test'; prompt?: string }
  | { action: 'run-mayday'; prompt: string; maxIterations?: number }
  | { action: 'mayday-stop' };
