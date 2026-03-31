#!/usr/bin/env node

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { Command } from 'commander';
import chalk from 'chalk';
import { registerInit } from '../src/commands/init.js';
import { registerAnalyze } from '../src/commands/analyze.js';
import { registerArchitect } from '../src/commands/architect.js';
import { registerPlan } from '../src/commands/plan.js';
import { registerBuild } from '../src/commands/build.js';
import { registerTest } from '../src/commands/test.js';
import { registerEvaluate } from '../src/commands/evaluate.js';
import { registerStatus } from '../src/commands/status.js';
import { registerAgent } from '../src/commands/agent.js';
import { registerDashboard } from '../src/commands/dashboard.js';
import { registerMayday } from '../src/commands/mayday.js';
import { registerDoctor } from '../src/commands/doctor.js';
import { autoDetectStack, autoInit, loadConfig } from '../src/core/config.js';
import { createContext } from '../src/commands/shared.js';

const program = new Command();

program
  .name('swarm')
  .description('Claude Agent Orchestration CLI — manage your agent swarm')
  .version('0.1.0')
  .argument('[feature-request]', 'Feature request — auto-inits and runs MayDay pipeline')
  .action(async (featureRequest: string | undefined) => {
    // Only trigger when a feature-request string is provided and no subcommand matched
    if (!featureRequest) return;

    const cwd = process.cwd();
    const swarmDir = join(cwd, '.swarm');
    const stack = autoDetectStack(cwd);

    // Auto-init if .swarm/ doesn't exist
    if (!existsSync(swarmDir)) {
      const projectName = cwd.split('/').pop() || 'my-project';
      console.log(chalk.yellow(`No .swarm/ found — auto-initializing (stack: ${stack})...`));
      autoInit(projectName, stack, cwd);
      console.log(chalk.green(`Initialized .swarm/ for "${projectName}"`));
    }

    const config = loadConfig(cwd);
    const { pipeline, cleanup } = createContext(swarmDir, config);

    try {
      await pipeline.runMayday(featureRequest, {
        stack,
        maxIterations: 5,
        parallel: 3,
        maxFixBudgetUsd: 15,
      });
    } catch (err) {
      console.error(chalk.red(err instanceof Error ? err.message : String(err)));
      process.exit(1);
    } finally {
      cleanup();
    }
  });

// Register all commands
registerInit(program);
registerAnalyze(program);
registerArchitect(program);
registerPlan(program);
registerBuild(program);
registerTest(program);
registerEvaluate(program);
registerStatus(program);
registerAgent(program);
registerDashboard(program);
registerMayday(program);
registerDoctor(program);

program.parse();
