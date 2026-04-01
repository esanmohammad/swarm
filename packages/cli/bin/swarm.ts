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
import { registerRecover } from '../src/commands/recover.js';
import { registerAudit } from '../src/commands/audit.js';
import { registerPlugin } from '../src/commands/plugin.js';
import { registerTelemetry } from '../src/commands/telemetry.js';
import { autoDetectStack, autoInit, loadConfig } from '../src/core/config.js';
import { createContext } from '../src/commands/shared.js';

const program = new Command();

// Check if --all flag was passed for extended help
const showAll = process.argv.includes('--all');

program
  .name('swarm')
  .description('AI builds your feature while you watch')
  .version('0.1.0')
  .argument('[feature-request]', 'Describe what to build — runs the full pipeline automatically')
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

// --- Primary commands (always visible) ---
registerInit(program);
registerMayday(program);
registerDashboard(program);
registerStatus(program);
registerDoctor(program);

// --- Pipeline stage commands (always visible) ---
registerAnalyze(program);
registerArchitect(program);
registerPlan(program);
registerBuild(program);
registerTest(program);

// --- Advanced commands (hidden unless --all) ---
const advancedCommands = [registerEvaluate, registerAgent, registerRecover, registerAudit, registerPlugin, registerTelemetry];
for (const register of advancedCommands) {
  register(program);
}

// Hide advanced commands from default help
if (!showAll) {
  for (const cmd of program.commands) {
    const name = cmd.name();
    if (['evaluate', 'eval', 'agent', 'recover', 'audit', 'plugin', 'telemetry'].includes(name)) {
      (cmd as unknown as { _hidden: boolean })._hidden = true;
    }
  }
}

// Override help to add usage examples and --all hint
program.addHelpText('after', () => {
  const lines = [
    '',
    chalk.bold('Quick start:'),
    `  ${chalk.cyan('swarm "add a login page with JWT auth"')}  Build a feature end-to-end`,
    `  ${chalk.cyan('swarm init')}                               Set up a new project`,
    `  ${chalk.cyan('swarm dashboard')}                          Open the web UI`,
  ];
  if (!showAll) {
    lines.push('');
    lines.push(chalk.dim('  Run swarm --help --all to see all commands'));
  }
  return lines.join('\n');
});

program.parse();
