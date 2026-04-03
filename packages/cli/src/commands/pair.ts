import chalk from 'chalk';
import type { Command } from 'commander';
import { join, relative } from 'node:path';
import { PairEngine } from '../core/pair-engine.js';
import type { PairSuggestion, PairSession } from '../core/pair-engine.js';
import { loadConfig, requireSwarmDir, autoDetectStack, autoInit } from '../core/config.js';
import type { TechStack } from '../types.js';

const SEVERITY_COLORS: Record<string, (s: string) => string> = {
  info: chalk.blue,
  warning: chalk.yellow,
  critical: chalk.red,
};

const TYPE_LABELS: Record<string, string> = {
  bug: 'BUG',
  pattern: 'PATTERN',
  'test-gap': 'TEST GAP',
  security: 'SECURITY',
  import: 'IMPORT',
  'co-change': 'CO-CHANGE',
};

function formatSuggestion(s: PairSuggestion): string {
  const color = SEVERITY_COLORS[s.severity] || chalk.white;
  const label = TYPE_LABELS[s.type] || s.type.toUpperCase();
  const location = s.line ? `${s.file}:${s.line}` : s.file;
  return `  ${color(`[${label}]`)} ${chalk.dim(location)}\n  ${s.message}`;
}

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}

function printSessionSummary(session: PairSession): void {
  const duration = Date.now() - session.startedAt;
  const accepted = session.suggestions.filter(s => s.accepted === true).length;
  const dismissed = session.suggestions.filter(s => s.accepted === false).length;
  const pending = session.suggestions.filter(s => s.accepted === undefined).length;

  console.log('\n' + chalk.bold('Pair Session Summary'));
  console.log(chalk.dim('─'.repeat(40)));
  console.log(`  Duration:     ${formatDuration(duration)}`);
  console.log(`  Mode:         ${session.mode}`);
  console.log(`  Files watched: ${session.filesWatched}`);
  console.log(`  Files changed: ${session.changedFiles.length}`);
  console.log(`  Suggestions:  ${session.suggestions.length} total`);
  if (session.suggestions.length > 0) {
    console.log(`    Accepted:   ${chalk.green(String(accepted))}`);
    console.log(`    Dismissed:  ${chalk.red(String(dismissed))}`);
    console.log(`    Pending:    ${chalk.yellow(String(pending))}`);

    const bySeverity = { info: 0, warning: 0, critical: 0 };
    for (const s of session.suggestions) {
      bySeverity[s.severity]++;
    }
    if (bySeverity.critical > 0) console.log(`    ${chalk.red(`Critical: ${bySeverity.critical}`)}`);
    if (bySeverity.warning > 0) console.log(`    ${chalk.yellow(`Warnings: ${bySeverity.warning}`)}`);
    if (bySeverity.info > 0) console.log(`    ${chalk.blue(`Info: ${bySeverity.info}`)}`);
  }

  if (session.changedFiles.length > 0) {
    console.log(chalk.dim('\n  Changed files:'));
    for (const f of session.changedFiles) {
      console.log(`    ${chalk.dim('•')} ${f}`);
    }
  }

  console.log('');
}

export function registerPair(program: Command): void {
  const cmd = program
    .command('pair')
    .description('Real-time collaboration/pairing mode — watches files and provides live suggestions');

  cmd
    .option('-f, --focus <dir>', 'Focus on a specific directory')
    .option('-m, --mode <mode>', 'Pairing mode: suggest|assist|silent', 'suggest')
    .action(async (opts) => {
      let swarmDir: string;
      try {
        swarmDir = requireSwarmDir();
      } catch {
        const cwd = process.cwd();
        const stack = autoDetectStack(cwd);
        const projectName = cwd.split('/').pop() || 'my-project';
        console.log(chalk.yellow(`No .swarm/ found — auto-initializing (stack: ${stack})...`));
        swarmDir = autoInit(projectName, stack, cwd);
      }

      const cwd = process.cwd();
      const mode = (['suggest', 'assist', 'silent'].includes(opts.mode) ? opts.mode : 'suggest') as 'suggest' | 'assist' | 'silent';
      const focusDir = opts.focus || undefined;

      const engine = new PairEngine(cwd, { mode, focusDir });

      console.log(chalk.bold('\nSwarm Pair — real-time collaboration mode'));
      console.log(chalk.dim(`Mode: ${mode} | Focus: ${focusDir || '.'}`));
      console.log(chalk.dim(`Watching for file changes...\n`));
      console.log(chalk.cyan('Press Ctrl+C to stop and view session summary.\n'));

      engine.on('suggestion', (suggestion: PairSuggestion) => {
        if (mode === 'silent') return;
        console.log(formatSuggestion(suggestion));
        console.log('');
      });

      engine.on('file-change', ({ file }: { file: string; timestamp: number }) => {
        if (mode !== 'silent') {
          console.log(chalk.dim(`  [change] ${file}`));
        }
      });

      engine.start();

      // Handle SIGINT gracefully
      const cleanup = () => {
        const session = engine.stop();
        printSessionSummary(session);
        process.exit(0);
      };

      process.on('SIGINT', cleanup);
      process.on('SIGTERM', cleanup);

      // Keep process alive
      await new Promise(() => {});
    });

  cmd
    .command('stop')
    .description('Stop the current pairing session')
    .action(() => {
      console.log(chalk.yellow('Pair session can be stopped with Ctrl+C in the terminal running "hivemind pair".'));
    });

  cmd
    .command('test')
    .description('Generate tests for files changed in the current pair session')
    .option('-m, --model <model>', 'Model for test generation (e.g., sonnet, openai/gpt-4o)', 'sonnet')
    .action(async (opts) => {
      let swarmDir: string;
      try {
        swarmDir = requireSwarmDir();
      } catch {
        console.log(chalk.red('No .swarm/ directory found. Run "hivemind init" first.'));
        process.exit(1);
      }

      const config = loadConfig();
      config.model = opts.model || config.model;

      console.log(chalk.bold('\nSwarm Pair Test — generating tests for recent changes'));
      console.log(chalk.dim('Analyzing changed files and generating test suggestions...\n'));

      // Use the createContext + agent spawning to generate tests
      const { createContext } = await import('./shared.js');
      const ctx = createContext(swarmDir, config);

      try {
        const agent = await ctx.agentManager.spawn({
          name: 'pair-test-gen',
          persona: 'tester',
          stack: config.stack,
          model: config.model,
          prompt: 'Analyze the recently changed files in this project and generate comprehensive test cases for any new or modified functions. Focus on edge cases and error handling. Output a test plan with specific test cases.',
          permissionMode: 'plan',
          cwd: process.cwd(),
          interactive: false,
        });

        await ctx.agentManager.waitForAgent(agent.id);
        const finalAgent = ctx.state.getState().agents.find(a => a.id === agent.id);

        if (finalAgent?.output) {
          console.log(chalk.green('\nTest suggestions:\n'));
          console.log(finalAgent.output);
        }
      } finally {
        ctx.cleanup();
      }
    });

  cmd
    .command('commit')
    .description('Generate a commit message from recent changes')
    .action(async () => {
      let swarmDir: string;
      try {
        swarmDir = requireSwarmDir();
      } catch {
        console.log(chalk.red('No .swarm/ directory found. Run "hivemind init" first.'));
        process.exit(1);
      }

      const config = loadConfig();

      console.log(chalk.bold('\nSwarm Pair Commit — generating commit message'));

      const { createContext } = await import('./shared.js');
      const ctx = createContext(swarmDir, config);

      try {
        const agent = await ctx.agentManager.spawn({
          name: 'pair-commit-msg',
          persona: 'analyst',
          stack: config.stack,
          model: config.model,
          prompt: 'Look at the current git diff (staged and unstaged) and generate a clear, concise conventional commit message. Include a short subject line and a body explaining the why. Output ONLY the commit message, nothing else.',
          permissionMode: 'plan',
          cwd: process.cwd(),
          interactive: false,
        });

        await ctx.agentManager.waitForAgent(agent.id);
        const finalAgent = ctx.state.getState().agents.find(a => a.id === agent.id);

        if (finalAgent?.output) {
          console.log(chalk.green('\nSuggested commit message:\n'));
          console.log(finalAgent.output);
          console.log(chalk.dim('\nCopy and use with: git commit -m "<message>"'));
        }
      } finally {
        ctx.cleanup();
      }
    });
}
