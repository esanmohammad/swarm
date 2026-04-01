import { StateManager } from '../core/state.js';
import { CostTracker } from '../core/cost-tracker.js';
import { PromptLoader } from '../prompts/loader.js';
import { AgentManager } from '../core/agent-manager.js';
import { Pipeline } from '../core/pipeline.js';
import { SwarmWsServer } from '../core/ws-server.js';
import { AuditLog } from '../core/audit.js';
import { requireClaudeCli } from '../core/preflight.js';
import type { SwarmConfig, Agent } from '../types.js';

export interface SwarmContext {
  state: StateManager;
  costTracker: CostTracker;
  promptLoader: PromptLoader;
  agentManager: AgentManager;
  pipeline: Pipeline;
  wsServer: SwarmWsServer;
  cleanup: () => void;
}

export function createContext(swarmDir: string, config: SwarmConfig): SwarmContext {
  // Ensure Claude CLI is available before wiring up any agents
  requireClaudeCli();
  const state = new StateManager(swarmDir);
  state.killOrphanProcesses(); // Kill any orphans before starting new work
  const costTracker = new CostTracker();
  costTracker.setBudget(config.maxBudgetUsd);
  const promptLoader = new PromptLoader(config.promptsDir, swarmDir);
  const agentManager = new AgentManager(state, costTracker, promptLoader, config);
  const pipeline = new Pipeline(agentManager, state, config);
  const audit = new AuditLog(swarmDir);

  // Wire audit logging to agent lifecycle events
  agentManager.on('agent-spawned', (agent: Agent) => {
    audit.agentSpawned(agent.id, agent.name, agent.persona);
  });
  agentManager.on('agent-done', (agent: Agent) => {
    audit.agentDone(agent.id, agent.name, agent.cost.totalUsd);
  });
  agentManager.on('agent-error', (agent: Agent) => {
    audit.agentError(agent.id, agent.name, agent.error ?? 'Unknown error');
  });

  // Pass cwd so dashboard-spawned agents run in the right directory
  const wsServer = new SwarmWsServer(state, agentManager, config, process.cwd());

  const cleanup = () => {
    agentManager.killAll();
    wsServer.stop();
    state.flush();
  };

  // Only register once per process
  const onExit = () => {
    cleanup();
    process.exit(0);
  };
  process.removeAllListeners('SIGINT');
  process.removeAllListeners('SIGTERM');
  process.on('SIGINT', onExit);
  process.on('SIGTERM', onExit);

  // Last-resort flush on exit (covers cases where signal handlers don't run)
  process.on('exit', () => {
    try { state.flush(); } catch { /* best effort */ }
  });

  // Catch uncaught exceptions — cleanup and exit
  process.on('uncaughtException', (err) => {
    console.error(`[swarm] Uncaught exception: ${err.message}`);
    cleanup();
    process.exit(1);
  });

  return { state, costTracker, promptLoader, agentManager, pipeline, wsServer, cleanup };
}
