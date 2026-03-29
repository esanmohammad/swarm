import chalk from 'chalk';
import type { Command } from 'commander';
import { requireSwarmDir } from '../core/config.js';
import { StateManager } from '../core/state.js';
import type { AgentStatus, StageName } from '../types.js';

const STATUS_COLORS: Record<string, (s: string) => string> = {
  pending: chalk.gray,
  running: chalk.cyan,
  done: chalk.green,
  error: chalk.red,
  killed: chalk.yellow,
  skipped: chalk.dim,
};

function colorStatus(status: string): string {
  const fn = STATUS_COLORS[status] ?? chalk.white;
  return fn(status);
}

export function registerStatus(program: Command): void {
  program
    .command('status')
    .description('Show current pipeline state and agent status')
    .action(async () => {
      const swarmDir = requireSwarmDir();
      const state = new StateManager(swarmDir);
      const pipeline = state.getState();

      // Pipeline overview
      console.log(chalk.bold(`\nProject: ${pipeline.projectName} (${pipeline.stack})\n`));

      console.log(chalk.bold('Pipeline:'));
      const stages: StageName[] = ['analyze', 'architect', 'plan', 'build', 'evaluate'];
      const stageLabels: Record<StageName, string> = {
        analyze: 'Analyze',
        architect: 'Architect',
        plan: 'Plan',
        build: 'Build',
        evaluate: 'Evaluate',
      };

      for (const stage of stages) {
        const s = pipeline.stages[stage];
        const artifact = s.artifact ? chalk.dim(` → ${s.artifact}`) : '';
        const agents = s.agentIds.length ? chalk.dim(` (${s.agentIds.length} agents)`) : '';
        console.log(`  ${stageLabels[stage].padEnd(12)} ${colorStatus(s.status)}${artifact}${agents}`);
      }

      // Agents table
      if (pipeline.agents.length > 0) {
        console.log(chalk.bold('\nAgents:'));
        console.log(chalk.dim('  Name                 Status    Cost       Tokens (in/out)    Duration'));
        console.log(chalk.dim('  ' + '-'.repeat(78)));

        for (const agent of pipeline.agents) {
          const name = agent.name.padEnd(20);
          const status = colorStatus(agent.status).padEnd(18); // includes ANSI codes
          const cost = ('$' + agent.cost.totalUsd.toFixed(4)).padEnd(10);
          const tokens = `${agent.cost.inputTokens.toLocaleString()}/${agent.cost.outputTokens.toLocaleString()}`.padEnd(18);
          const duration = agent.cost.durationMs > 0 ? `${(agent.cost.durationMs / 1000).toFixed(1)}s` : '-';
          console.log(`  ${name} ${colorStatus(agent.status).padEnd(9)} ${cost} ${tokens} ${duration}`);
        }
      }

      // Total cost
      const total = pipeline.totalCost;
      if (total.totalUsd > 0) {
        console.log(chalk.bold(`\nTotal Cost: ${chalk.yellow('$' + total.totalUsd.toFixed(4))}`));
        console.log(chalk.dim(`  Tokens: ${total.inputTokens.toLocaleString()} in / ${total.outputTokens.toLocaleString()} out`));
      }

      console.log('');
    });
}
