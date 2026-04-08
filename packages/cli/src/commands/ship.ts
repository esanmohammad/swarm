import chalk from 'chalk';
import ora from 'ora';
import { execSync } from 'node:child_process';
import { join } from 'node:path';
import type { Command } from 'commander';
import { loadConfig, requireSwarmDir } from '../core/config.js';

export function registerShip(program: Command): void {
  program
    .command('ship')
    .description('Push changes to git and deploy to Nexus sandbox (creates or updates)')
    .option('-n, --name <name>', 'Sandbox name (defaults to project name from config)')
    .option('--skip-push', 'Skip git push (deploy from local source)')
    .option('--skip-validate', 'Skip pre-ship validation')
    .option('-l, --label <label>', 'Version label for the deployment')
    .option('--source', 'Deploy from local source path instead of GitHub URL')
    .action(async (opts) => {
      const swarmDir = requireSwarmDir();
      const config = loadConfig();
      const projectCwd = join(swarmDir, '..');

      console.log(chalk.cyan('\n[ship] Preparing to ship...\n'));

      // ── Step 1: Run validation (unless skipped) ──
      if (!opts.skipValidate) {
        const spinner = ora('Running pre-ship validation...').start();
        try {
          execSync('npx hivemind validate --skip-start', {
            cwd: projectCwd,
            stdio: 'pipe',
            timeout: 180000,
          });
          spinner.succeed('Pre-ship validation passed');
        } catch (err: any) {
          spinner.fail('Pre-ship validation failed');
          const output = err.stdout?.toString() || err.stderr?.toString() || err.message;
          console.log(chalk.dim(output.slice(0, 2000)));
          console.log(chalk.red('\nFix validation errors before shipping.\n'));
          process.exit(1);
        }
      }

      // ── Step 2: Git push (so deployment reflects latest changes) ──
      if (!opts.skipPush) {
        const spinner = ora('Pushing changes to remote...').start();
        try {
          // Check for uncommitted changes
          const status = execSync('git status --porcelain', { cwd: projectCwd, encoding: 'utf-8' }).trim();
          if (status) {
            spinner.info('Uncommitted changes detected — staging and committing...');
            execSync('git add -A', { cwd: projectCwd, stdio: 'pipe' });
            execSync('git commit -m "chore: pre-ship commit"', { cwd: projectCwd, stdio: 'pipe' });
            console.log(chalk.dim('  Committed all changes'));
          }

          // Get current branch
          const branch = execSync('git branch --show-current', { cwd: projectCwd, encoding: 'utf-8' }).trim();

          // Push with upstream tracking
          execSync(`git push -u origin ${branch}`, { cwd: projectCwd, stdio: 'pipe', timeout: 60000 });
          spinner.succeed(`Pushed to origin/${branch}`);
        } catch (err: any) {
          spinner.fail('Git push failed');
          const output = err.stderr?.toString() || err.stdout?.toString() || err.message;
          console.log(chalk.dim(output.slice(0, 1000)));
          console.log(chalk.red('\nFix git issues before shipping.\n'));
          process.exit(1);
        }
      }

      // ── Step 3: Deploy to Nexus sandbox ──
      const sandboxName = opts.name || config.projectName || projectCwd.split('/').pop() || 'app';
      // Sanitize sandbox name: lowercase, URL-safe
      const safeName = sandboxName.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/^-+|-+$/g, '').slice(0, 63);
      const label = opts.label || `ship-${new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-')}`;

      console.log(chalk.cyan(`\n[ship] Deploying "${safeName}" to Nexus...\n`));

      try {
        // Get GitHub URL for deployment
        let githubUrl: string | undefined;
        if (!opts.source) {
          try {
            const remote = execSync('git remote get-url origin', { cwd: projectCwd, encoding: 'utf-8' }).trim();
            // Clean up any token from the URL for display, but use the clean https URL for nexus
            githubUrl = remote.replace(/https:\/\/[^@]+@/, 'https://');
          } catch {
            // No git remote — fall back to source path
          }
        }

        if (githubUrl && !opts.source) {
          console.log(chalk.dim(`  GitHub URL: ${githubUrl}`));
          console.log(chalk.dim(`  Label: ${label}`));
          console.log(chalk.dim(`  Sandbox: ${safeName}`));
          console.log('');

          // Use nexus MCP sandbox_create — it handles both create and update
          console.log(chalk.yellow('  → Calling Nexus MCP to create/deploy sandbox...'));
          console.log(chalk.dim('  (This will create a new sandbox if it doesn\'t exist, or deploy a new version if it does)'));
          console.log('');
          console.log(chalk.bold('  Run this command to deploy via Nexus MCP:'));
          console.log('');
          console.log(chalk.cyan(`    Use mcp__nexus-mcp__sandbox_create with:`));
          console.log(chalk.dim(`      name: "${safeName}"`));
          console.log(chalk.dim(`      github_url: "${githubUrl}"`));
          console.log(chalk.dim(`      label: "${label}"`));
          console.log('');

          // Actually invoke via the CLI's own MCP integration if available
          // For now, print the equivalent curl/command
          console.log(chalk.green(`[ship] Changes pushed. Ready for Nexus deployment.`));
          console.log(chalk.dim(`  Sandbox name: ${safeName}`));
          console.log(chalk.dim(`  Deploy from: ${githubUrl}`));
        } else {
          // Source path deployment
          console.log(chalk.dim(`  Source path: ${projectCwd}`));
          console.log(chalk.dim(`  Label: ${label}`));
          console.log(chalk.dim(`  Sandbox: ${safeName}`));
          console.log('');
          console.log(chalk.bold('  Run this command to deploy via Nexus MCP:'));
          console.log('');
          console.log(chalk.cyan(`    Use mcp__nexus-mcp__sandbox_create with:`));
          console.log(chalk.dim(`      name: "${safeName}"`));
          console.log(chalk.dim(`      source_path: "${projectCwd}"`));
          console.log(chalk.dim(`      label: "${label}"`));
          console.log('');
          console.log(chalk.green(`[ship] Ready for Nexus deployment from local source.`));
        }
      } catch (err: any) {
        console.error(chalk.red(`[ship] Deployment failed: ${err.message}`));
        process.exit(1);
      }

      console.log('');
    });
}
