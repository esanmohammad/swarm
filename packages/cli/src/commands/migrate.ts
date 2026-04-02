import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import chalk from 'chalk';
import ora from 'ora';
import type { Command } from 'commander';
import type { TechStack } from '../types.js';
import { loadConfig, requireSwarmDir, autoDetectStack, autoInit } from '../core/config.js';
import { createContext } from './shared.js';

const ORM_INDICATORS: Array<{ name: string; files: string[]; pkgDeps: string[] }> = [
  { name: 'Prisma', files: ['prisma/schema.prisma'], pkgDeps: ['prisma', '@prisma/client'] },
  { name: 'TypeORM', files: ['ormconfig.json', 'ormconfig.ts'], pkgDeps: ['typeorm'] },
  { name: 'Knex', files: ['knexfile.js', 'knexfile.ts'], pkgDeps: ['knex'] },
  { name: 'Drizzle', files: ['drizzle.config.ts'], pkgDeps: ['drizzle-orm'] },
  { name: 'Sequelize', files: ['.sequelizerc'], pkgDeps: ['sequelize'] },
  { name: 'Django', files: ['manage.py'], pkgDeps: [] },
  { name: 'SQLAlchemy', files: ['alembic.ini'], pkgDeps: ['sqlalchemy', 'alembic'] },
  { name: 'goose', files: [], pkgDeps: ['goose'] },
];

export function registerMigrate(program: Command): void {
  program
    .command('migrate')
    .description('Generate and test database migrations with AI assistance')
    .argument('<description>', 'What migration to create (e.g., "add user preferences table")')
    .option('-s, --stack <stack>', 'Tech stack override')
    .option('-m, --model <model>', 'Model override (default: sonnet)')
    .option('--dry-run', 'Generate migration plan without creating files')
    .option('--review', 'Show plan for approval before generating')
    .option('-b, --budget <amount>', 'Max budget in USD', '5')
    .action(async (description: string, opts) => {
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
      config.model = opts.model || 'sonnet';
      config.maxBudgetUsd = opts.budget === 'none' ? null : (parseFloat(opts.budget) || 5);

      const cwd = process.cwd();
      const stack = (opts.stack as TechStack) || config.stack;
      const dryRun = opts.dryRun ?? false;
      const review = opts.review ?? false;

      // Detect ORM
      const orm = detectORM(cwd);
      console.log(chalk.bold(`\nSwarm Migrate`));
      console.log(chalk.dim(`ORM: ${orm || 'unknown (agent will detect)'}`));
      console.log(chalk.dim(`Model: ${config.model} | Dry run: ${dryRun}\n`));

      const { agentManager, cleanup } = createContext(swarmDir, config);

      try {
        const prompt = buildMigratePrompt(cwd, description, orm, dryRun, review);

        if (review) {
          // Step 1: Plan only
          console.log(chalk.cyan('Step 1: Generating migration plan...\n'));
          const planner = await agentManager.spawn({
            name: `migrate-planner-${stack}`,
            persona: 'engineer',
            stack,
            prompt: prompt + '\n\nDo NOT create any files yet. Only output the migration plan.',
            model: config.model,
            cwd,
            interactive: true, // allow user to approve/modify
            disallowedTools: ['Edit', 'Write', 'NotebookEdit'],
          });
          await agentManager.waitForAgent(planner.id);
        } else {
          const spinner = dryRun ? ora('Planning migration...').start() : ora('Generating migration...').start();

          const agent = await agentManager.spawn({
            name: `migrate-${stack}`,
            persona: 'engineer',
            stack,
            prompt,
            model: config.model,
            cwd,
            interactive: false,
            permissionMode: dryRun ? 'auto' : 'auto',
            disallowedTools: dryRun ? ['Edit', 'Write', 'NotebookEdit', 'Bash'] : undefined,
          });

          await agentManager.waitForAgent(agent.id);
          const cost = agent.cost.totalUsd;

          if (agent.status === 'done') {
            spinner.succeed(`Migration ${dryRun ? 'plan' : 'generation'} complete. Cost: $${cost.toFixed(2)}`);
          } else {
            spinner.fail(`Migration failed: ${agent.error || 'Unknown error'}`);
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

function detectORM(cwd: string): string | null {
  // Check files
  for (const orm of ORM_INDICATORS) {
    for (const file of orm.files) {
      if (existsSync(join(cwd, file))) return orm.name;
    }
  }
  // Check package.json deps
  try {
    const pkg = JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf-8'));
    const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
    for (const orm of ORM_INDICATORS) {
      if (orm.pkgDeps.some(dep => allDeps[dep])) return orm.name;
    }
  } catch { /* not a node project */ }
  // Check requirements.txt
  try {
    const req = readFileSync(join(cwd, 'requirements.txt'), 'utf-8');
    if (req.includes('django')) return 'Django';
    if (req.includes('alembic') || req.includes('sqlalchemy')) return 'SQLAlchemy';
  } catch { /* ignore */ }
  // Check go.mod
  try {
    const gomod = readFileSync(join(cwd, 'go.mod'), 'utf-8');
    if (gomod.includes('goose')) return 'goose';
    if (gomod.includes('golang-migrate')) return 'golang-migrate';
  } catch { /* ignore */ }
  return null;
}

function buildMigratePrompt(_cwd: string, description: string, orm: string | null, dryRun: boolean, review: boolean): string {
  const parts = [
    'You are a database migration specialist. Generate a safe database migration.',
    '',
    `Migration request: ${description}`,
    orm ? `Detected ORM/framework: ${orm}` : 'ORM not detected — analyze the project to determine the migration framework.',
    '',
    'Instructions:',
    '1. Analyze the current schema from existing migration files and models.',
    '2. Generate the migration file in the correct format for the detected ORM.',
    '3. Generate a rollback/down migration.',
    '',
    'SAFETY CHECKS — flag these issues clearly:',
    '- Destructive operations (DROP TABLE, DROP COLUMN) — require explicit confirmation',
    '- Data loss risk — suggest data preservation strategy',
    '- Large table operations — warn about lock duration',
    '- Foreign key constraint changes — validate referential integrity',
    '',
  ];

  if (dryRun) {
    parts.push(
      'DRY RUN MODE: Do NOT create or modify any files.',
      'Only output:',
      '1. Migration plan (what changes will be made)',
      '2. Safety analysis (any risks found)',
      '3. The migration SQL/code that WOULD be generated',
      '4. Rollback SQL/code',
    );
  } else if (review) {
    parts.push(
      'REVIEW MODE: Output the migration plan for human approval.',
      'Do NOT create files yet.',
    );
  } else {
    parts.push(
      'Generate the migration files, then:',
      '1. Run the migration against the development/test database',
      '2. Verify rollback works (apply → rollback → re-apply)',
      '3. Report results',
    );
  }

  return parts.join('\n');
}
