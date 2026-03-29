import { StateManager } from '../core/state.js';
import { CostTracker } from '../core/cost-tracker.js';
import { PromptLoader } from '../prompts/loader.js';
import { AgentManager } from '../core/agent-manager.js';
import { Pipeline } from '../core/pipeline.js';
import { SwarmWsServer } from '../core/ws-server.js';
import type { SwarmConfig } from '../types.js';

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
  const state = new StateManager(swarmDir);
  const costTracker = new CostTracker();
  const promptLoader = new PromptLoader(config.promptsDir);
  const agentManager = new AgentManager(state, costTracker, promptLoader, config);
  const pipeline = new Pipeline(agentManager, state, config);
  // Pass cwd so dashboard-spawned agents run in the right directory
  const wsServer = new SwarmWsServer(state, agentManager, process.cwd());

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

  return { state, costTracker, promptLoader, agentManager, pipeline, wsServer, cleanup };
}
