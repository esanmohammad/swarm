import { existsSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { execSync } from 'node:child_process';
import chalk from 'chalk';
import ora from 'ora';
import type { Command } from 'commander';
import type { TechStack } from '../types.js';
import { loadConfig, requireSwarmDir, autoDetectStack, autoInit } from '../core/config.js';
import { createContext } from './shared.js';
import { scanCodebase } from '../core/codebase-scanner.js';
import { loadConventions } from './learn.js';

export function registerExplain(program: Command): void {
  program
    .command('explain')
    .description('Explain your codebase — full overview, specific files/dirs, or answer questions')
    .argument('[target]', 'File path, directory, or question (omit for full overview)')
    .option('-s, --stack <stack>', 'Tech stack override')
    .option('-m, --model <model>', 'Model override (default: haiku for speed, e.g., sonnet, openai/gpt-4o)')
    .option('--diagram', 'Include Mermaid diagrams in the explanation')
    .option('--depth <level>', 'Detail level: shallow, medium, deep', 'medium')
    .option('-o, --output <file>', 'Save explanation to file')
    .option('-b, --budget <amount>', 'Max budget in USD', '3')
    .option('-i, --interactive', 'Interactive mode — follow-up Q&A in terminal')
    .action(async (target: string | undefined, opts) => {
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
      config.model = opts.model || 'haiku';
      config.maxBudgetUsd = opts.budget === 'none' ? null : (parseFloat(opts.budget) || 3);

      const cwd = process.cwd();
      const stack = (opts.stack as TechStack) || config.stack;
      const depth = opts.depth || 'medium';
      const wantDiagram = opts.diagram ?? false;
      const interactive = opts.interactive ?? false;
      const { agentManager, cleanup } = createContext(swarmDir, config);

      try {
        const prompt = buildExplainPrompt(cwd, swarmDir, target, depth, wantDiagram, config.packages);
        const mode = target
          ? (existsSync(join(cwd, target)) ? `Explaining: ${target}` : `Answering: ${target.slice(0, 80)}`)
          : 'Full project overview';

        console.log(chalk.bold(`\nSwarm Explain`));
        console.log(chalk.dim(`${mode}`));
        console.log(chalk.dim(`Model: ${config.model} | Depth: ${depth} | Diagrams: ${wantDiagram}\n`));

        if (interactive) {
          const agent = await agentManager.spawn({
            name: `explain-${stack}`,
            persona: 'engineer',
            stack,
            prompt,
            model: config.model,
            cwd,
            interactive: true,
            disallowedTools: ['Edit', 'Write', 'NotebookEdit', 'Bash'],
          });
          await agentManager.waitForAgent(agent.id);
        } else {
          const spinner = ora('Analyzing codebase...').start();

          const agent = await agentManager.spawn({
            name: `explain-${stack}`,
            persona: 'engineer',
            stack,
            prompt,
            model: config.model,
            cwd,
            interactive: false,
            permissionMode: 'auto',
            disallowedTools: ['Edit', 'Write', 'NotebookEdit', 'Bash'],
          });

          await agentManager.waitForAgent(agent.id);
          const cost = agent.cost.totalUsd;

          if (agent.status === 'done') {
            spinner.succeed(`Explanation complete. Cost: $${cost.toFixed(2)}`);

            if (opts.output) {
              writeFileSync(opts.output, agent.output, 'utf-8');
              console.log(chalk.green(`\nSaved to ${opts.output}`));
            }
          } else {
            spinner.fail(`Explain failed: ${agent.error || 'Unknown error'}`);
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

function buildExplainPrompt(
  cwd: string,
  swarmDir: string,
  target: string | undefined,
  depth: string,
  wantDiagram: boolean,
  packages?: string[],
): string {
  const parts: string[] = [];

  // Codebase context
  const codebaseCtx = scanCodebase(cwd, packages);
  if (codebaseCtx) parts.push(codebaseCtx);

  // Conventions
  const conventions = loadConventions(swarmDir);
  if (conventions) parts.push(conventions);

  // Existing docs
  const docs: string[] = [];
  for (const docFile of ['README.md', 'CLAUDE.md', '.claude/CLAUDE.md', 'CONTRIBUTING.md']) {
    const docPath = join(cwd, docFile);
    if (existsSync(docPath)) {
      try {
        const content = readFileSync(docPath, 'utf-8').slice(0, 5000);
        docs.push(`--- ${docFile} ---\n${content}`);
      } catch { /* skip */ }
    }
  }
  if (docs.length > 0) {
    parts.push('EXISTING DOCUMENTATION:\n' + docs.join('\n\n'));
  }

  // Git info
  try {
    const recentCommits = execSync('git log --oneline -10', { encoding: 'utf-8', cwd }).trim();
    if (recentCommits) parts.push(`RECENT COMMITS:\n${recentCommits}`);
  } catch { /* not a git repo */ }

  // Depth instructions
  const depthInstructions = {
    shallow: 'Give a brief, high-level overview. 1-2 paragraphs max. Focus on what the project does and key entry points.',
    medium: 'Give a thorough explanation. Cover architecture, key patterns, data flow, and important files. 2-4 sections.',
    deep: 'Give a comprehensive deep-dive. Cover architecture, every major module, data flow, patterns, configuration, testing, deployment. Include code examples.',
  }[depth] || 'Give a thorough explanation.';

  parts.push('');

  if (!target) {
    // Full project overview
    parts.push(
      'TASK: Generate a complete project explanation/onboarding guide.',
      '',
      depthInstructions,
      '',
      'Structure your response as:',
      '## Overview — What the project does, who it\'s for',
      '## Architecture — How the codebase is organized, key abstractions',
      '## Key Patterns — Important conventions, patterns, anti-patterns',
      '## Data Flow — How data moves through the system',
      '## Entry Points — Where to start reading the code',
      '## Testing — How tests work, how to run them',
      wantDiagram ? '## Diagrams — Mermaid diagrams showing architecture and data flow' : '',
      '',
      'Read the codebase to generate an accurate explanation. Do NOT guess — only state what you can verify from the code.',
    );
  } else if (existsSync(join(cwd, target))) {
    const fullPath = join(cwd, target);
    const isDir = statSync(fullPath).isDirectory();

    if (isDir) {
      parts.push(
        `TASK: Explain the directory \`${target}/\` and its contents.`,
        '',
        depthInstructions,
        '',
        'Cover: purpose of this directory, key files, how they relate, public API/exports, and how this module fits into the overall project.',
        wantDiagram ? 'Include a Mermaid diagram showing relationships between files in this directory.' : '',
      );
    } else {
      parts.push(
        `TASK: Explain the file \`${target}\`.`,
        '',
        depthInstructions,
        '',
        'Cover: what the file does, key functions/classes/exports, how it fits into the project, important design decisions, and any non-obvious behavior.',
        wantDiagram ? 'Include a Mermaid diagram if the file has complex control flow or relationships.' : '',
      );
    }
  } else {
    // Treat as a question
    parts.push(
      `TASK: Answer this question about the codebase:`,
      '',
      `"${target}"`,
      '',
      depthInstructions,
      '',
      'Read the relevant files to answer accurately. Cite specific files and line numbers. Do NOT guess.',
      wantDiagram ? 'Include Mermaid diagrams if they help illustrate the answer.' : '',
    );
  }

  return parts.filter(Boolean).join('\n');
}
