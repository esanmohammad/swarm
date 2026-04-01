import chalk from 'chalk';
import ora from 'ora';
import type { Command } from 'commander';
import type { Persona, TechStack } from '../types.js';
import { loadConfig, requireSwarmDir } from '../core/config.js';
import { createContext } from './shared.js';
import { readFileSync, existsSync } from 'node:fs';

export function registerAgent(program: Command): void {
  const agent = program
    .command('agent')
    .description('Manage individual agents');

  agent
    .command('spawn')
    .description('Spawn a named agent')
    .argument('<name>', 'Agent name')
    .requiredOption('--persona <persona>', 'Persona type (analyst, architect, lead, engineer)')
    .option('-s, --stack <stack>', 'Tech stack (react, node, go)')
    .option('-m, --model <model>', 'Model override')
    .option('--prompt <prompt>', 'Task prompt (text or file path)')
    .option('--file', 'Treat prompt as file path')
    .option('--budget <amount>', 'Max budget for this agent in USD')
    .action(async (name: string, opts) => {
      const swarmDir = requireSwarmDir();
      const config = loadConfig();
      const stack = (opts.stack as TechStack) || config.stack;
      const persona = opts.persona as Persona;

      let prompt = opts.prompt || `Execute the ${persona} workflow for a ${stack} project`;
      if (opts.file && opts.prompt) {
        if (!existsSync(opts.prompt)) {
          console.error(chalk.red(`File not found: ${opts.prompt}`));
          process.exit(1);
        }
        prompt = readFileSync(opts.prompt, 'utf-8');
      }

      const { agentManager, costTracker, cleanup } = createContext(swarmDir, config);

      const spinner = ora(`Spawning agent "${name}"...`).start();
      try {
        const ag = await agentManager.spawn({
          name,
          persona,
          stack,
          prompt,
          model: opts.model,
          maxBudgetUsd: opts.budget ? parseFloat(opts.budget) : undefined,
          cwd: process.cwd(),
        });

        spinner.text = `Agent "${name}" running (${ag.id.slice(0, 8)})...`;
        await agentManager.waitForAgent(ag.id);

        spinner.succeed(`Agent "${name}" complete`);
        console.log(chalk.dim(costTracker.formatTotal()));
      } catch (err) {
        spinner.fail(`Agent "${name}" failed`);
        console.error(chalk.red(err instanceof Error ? err.message : String(err)));
        process.exit(1);
      } finally {
        cleanup();
      }
    });

  agent
    .command('list')
    .description('List all agents')
    .action(async () => {
      const swarmDir = requireSwarmDir();
      const { state } = createContext(swarmDir, loadConfig());
      const pipeline = state.getState();

      if (pipeline.agents.length === 0) {
        console.log(chalk.dim('No agents found.'));
        return;
      }

      console.log(chalk.bold('\nAgents:\n'));
      for (const ag of pipeline.agents) {
        const status = ag.status === 'done' ? chalk.green(ag.status)
          : ag.status === 'error' ? chalk.red(ag.status)
          : ag.status === 'running' ? chalk.cyan(ag.status)
          : chalk.gray(ag.status);

        console.log(`  ${chalk.bold(ag.name)} (${ag.persona}/${ag.stack})`);
        console.log(`    ID: ${chalk.dim(ag.id)}  Status: ${status}  Cost: $${ag.cost.totalUsd.toFixed(4)}`);
      }
      console.log('');
    });

  agent
    .command('kill')
    .description('Kill a running agent')
    .argument('<name-or-id>', 'Agent name or ID')
    .action(async (nameOrId: string) => {
      const swarmDir = requireSwarmDir();
      const config = loadConfig();
      const { agentManager } = createContext(swarmDir, config);

      const agent = agentManager.getByName(nameOrId) || agentManager.get(nameOrId);
      if (!agent) {
        console.error(chalk.red(`Agent "${nameOrId}" not found.`));
        console.error(chalk.dim(`Run ${chalk.bold('swarm agent list')} to see active agents, or ${chalk.bold('swarm status')} for full pipeline state.`));
        process.exit(1);
      }

      if (agentManager.kill(agent.id)) {
        console.log(chalk.yellow(`Killed agent "${agent.name}"`));
      } else {
        console.log(chalk.dim(`Agent "${agent.name}" was not running.`));
      }
    });
}
