import { execSync } from 'node:child_process';
import chalk from 'chalk';

/**
 * Checks that the `claude` CLI is installed and reachable.
 * Prints a helpful message and exits if not found.
 * Call this before any command that spawns Claude processes.
 */
export function requireClaudeCli(): void {
  // Check if claude is in PATH
  try {
    execSync('which claude', { stdio: ['pipe', 'pipe', 'pipe'] });
  } catch {
    console.error(chalk.red('\nClaude CLI not found.\n'));
    console.error('Swarm requires the Claude Code CLI to run agents.');
    console.error('Install it with:\n');
    console.error(chalk.cyan('  npm install -g @anthropic-ai/claude-code\n'));
    console.error('Then authenticate:\n');
    console.error(chalk.cyan('  claude\n'));
    console.error(`Run ${chalk.bold('hivemind doctor')} to verify your setup.`);
    process.exit(1);
  }

  // Check if claude is authenticated (--version works without auth, but we can at least verify it runs)
  try {
    execSync('claude --version', { stdio: ['pipe', 'pipe', 'pipe'] });
  } catch {
    console.error(chalk.red('\nClaude CLI found but not working.\n'));
    console.error('Try re-authenticating:\n');
    console.error(chalk.cyan('  claude\n'));
    console.error(`Run ${chalk.bold('hivemind doctor')} for more details.`);
    process.exit(1);
  }
}
