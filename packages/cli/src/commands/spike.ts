import { existsSync, readFileSync } from 'node:fs';
import chalk from 'chalk';
import ora from 'ora';
import type { Command } from 'commander';
import type { TechStack } from '../types.js';
import { loadConfig, requireSwarmDir, autoDetectStack, autoInit } from '../core/config.js';
import { createContext } from './shared.js';

export function registerSpike(program: Command): void {
  program
    .command('spike')
    .description('Quick exploration: single engineer agent, no artifacts, no pipeline — just investigate and report')
    .argument('<question>', 'Question or exploration task')
    .option('-s, --stack <stack>', 'Tech stack override')
    .option('-m, --model <model>', 'Model override (default: haiku for speed, e.g., sonnet, openai/gpt-4o)')
    .option('-f, --file', 'Treat argument as a file path to read')
    .option('-b, --budget <amount>', 'Max budget in USD', '3')
    .option('-i, --interactive', 'Interactive mode — converse with the agent in terminal')
    .action(async (question: string, opts) => {
      let swarmDir: string;
      try {
        swarmDir = requireSwarmDir();
      } catch {
        const cwd = process.cwd();
        const stack = (opts.stack as TechStack) || autoDetectStack(cwd);
        const projectName = cwd.split('/').pop() || 'my-project';
        console.log(chalk.yellow(`No .swarm/ found — auto-initializing (stack: ${stack})...`));
        swarmDir = autoInit(projectName, stack, cwd);
      }

      const config = loadConfig();
      // Spike defaults to haiku for cheap/fast exploration
      config.model = opts.model || 'haiku';
      if (opts.budget) {
        config.maxBudgetUsd = opts.budget === 'none' ? null : (parseFloat(opts.budget) || 3);
      }

      const stack = (opts.stack as TechStack) || config.stack;
      const { agentManager, cleanup } = createContext(swarmDir, config);
      const interactive = opts.interactive ?? false;

      try {
        let taskDescription = question;
        if (opts.file) {
          if (!existsSync(question)) {
            console.error(chalk.red(`File not found: ${question}`));
            process.exit(1);
          }
          taskDescription = readFileSync(question, 'utf-8');
        }

        const prompt = [
          'You are doing a quick investigation spike. Your goal is to explore and report findings.',
          '',
          `Task: ${taskDescription}`,
          '',
          'Instructions:',
          '1. Read and explore the codebase to answer the question.',
          '2. Do NOT make any code changes unless explicitly asked.',
          '3. Summarize your findings clearly at the end.',
          '4. If you find relevant files, code patterns, or potential issues — list them.',
          '5. Keep your investigation focused — this is a quick spike, not a deep audit.',
        ].join('\n');

        console.log(chalk.bold(`\nSwarm Spike — quick exploration`));
        console.log(chalk.dim(`Task: ${taskDescription.slice(0, 100)}${taskDescription.length > 100 ? '...' : ''}`));
        console.log(chalk.dim(`Model: ${config.model} | Budget: ${config.maxBudgetUsd ? '$' + config.maxBudgetUsd : 'unlimited'}\n`));

        if (interactive) {
          // Interactive: agent takes over terminal
          const agent = await agentManager.spawn({
            name: `spike-${stack}`,
            persona: 'engineer',
            stack,
            prompt,
            model: config.model,
            cwd: process.cwd(),
            interactive: true,
          });
          await agentManager.waitForAgent(agent.id);
        } else {
          const spinner = ora('Investigating...').start();
          const agent = await agentManager.spawn({
            name: `spike-${stack}`,
            persona: 'engineer',
            stack,
            prompt,
            model: config.model,
            cwd: process.cwd(),
            interactive: false,
            permissionMode: 'auto',
            disallowedTools: ['Edit', 'Write', 'NotebookEdit'],
          });

          await agentManager.waitForAgent(agent.id);
          const cost = agent.cost.totalUsd;

          if (agent.status === 'done') {
            spinner.succeed(`Spike complete. Cost: $${cost.toFixed(2)}`);
          } else {
            spinner.fail(`Spike failed: ${agent.error || 'Unknown error'}`);
          }
        }
      } catch (err) {
        console.error(chalk.red(err instanceof Error ? err.message : String(err)));
        process.exit(1);
      } finally {
        cleanup();
      }
    });
}
