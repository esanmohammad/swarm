import { Command } from 'commander';
import chalk from 'chalk';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import ora from 'ora';
import type { TechStack, OnboardData } from '../types.js';
import { loadConfig, requireSwarmDir, autoDetectStack, autoInit } from '../core/config.js';
import { createContext } from './shared.js';
import { scanCodebase } from '../core/codebase-scanner.js';
import { loadConventions } from './learn.js';

const ONBOARD_STEPS = [
  'project-overview',
  'dev-workflow',
  'key-areas',
  'conventions',
  'common-pitfalls',
] as const;

const STEP_LABELS: Record<string, string> = {
  'project-overview': 'Project Overview',
  'dev-workflow': 'Development Workflow',
  'key-areas': 'Key Areas Tour',
  'conventions': 'Conventions & Patterns',
  'common-pitfalls': 'Common Pitfalls',
};

export function registerOnboard(program: Command): void {
  program
    .command('onboard')
    .description('Start guided onboarding tour of the codebase')
    .option('-s, --stack <stack>', 'Tech stack override')
    .option('-m, --model <model>', 'Model override (e.g., sonnet, openai/gpt-4o, ollama/llama3)')
    .option('-r, --role <role>', 'Role-specific onboarding: frontend, backend, fullstack')
    .option('-a, --area <name>', 'Area-specific deep dive (e.g. api, auth, database)')
    .option('--reset', 'Reset onboarding progress and start fresh')
    .option('-b, --budget <amount>', 'Max budget in USD', '5')
    .option('--step <number>', 'Jump to a specific step (1-5)')
    .action(async (opts) => {
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
      config.model = opts.model || config.model;
      config.maxBudgetUsd = opts.budget === 'none' ? null : (parseFloat(opts.budget) || 5);

      const cwd = process.cwd();
      const stack = (opts.stack as TechStack) || config.stack;
      const role = opts.role as 'frontend' | 'backend' | 'fullstack' | undefined;
      const area = opts.area as string | undefined;
      const progressPath = join(swarmDir, 'onboard-progress.json');

      // Load or initialize progress
      let progress = loadProgress(progressPath);
      if (opts.reset) {
        progress = createFreshProgress();
        saveProgress(progressPath, progress);
        console.log(chalk.yellow('Onboarding progress reset.'));
      }

      // If area-specific deep dive, skip the normal flow
      if (area) {
        await runAreaDeepDive(swarmDir, config, cwd, stack, area, role);
        return;
      }

      // Determine starting step
      let startStep = 0;
      if (opts.step) {
        startStep = Math.max(0, Math.min(ONBOARD_STEPS.length - 1, parseInt(opts.step, 10) - 1));
      } else {
        // Resume from where we left off
        startStep = progress.completed.length;
        if (startStep >= ONBOARD_STEPS.length) {
          console.log(chalk.green('\nOnboarding already complete! Use --reset to start over.\n'));
          printProgress(progress);
          return;
        }
      }

      console.log(chalk.bold('\nSwarm Onboarding Tour'));
      console.log(chalk.dim(`Model: ${config.model} | Stack: ${stack} | Role: ${role || 'general'}`));
      if (progress.completed.length > 0) {
        console.log(chalk.dim(`Resuming from step ${startStep + 1}/${ONBOARD_STEPS.length}`));
      }
      console.log('');

      const { agentManager, cleanup } = createContext(swarmDir, config);

      try {
        for (let i = startStep; i < ONBOARD_STEPS.length; i++) {
          const stepName = ONBOARD_STEPS[i];
          const stepLabel = STEP_LABELS[stepName];

          console.log(chalk.bold.cyan(`\n--- Step ${i + 1}/${ONBOARD_STEPS.length}: ${stepLabel} ---\n`));

          const prompt = buildStepPrompt(cwd, swarmDir, stepName, stack, role, config.packages);

          const agent = await agentManager.spawn({
            name: `onboard-${stepName}`,
            persona: 'engineer',
            stack,
            prompt,
            model: config.model,
            cwd,
            interactive: true,
            disallowedTools: ['Edit', 'Write', 'NotebookEdit'],
          });

          await agentManager.waitForAgent(agent.id);

          // Update progress
          if (!progress.completed.includes(stepName)) {
            progress.completed.push(stepName);
          }
          progress.remaining = ONBOARD_STEPS.filter(s => !progress.completed.includes(s));
          progress.step = i + 1;
          progress.totalSteps = ONBOARD_STEPS.length;
          progress.currentTopic = stepLabel;
          progress.content = agent.output.slice(0, 2000);
          saveProgress(progressPath, progress);

          if (i < ONBOARD_STEPS.length - 1) {
            console.log(chalk.dim(`\nProgress saved. ${ONBOARD_STEPS.length - i - 1} steps remaining.`));
          }
        }

        console.log(chalk.bold.green('\n\nOnboarding complete!'));
        console.log(chalk.dim(`Progress saved to ${progressPath}`));
        printProgress(progress);
      } catch (err) {
        console.error(chalk.red(err instanceof Error ? err.message : String(err)));
        saveProgress(progressPath, progress);
        console.log(chalk.yellow('Progress saved. Run `hivemind onboard` to resume.'));
        process.exit(1);
      } finally {
        cleanup();
      }
    });
}

function buildStepPrompt(
  cwd: string,
  swarmDir: string,
  step: string,
  stack: TechStack,
  role: string | undefined,
  packages?: string[],
): string {
  const parts: string[] = [];

  // Base context
  const codebaseCtx = scanCodebase(cwd, packages);
  if (codebaseCtx) parts.push(codebaseCtx);

  const conventions = loadConventions(swarmDir);
  if (conventions) parts.push(conventions);

  // Role context
  const roleCtx = role
    ? `The developer being onboarded is a ${role} engineer. Focus your explanations on areas most relevant to their role.`
    : 'The developer being onboarded is a general contributor.';
  parts.push(roleCtx);

  parts.push('');
  parts.push('You are an onboarding guide helping a new developer understand this codebase.');
  parts.push('Be welcoming, thorough, and practical. Use concrete examples from the actual code.');
  parts.push('Read the relevant files to give accurate information. Do NOT guess.');
  parts.push('');

  switch (step) {
    case 'project-overview':
      parts.push(
        'TASK: Project Overview — The first step of onboarding.',
        '',
        'Cover:',
        '1. What the project does and who uses it',
        '2. High-level architecture (read package.json, README.md, and entry points)',
        '3. Repository structure — key directories and what lives where',
        '4. Tech stack — languages, frameworks, major dependencies',
        '5. How to set up the project locally (install, build, run)',
        '',
        'Read package.json, README.md, and any architecture docs. Explore the top-level directory structure.',
        'Present as a friendly onboarding guide, not a dry documentation dump.',
      );
      break;

    case 'dev-workflow':
      parts.push(
        'TASK: Development Workflow — How to work in this codebase day-to-day.',
        '',
        'Cover:',
        '1. Build process (read build scripts in package.json or Makefile)',
        '2. Test workflow (how to run tests, test structure)',
        '3. CI/CD pipeline (read .github/workflows/ or CI config if exists)',
        '4. Git workflow (branching strategy, PR process)',
        '5. Local development tips (dev servers, hot reload, debugging)',
        '',
        'Read the actual build scripts, CI configs, and any contributing guides.',
      );
      break;

    case 'key-areas':
      parts.push(
        'TASK: Key Areas Tour — The most important modules and how they connect.',
        '',
        'Cover:',
        '1. Find the most-imported/referenced modules (core abstractions)',
        '2. Explain each key module: what it does, its public API, how it connects to others',
        '3. Data flow — how data moves through the system',
        '4. Entry points — where requests/commands/events enter the system',
        '5. Extension points — where new features are typically added',
        '',
        'Read the actual source files. Focus on the 5-8 most important modules.',
      );
      break;

    case 'conventions':
      parts.push(
        'TASK: Conventions & Patterns — The unwritten (and written) rules of this codebase.',
        '',
        'Cover:',
        '1. Coding conventions (naming, file structure, import patterns)',
        '2. Architectural patterns (how new features should be structured)',
        '3. Error handling patterns',
        '4. Configuration patterns',
        '5. Read .swarm/conventions.md if it exists for explicit conventions',
        '',
        'Read actual source files to identify patterns. Give concrete examples.',
      );

      // Include conventions file if it exists
      const convPath = join(swarmDir, 'conventions.md');
      if (existsSync(convPath)) {
        try {
          const convContent = readFileSync(convPath, 'utf-8').slice(0, 5000);
          parts.push('', 'EXISTING CONVENTIONS FILE (.swarm/conventions.md):', convContent);
        } catch { /* skip */ }
      }
      break;

    case 'common-pitfalls':
      parts.push(
        'TASK: Common Pitfalls — Things that catch new developers off guard.',
        '',
        'Cover:',
        '1. Known gotchas (read CLAUDE.md or similar docs for documented gotchas)',
        '2. Tricky configurations or environment requirements',
        '3. Common mistakes new contributors make (infer from code patterns)',
        '4. Performance traps or anti-patterns to avoid',
        '5. If .swarm/journal/ exists, read decision entries for context on past decisions',
        '',
        'Be specific and actionable. For each pitfall, explain what goes wrong and how to avoid it.',
      );

      // Include journal entries if they exist
      const journalDir = join(swarmDir, 'journal');
      if (existsSync(journalDir)) {
        try {
          const entries = execSync(`ls -t "${journalDir}" | head -5`, { encoding: 'utf-8', cwd }).trim();
          if (entries) {
            parts.push('', 'RECENT DECISION JOURNAL ENTRIES:', entries);
          }
        } catch { /* skip */ }
      }
      break;
  }

  return parts.filter(Boolean).join('\n');
}

async function runAreaDeepDive(
  swarmDir: string,
  config: ReturnType<typeof loadConfig>,
  cwd: string,
  stack: TechStack,
  area: string,
  role: string | undefined,
): Promise<void> {
  console.log(chalk.bold(`\nSwarm Onboard — Deep Dive: ${area}`));
  console.log(chalk.dim(`Model: ${config.model} | Stack: ${stack}\n`));

  const { agentManager, cleanup } = createContext(swarmDir, config);

  try {
    const parts: string[] = [];
    const codebaseCtx = scanCodebase(cwd, config.packages);
    if (codebaseCtx) parts.push(codebaseCtx);

    const conventions = loadConventions(swarmDir);
    if (conventions) parts.push(conventions);

    if (role) {
      parts.push(`The developer is a ${role} engineer. Tailor explanations accordingly.`);
    }

    parts.push(
      '',
      'You are an onboarding guide doing a deep dive into a specific area of the codebase.',
      '',
      `TASK: Deep dive into the "${area}" area of this project.`,
      '',
      'Cover:',
      `1. Find all files/modules related to "${area}"`,
      '2. Explain the architecture of this area in detail',
      '3. Key abstractions and their relationships',
      '4. How this area connects to the rest of the codebase',
      '5. How to make changes in this area (patterns to follow)',
      '6. Tests related to this area and how to run them',
      '7. Common pitfalls specific to this area',
      '',
      'Read the actual source files. Be thorough and specific.',
    );

    const agent = await agentManager.spawn({
      name: `onboard-deepdive-${area}`,
      persona: 'engineer',
      stack,
      prompt: parts.filter(Boolean).join('\n'),
      model: config.model,
      cwd,
      interactive: true,
      disallowedTools: ['Edit', 'Write', 'NotebookEdit'],
    });

    await agentManager.waitForAgent(agent.id);
  } catch (err) {
    console.error(chalk.red(err instanceof Error ? err.message : String(err)));
    process.exit(1);
  } finally {
    cleanup();
  }
}

function loadProgress(path: string): OnboardData {
  if (existsSync(path)) {
    try {
      return JSON.parse(readFileSync(path, 'utf-8'));
    } catch { /* corrupted, start fresh */ }
  }
  return createFreshProgress();
}

function createFreshProgress(): OnboardData {
  return {
    step: 0,
    totalSteps: ONBOARD_STEPS.length,
    currentTopic: '',
    content: '',
    completed: [],
    remaining: [...ONBOARD_STEPS],
    mentorHistory: [],
  };
}

function saveProgress(path: string, data: OnboardData): void {
  const dir = join(path, '..');
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(path, JSON.stringify(data, null, 2), 'utf-8');
}

function printProgress(progress: OnboardData): void {
  console.log('');
  for (const step of ONBOARD_STEPS) {
    const done = progress.completed.includes(step);
    const icon = done ? chalk.green('[x]') : chalk.dim('[ ]');
    console.log(`  ${icon} ${STEP_LABELS[step]}`);
  }
  console.log('');
}
