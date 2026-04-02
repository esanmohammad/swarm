import { Command } from 'commander';
import chalk from 'chalk';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import ora from 'ora';
import type { TechStack, OnboardData } from '../types.js';
import { loadConfig, requireSwarmDir, autoDetectStack, autoInit } from '../core/config.js';
import { createContext } from './shared.js';
import { scanCodebase } from '../core/codebase-scanner.js';
import { loadConventions } from './learn.js';

const MENTOR_SYSTEM_PROMPT = [
  'You are a senior engineering mentor. Your goal is to TEACH and EXPLAIN, not just answer.',
  '',
  'When answering questions:',
  '- Explain the "why" behind things, not just the "what"',
  '- Use analogies and examples from the actual codebase',
  '- Point to specific files and line numbers',
  '- Suggest follow-up topics the developer should explore',
  '- If the question reveals a misunderstanding, gently correct it',
  '',
  'When reviewing code:',
  '- Focus on learning opportunities, not just errors',
  '- Explain the reasoning behind best practices',
  '- Suggest concrete improvements with examples',
  '- Highlight what the developer did well (positive reinforcement)',
  '',
  'When explaining code:',
  '- Start with the big picture, then zoom in',
  '- Trace the flow of data through the system',
  '- Explain design decisions and trade-offs',
  '- Suggest related areas to explore next',
  '',
  'Always read the actual source files before answering. Do NOT guess.',
].join('\n');

export function registerMentor(program: Command): void {
  const mentorCmd = program
    .command('mentor')
    .description('AI mentor — ask questions, get educational code reviews, or deep-dive into areas')
    .argument('[question...]', 'Ask a contextual question about the codebase')
    .option('-s, --stack <stack>', 'Tech stack override')
    .option('-m, --model <model>', 'Model override (default: sonnet)')
    .option('-b, --budget <amount>', 'Max budget in USD', '3')
    .option('-i, --interactive', 'Interactive mode — follow-up Q&A in terminal')
    .action(async (questionParts: string[], opts) => {
      const question = questionParts.join(' ');
      if (!question) {
        console.log(chalk.yellow('Usage: swarm mentor <question>'));
        console.log(chalk.dim('  swarm mentor "How does authentication work?"'));
        console.log(chalk.dim('  swarm mentor review'));
        console.log(chalk.dim('  swarm mentor explain src/core/pipeline.ts'));
        return;
      }

      await runMentor(question, opts, 'question');
    });

  // Subcommand: review
  mentorCmd
    .command('review')
    .description('Educational code review of staged or recent changes')
    .option('-s, --stack <stack>', 'Tech stack override')
    .option('-m, --model <model>', 'Model override (default: sonnet)')
    .option('-b, --budget <amount>', 'Max budget in USD', '3')
    .option('--file <path>', 'Review a specific file instead of staged changes')
    .option('--commit <sha>', 'Review a specific commit')
    .action(async (opts) => {
      await runMentor('', opts, 'review');
    });

  // Subcommand: explain
  mentorCmd
    .command('explain <path>')
    .description('Deep educational dive into a file or directory')
    .option('-s, --stack <stack>', 'Tech stack override')
    .option('-m, --model <model>', 'Model override (default: sonnet)')
    .option('-b, --budget <amount>', 'Max budget in USD', '3')
    .option('-i, --interactive', 'Interactive mode — follow-up Q&A in terminal')
    .action(async (path: string, opts) => {
      await runMentor(path, opts, 'explain');
    });
}

async function runMentor(
  input: string,
  opts: Record<string, unknown>,
  mode: 'question' | 'review' | 'explain',
): Promise<void> {
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
  config.model = (opts.model as string) || 'sonnet';
  const budgetStr = (opts.budget as string) || '3';
  config.maxBudgetUsd = budgetStr === 'none' ? null : (parseFloat(budgetStr) || 3);

  const cwd = process.cwd();
  const stack = (opts.stack as TechStack) || config.stack;
  const interactive = (opts.interactive as boolean) ?? false;
  const { agentManager, cleanup } = createContext(swarmDir, config);

  try {
    const prompt = buildMentorPrompt(cwd, swarmDir, input, mode, stack, opts, config.packages);
    const modeLabel = {
      question: `Answering: ${input.slice(0, 80)}`,
      review: opts.file ? `Reviewing: ${opts.file}` : 'Educational code review',
      explain: `Deep dive: ${input}`,
    }[mode];

    console.log(chalk.bold('\nSwarm Mentor'));
    console.log(chalk.dim(`${modeLabel}`));
    console.log(chalk.dim(`Model: ${config.model} | Stack: ${stack}\n`));

    if (interactive) {
      const agent = await agentManager.spawn({
        name: `mentor-${mode}`,
        persona: 'engineer',
        stack,
        prompt,
        model: config.model,
        cwd,
        interactive: true,
        disallowedTools: ['Edit', 'Write', 'NotebookEdit', 'Bash'],
      });

      await agentManager.waitForAgent(agent.id);
      saveMentorHistory(swarmDir, mode, input, agent.output);
    } else {
      const spinner = ora('Thinking...').start();

      const agent = await agentManager.spawn({
        name: `mentor-${mode}`,
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
        spinner.succeed(`Done. Cost: $${cost.toFixed(2)}`);
        saveMentorHistory(swarmDir, mode, input, agent.output);
      } else {
        spinner.fail(`Mentor failed: ${agent.error || 'Unknown error'}`);
      }
    }
  } catch (err) {
    console.error(chalk.red(err instanceof Error ? err.message : String(err)));
    process.exit(1);
  } finally {
    cleanup();
  }
}

function buildMentorPrompt(
  cwd: string,
  swarmDir: string,
  input: string,
  mode: 'question' | 'review' | 'explain',
  stack: TechStack,
  opts: Record<string, unknown>,
  packages?: string[],
): string {
  const parts: string[] = [];

  // Codebase context
  const codebaseCtx = scanCodebase(cwd, packages);
  if (codebaseCtx) parts.push(codebaseCtx);

  // Conventions
  const conventions = loadConventions(swarmDir);
  if (conventions) parts.push(conventions);

  // Mentor system prompt
  parts.push('', MENTOR_SYSTEM_PROMPT, '');

  switch (mode) {
    case 'question':
      parts.push(
        'TASK: Answer the following question about this codebase in a teaching/mentoring style.',
        '',
        `QUESTION: "${input}"`,
        '',
        'Instructions:',
        '1. Read relevant source files to give an accurate answer',
        '2. Explain the "why" behind the answer, not just the "what"',
        '3. Point to specific files and code locations',
        '4. Suggest 2-3 follow-up topics the developer should explore',
        '5. If the question touches on a design decision, explain the trade-offs',
      );
      break;

    case 'review': {
      parts.push(
        'TASK: Educational code review — teach through reviewing code.',
        '',
      );

      if (opts.file) {
        parts.push(
          `Review the file: ${opts.file}`,
          '',
          'Instructions:',
          '1. Read the file and understand its purpose in the project',
          '2. Review for: correctness, patterns, readability, performance, security',
          '3. For each finding, EXPLAIN why it matters (teach, don\'t just critique)',
          '4. Highlight good practices the developer used',
          '5. Suggest concrete improvements with code examples',
          '6. Rate overall quality and suggest priority improvements',
        );
      } else if (opts.commit) {
        parts.push(
          `Review the changes in commit: ${opts.commit}`,
          '',
          `Run: git show ${opts.commit}`,
          '',
          'Instructions:',
          '1. Understand the intent of the commit',
          '2. Review changes for: correctness, patterns, edge cases',
          '3. Explain any concerns in a teaching style',
          '4. Highlight good decisions in the commit',
        );
      } else {
        parts.push(
          'Review the currently staged changes (git diff --staged) or recent uncommitted changes (git diff).',
          '',
          'Run: git diff --staged (or git diff if nothing is staged)',
          '',
          'Instructions:',
          '1. Understand what the changes are trying to accomplish',
          '2. Review for: correctness, consistency with project patterns, edge cases',
          '3. Teach about any patterns being broken or improved',
          '4. Highlight good practices in the changes',
          '5. Suggest improvements with explanations',
        );
      }
      break;
    }

    case 'explain':
      parts.push(
        `TASK: Educational deep-dive into: ${input}`,
        '',
        'Instructions:',
        '1. Read the file/directory and understand its role in the project',
        '2. Start with the big picture — what problem does this solve?',
        '3. Walk through the code structure, explaining each key part',
        '4. Trace the data flow through this module',
        '5. Explain design decisions and trade-offs',
        '6. Show how this connects to the rest of the codebase',
        '7. Point out patterns a new developer should learn from this code',
        '8. Suggest related areas to explore next',
        '',
        'Think of this as a pairing session where you\'re walking a junior developer through the code.',
      );
      break;
  }

  return parts.filter(Boolean).join('\n');
}

function saveMentorHistory(
  swarmDir: string,
  mode: string,
  input: string,
  output: string,
): void {
  try {
    const progressPath = join(swarmDir, 'onboard-progress.json');
    let progress: OnboardData;

    if (existsSync(progressPath)) {
      progress = JSON.parse(readFileSync(progressPath, 'utf-8'));
    } else {
      progress = {
        step: 0,
        totalSteps: 5,
        currentTopic: '',
        content: '',
        completed: [],
        remaining: [],
        mentorHistory: [],
      };
    }

    progress.mentorHistory.push({
      question: `[${mode}] ${input}`,
      answer: output.slice(0, 1000),
      timestamp: Date.now(),
    });

    // Keep last 50 entries
    if (progress.mentorHistory.length > 50) {
      progress.mentorHistory = progress.mentorHistory.slice(-50);
    }

    const dir = join(progressPath, '..');
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(progressPath, JSON.stringify(progress, null, 2), 'utf-8');
  } catch {
    // Non-critical — don't fail the command
  }
}
