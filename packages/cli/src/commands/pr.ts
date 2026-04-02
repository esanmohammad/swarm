import { execSync } from 'node:child_process';
import chalk from 'chalk';
import ora from 'ora';
import type { Command } from 'commander';
import type { TechStack } from '../types.js';
import { loadConfig, requireSwarmDir, autoDetectStack, autoInit } from '../core/config.js';
import { createContext } from './shared.js';
import {
  isGhInstalled,
  getCurrentBranch,
  hasUncommittedChanges,
  suggestReviewers,
  buildSmartPRBody,
} from '../core/git.js';
import { RiskScorer } from '../core/risk-scorer.js';

export function registerPr(program: Command): void {
  program
    .command('pr')
    .description('Create a smart PR with risk scores, code ownership, and pipeline context')
    .option('-t, --title <title>', 'PR title (auto-generated if omitted)')
    .option('-b, --base <branch>', 'Base branch', 'main')
    .option('-d, --draft', 'Create as draft PR')
    .option('-r, --risk', 'Include risk scores for changed files')
    .option('--reviewers', 'Auto-assign reviewers from CODEOWNERS / git blame')
    .option('-l, --label <labels>', 'Comma-separated labels to apply')
    .action(async (opts) => {
      // Verify gh CLI
      if (!isGhInstalled()) {
        console.error(chalk.red('GitHub CLI (gh) is not installed. Install from https://cli.github.com'));
        process.exit(1);
      }

      // Warn about uncommitted changes
      if (hasUncommittedChanges()) {
        console.log(chalk.yellow('Warning: You have uncommitted changes. They will not be included in the PR.'));
      }

      const cwd = process.cwd();
      const base = opts.base as string;
      const branch = getCurrentBranch();

      if (branch === base) {
        console.error(chalk.red(`You are on the base branch (${base}). Switch to a feature branch first.`));
        process.exit(1);
      }

      // Get changed files
      let changedFiles: string[] = [];
      try {
        const diff = execSync(`git diff --name-only ${base}...HEAD`, {
          encoding: 'utf-8',
          cwd,
          stdio: 'pipe',
        }).trim();
        changedFiles = diff ? diff.split('\n').filter(f => f.trim().length > 0) : [];
      } catch {
        // Fallback: diff against base without merge-base
        try {
          const diff = execSync(`git diff --name-only ${base} HEAD`, {
            encoding: 'utf-8',
            cwd,
            stdio: 'pipe',
          }).trim();
          changedFiles = diff ? diff.split('\n').filter(f => f.trim().length > 0) : [];
        } catch {
          console.error(chalk.red(`Cannot determine changed files against ${base}. Is ${base} a valid branch?`));
          process.exit(1);
        }
      }

      if (changedFiles.length === 0) {
        console.error(chalk.red(`No changed files found between ${base} and ${branch}.`));
        process.exit(1);
      }

      console.log(chalk.bold(`\nSwarm PR — Smart Pull Request`));
      console.log(chalk.dim(`Branch: ${branch} -> ${base}`));
      console.log(chalk.dim(`Changed files: ${changedFiles.length}\n`));

      // Compute risk scores if requested
      let riskScores: Array<{ file: string; overall: number; level: string }> | undefined;
      if (opts.risk) {
        const spinner = ora('Computing risk scores...').start();
        const scorer = new RiskScorer(cwd);
        const scores = scorer.scoreFiles(changedFiles);
        riskScores = scores.map(s => ({ file: s.file, overall: s.overall, level: s.level }));
        spinner.succeed(`Risk scores computed for ${scores.length} files`);

        // Show quick summary
        const critical = scores.filter(s => s.level === 'critical').length;
        const high = scores.filter(s => s.level === 'high').length;
        if (critical > 0) console.log(chalk.red(`  ${critical} critical-risk file(s)`));
        if (high > 0) console.log(chalk.yellow(`  ${high} high-risk file(s)`));
      }

      // Find reviewers if requested
      let reviewers: string[] | undefined;
      if (opts.reviewers) {
        const spinner = ora('Finding reviewers...').start();
        reviewers = suggestReviewers(cwd, changedFiles);
        if (reviewers.length > 0) {
          spinner.succeed(`Suggested reviewers: ${reviewers.join(', ')}`);
        } else {
          spinner.info('No reviewers found from CODEOWNERS or git blame');
          reviewers = undefined;
        }
      }

      // Load pipeline state if available (for enhanced body)
      let prBody: string;
      try {
        const swarmDir = requireSwarmDir();
        const config = loadConfig();
        const { state, cleanup } = createContext(swarmDir, config);
        const pipelineState = state.getState();

        prBody = buildSmartPRBody({
          state: pipelineState,
          changedFiles,
          riskScores,
          reviewers,
        });

        cleanup();
      } catch {
        // No .swarm directory — build a simpler body
        const sections: string[] = [
          '## Summary',
          '',
          `Changes on \`${branch}\` targeting \`${base}\`.`,
          '',
        ];

        if (riskScores && riskScores.length > 0) {
          sections.push('## Risk Assessment');
          sections.push('');
          sections.push('| File | Risk | Score |');
          sections.push('|------|------|-------|');
          for (const rs of riskScores) {
            const icon = rs.level === 'critical' ? '🔴' : rs.level === 'high' ? '🟠' : rs.level === 'medium' ? '🟡' : '🟢';
            sections.push(`| \`${rs.file}\` | ${icon} ${rs.level} | ${rs.overall} |`);
          }
          sections.push('');
        }

        sections.push(`## Changed Files (${changedFiles.length})`);
        sections.push('');
        for (const f of changedFiles.slice(0, 20)) {
          sections.push(`- \`${f}\``);
        }
        if (changedFiles.length > 20) {
          sections.push(`- ... and ${changedFiles.length - 20} more files`);
        }
        sections.push('');

        if (reviewers && reviewers.length > 0) {
          sections.push('## Suggested Reviewers');
          sections.push('');
          for (const r of reviewers) {
            sections.push(`- @${r}`);
          }
          sections.push('');
        }

        sections.push('---');
        sections.push('_Auto-generated by Swarm Smart PR_');

        prBody = sections.join('\n');
      }

      // Generate title if not provided
      let title = opts.title as string | undefined;
      if (!title) {
        // Auto-generate from branch name
        title = branch
          .replace(/^(feat|fix|chore|docs|refactor|test|ci)\//i, '')
          .replace(/[-_]/g, ' ')
          .replace(/^\w/, c => c.toUpperCase());

        // Truncate if too long
        if (title.length > 70) {
          title = title.slice(0, 67) + '...';
        }
      }

      // Create PR
      const spinner = ora('Creating pull request...').start();
      try {
        const args: string[] = [
          'gh', 'pr', 'create',
          '--title', JSON.stringify(title),
          '--body', JSON.stringify(prBody),
          '--base', base,
        ];

        if (opts.draft) {
          args.push('--draft');
        }

        if (opts.label) {
          const labels = (opts.label as string).split(',').map(l => l.trim()).filter(Boolean);
          for (const label of labels) {
            args.push('--label', label);
          }
        }

        const prUrl = execSync(args.join(' '), {
          encoding: 'utf-8',
          cwd,
          stdio: 'pipe',
        }).trim();

        spinner.succeed(`Pull request created: ${chalk.cyan(prUrl)}`);

        // Assign reviewers if found
        if (reviewers && reviewers.length > 0) {
          try {
            const reviewerArg = reviewers.join(',');
            execSync(`gh pr edit --add-reviewer ${reviewerArg}`, {
              encoding: 'utf-8',
              cwd,
              stdio: 'pipe',
            });
            console.log(chalk.dim(`  Reviewers assigned: ${reviewers.join(', ')}`));
          } catch (err) {
            // Reviewer assignment is best-effort — team handles or emails may not work
            console.log(chalk.dim(`  Could not auto-assign reviewers (they may need to be GitHub usernames)`));
          }
        }

        console.log('');
        console.log(chalk.bold('PR Summary:'));
        console.log(chalk.dim(`  Title: ${title}`));
        console.log(chalk.dim(`  Base: ${base}`));
        console.log(chalk.dim(`  Files: ${changedFiles.length}`));
        if (riskScores) {
          const avgRisk = Math.round(riskScores.reduce((s, r) => s + r.overall, 0) / riskScores.length);
          console.log(chalk.dim(`  Avg risk: ${avgRisk}/100`));
        }
        if (opts.draft) {
          console.log(chalk.dim(`  Status: Draft`));
        }
      } catch (err) {
        spinner.fail('Failed to create pull request');
        const message = err instanceof Error ? (err as any).stderr ?? err.message : String(err);
        console.error(chalk.red(message));
        process.exit(1);
      }
    });
}
