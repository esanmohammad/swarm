import { createInterface, Interface } from 'node:readline';
import chalk from 'chalk';

/**
 * Non-blocking stdin listener for pipeline stages.
 * Allows users to send input to running agents or control the pipeline
 * without the stage being in "interactive" mode (which uses stdio: 'inherit').
 *
 * This is the key difference from interactive mode:
 * - Interactive mode: agent process owns stdin/stdout directly
 * - Input listener: agent runs headless, but user CAN type when they want to
 */
export class InputListener {
  private rl: Interface | null = null;
  private onInput: ((text: string) => void) | null = null;
  private paused = false;

  /**
   * Start listening for user input on stdin.
   * Each line triggers the callback.
   */
  start(onInput: (text: string) => void): void {
    if (this.rl) return; // Already listening
    if (!process.stdin.isTTY) return; // Not a terminal (CI, piped input)

    this.onInput = onInput;
    this.rl = createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: '',
      terminal: false,
    });

    // Don't let readline keep the process alive
    process.stdin.unref();

    this.rl.on('line', (line) => {
      if (this.paused) return;
      const trimmed = line.trim();
      if (trimmed && this.onInput) {
        this.onInput(trimmed);
      }
    });
  }

  /** Temporarily pause input handling (e.g., during stage transitions) */
  pause(): void {
    this.paused = true;
  }

  /** Resume input handling */
  resume(): void {
    this.paused = false;
  }

  /** Stop listening and clean up */
  stop(): void {
    if (this.rl) {
      this.rl.close();
      this.rl = null;
    }
    this.onInput = null;
    this.paused = false;
  }
}

/**
 * Prompt the user for input with a message.
 * Returns their response, or empty string if they just press Enter.
 * Returns null if stdin is not a TTY (non-interactive/CI).
 */
export function promptUser(message: string): Promise<string | null> {
  if (!process.stdin.isTTY) return Promise.resolve(null);

  return new Promise((resolve) => {
    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    rl.question(message, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

/**
 * Pause between stages — let the user review, send feedback, or just press Enter to continue.
 * Returns any feedback the user typed, or null if they just pressed Enter or stdin isn't a TTY.
 */
export async function stageTransitionPause(
  completedStage: string,
  nextStage: string,
  artifact?: string | null,
): Promise<string | null> {
  if (!process.stdin.isTTY) return null;

  const parts = [
    chalk.green(`  ✓ ${completedStage} complete`),
  ];
  if (artifact) {
    parts.push(chalk.dim(`    → ${artifact}`));
  }
  parts.push('');
  parts.push(chalk.dim(`  Next: ${nextStage}`));
  parts.push(chalk.dim(`  Press Enter to continue, or type feedback for the next stage:`));

  console.log(parts.join('\n'));

  const response = await promptUser(chalk.cyan('  > '));
  return response || null;
}

/**
 * Pause during fix loop — let the user guide the fix, skip, or continue.
 * Returns { action: 'continue' | 'skip', feedback?: string }
 */
export async function fixLoopPause(
  iteration: number,
  maxIterations: number,
  failureCount: number,
): Promise<{ action: 'continue' | 'skip'; feedback?: string }> {
  if (!process.stdin.isTTY) return { action: 'continue' };

  console.log('');
  console.log(chalk.dim(`  Fix attempt ${iteration}/${maxIterations} — ${failureCount} test failure(s) remaining`));
  console.log(chalk.dim(`  Press Enter to continue, type guidance, or 's' to skip fix loop:`));

  const response = await promptUser(chalk.cyan('  > '));

  if (response === 's' || response === 'skip') {
    return { action: 'skip' };
  }
  return { action: 'continue', feedback: response || undefined };
}
