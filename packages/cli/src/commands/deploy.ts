import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join } from 'node:path';
import chalk from 'chalk';
import ora from 'ora';
import { parse as parseYaml } from 'yaml';
import type { Command } from 'commander';
import { requireSwarmDir } from '../core/config.js';

interface DeployEnv {
  build?: string;
  deploy?: string;
  healthcheck?: string;
  smoketest?: string;
  promote?: string;
  rollback?: string;
}

interface DeployConfig {
  [env: string]: DeployEnv;
}

export function registerDeploy(program: Command): void {
  program
    .command('deploy')
    .description('Deploy to staging or production using .swarm/deploy.yaml')
    .argument('<environment>', 'Target environment (staging, production, etc.)')
    .option('--approve', 'Require explicit approval before deploying (for production)')
    .option('--dry-run', 'Show what would be executed without running anything')
    .option('--skip-tests', 'Skip smoke tests after deployment')
    .option('--rollback', 'Rollback the last deployment')
    .action(async (environment: string, opts) => {
      let swarmDir: string;
      try {
        swarmDir = requireSwarmDir();
      } catch {
        console.error(chalk.red('No .swarm/ directory found. Run `hivemind init` first.'));
        process.exit(1);
      }

      const configPath = join(swarmDir, 'deploy.yaml');
      if (!existsSync(configPath)) {
        console.error(chalk.red(`No deploy config found at ${configPath}`));
        console.log(chalk.dim('\nCreate .swarm/deploy.yaml with your deployment steps:'));
        console.log(chalk.dim(`
staging:
  build: "docker build -t app:staging ."
  deploy: "kubectl apply -f k8s/staging/"
  healthcheck: "curl -f http://staging.internal/health"
  smoketest: "npx playwright test --config=e2e/staging.config.ts"

production:
  promote: "kubectl set image deployment/app app=app:staging"
  healthcheck: "curl -f http://prod.internal/health"
  rollback: "kubectl rollout undo deployment/app"
`));
        process.exit(1);
      }

      let deployConfig: DeployConfig;
      try {
        deployConfig = parseYaml(readFileSync(configPath, 'utf-8'));
      } catch (err) {
        console.error(chalk.red(`Failed to parse deploy.yaml: ${err instanceof Error ? err.message : err}`));
        process.exit(1);
      }

      const envConfig = deployConfig[environment];
      if (!envConfig) {
        console.error(chalk.red(`Environment "${environment}" not found in deploy.yaml`));
        console.log(chalk.dim(`Available: ${Object.keys(deployConfig).join(', ')}`));
        process.exit(1);
      }

      // Rollback mode
      if (opts.rollback) {
        if (!envConfig.rollback) {
          console.error(chalk.red(`No rollback command defined for "${environment}"`));
          process.exit(1);
        }
        console.log(chalk.yellow(`\nRolling back ${environment}...`));
        if (!opts.dryRun) {
          runStep('rollback', envConfig.rollback, opts.dryRun);
        }
        return;
      }

      // Production approval gate
      if (environment === 'production' && !opts.approve) {
        console.error(chalk.red('Production deployments require --approve flag.'));
        console.log(chalk.dim('Run: swarm deploy production --approve'));
        process.exit(1);
      }

      console.log(chalk.bold(`\nSwarm Deploy — ${environment}`));
      if (opts.dryRun) console.log(chalk.yellow('(dry run — no commands will be executed)\n'));

      const steps: Array<{ name: string; cmd: string }> = [];
      if (envConfig.build) steps.push({ name: 'Build', cmd: envConfig.build });
      if (envConfig.deploy) steps.push({ name: 'Deploy', cmd: envConfig.deploy });
      if (envConfig.promote) steps.push({ name: 'Promote', cmd: envConfig.promote });
      if (envConfig.healthcheck) steps.push({ name: 'Healthcheck', cmd: envConfig.healthcheck });
      if (envConfig.smoketest && !opts.skipTests) steps.push({ name: 'Smoke test', cmd: envConfig.smoketest });

      let failed = false;
      const results: Array<{ name: string; status: 'pass' | 'fail' | 'skip'; durationMs: number }> = [];

      for (const step of steps) {
        const start = Date.now();
        const success = runStep(step.name, step.cmd, opts.dryRun);
        results.push({
          name: step.name,
          status: opts.dryRun ? 'skip' : (success ? 'pass' : 'fail'),
          durationMs: Date.now() - start,
        });

        if (!success && !opts.dryRun) {
          failed = true;
          console.log(chalk.red(`\n  ${step.name} failed!`));

          // Auto-rollback
          if (envConfig.rollback) {
            console.log(chalk.yellow('  Auto-rolling back...'));
            runStep('Rollback', envConfig.rollback, false);
          }

          // Save failure report
          const report = [
            `# Deployment Failure Report`,
            '',
            `Environment: ${environment}`,
            `Failed step: ${step.name}`,
            `Command: \`${step.cmd}\``,
            `Timestamp: ${new Date().toISOString()}`,
            '',
            '## Steps',
            ...results.map(r => `- ${r.name}: ${r.status} (${r.durationMs}ms)`),
            '',
            envConfig.rollback ? '## Rollback executed automatically' : '## No rollback configured',
          ].join('\n');
          writeFileSync(join(swarmDir, '..', 'DEPLOY-FAILURE.md'), report, 'utf-8');
          console.log(chalk.dim('  Failure report saved to DEPLOY-FAILURE.md'));
          break;
        }
      }

      if (!failed) {
        console.log(chalk.green(`\n  Deployment to ${environment} successful!`));
        console.log(chalk.dim(`  Steps: ${results.map(r => `${r.name} (${r.durationMs}ms)`).join(' → ')}`));
      }
    });
}

function runStep(name: string, cmd: string, dryRun: boolean): boolean {
  const spinner = ora(`${name}: ${cmd}`).start();

  if (dryRun) {
    spinner.info(`${name}: ${chalk.dim(cmd)} (dry run)`);
    return true;
  }

  try {
    execSync(cmd, { stdio: 'pipe', cwd: process.cwd(), timeout: 300000 });
    spinner.succeed(`${name}`);
    return true;
  } catch (err: unknown) {
    const e = err as { stderr?: string; stdout?: string };
    const output = (e.stderr || e.stdout || '').slice(-500);
    spinner.fail(`${name}: ${output || 'command failed'}`);
    return false;
  }
}

/** Export for dashboard */
export function loadDeployConfig(swarmDir: string): DeployConfig | null {
  const configPath = join(swarmDir, 'deploy.yaml');
  if (!existsSync(configPath)) return null;
  try {
    return parseYaml(readFileSync(configPath, 'utf-8'));
  } catch {
    return null;
  }
}
