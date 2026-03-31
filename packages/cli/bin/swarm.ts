#!/usr/bin/env node

import { Command } from 'commander';
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

const program = new Command();

program
  .name('swarm')
  .description('Claude Agent Orchestration CLI — manage your agent swarm')
  .version('0.1.0');

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
