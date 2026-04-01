import chalk from 'chalk';
import { existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { readFileSync, writeFileSync } from 'node:fs';
import { parse as parseYaml, stringify as toYaml } from 'yaml';
import type { Command } from 'commander';
import { requireSwarmDir, loadConfig } from '../core/config.js';
import { StateManager } from '../core/state.js';
import type { SwarmConfig } from '../types.js';

export function registerPipeline(program: Command): void {
  const pipeline = program
    .command('pipeline')
    .description('Manage named pipelines with git worktrees');

  // --- create ---
  pipeline
    .command('create <name>')
    .description('Create a new named pipeline with a git worktree')
    .action(async (name: string) => {
      const swarmDir = requireSwarmDir();
      const config = loadConfig();

      // Check if pipeline already exists
      const existing = StateManager.listPipelines(swarmDir);
      if (existing.includes(name)) {
        console.error(chalk.red(`Pipeline "${name}" already exists.`));
        process.exit(1);
      }

      // Create the pipeline state file
      const state = new StateManager(swarmDir, name);
      state.init(config.projectName, config.stack);

      // Create git worktree
      const worktreePath = state.ensureWorktree(name);
      if (worktreePath) {
        console.log(chalk.green(`Created pipeline "${name}" with worktree at ${worktreePath}`));
      } else {
        console.log(chalk.green(`Created pipeline "${name}" (no worktree — default pipelines use project root)`));
      }
    });

  // --- delete ---
  pipeline
    .command('delete <name>')
    .description('Delete a named pipeline and its worktree')
    .action(async (name: string) => {
      const swarmDir = requireSwarmDir();

      if (name === 'default') {
        console.error(chalk.red('Cannot delete the default pipeline.'));
        process.exit(1);
      }

      // Check if pipeline exists
      const existing = StateManager.listPipelines(swarmDir);
      if (!existing.includes(name)) {
        console.error(chalk.red(`Pipeline "${name}" does not exist.`));
        process.exit(1);
      }

      // Remove worktree
      const state = new StateManager(swarmDir, name);
      state.removeWorktree(name);
      // Flush to clear any pending scheduled writes, then delete files
      state.flush();

      // Remove the pipeline state files
      const pipelineFile = join(swarmDir, 'pipelines', `${name}.json`);
      for (const f of [pipelineFile, pipelineFile + '.tmp', pipelineFile + '.bak']) {
        if (existsSync(f)) unlinkSync(f);
      }

      console.log(chalk.green(`Deleted pipeline "${name}".`));
    });

  // --- list ---
  pipeline
    .command('list')
    .description('List all pipelines with status')
    .action(async () => {
      const swarmDir = requireSwarmDir();
      const config = loadConfig();
      const activePipeline = config.activePipeline ?? 'default';
      const pipelines = StateManager.listPipelines(swarmDir);

      if (pipelines.length === 0) {
        console.log(chalk.dim('No pipelines found.'));
        return;
      }

      console.log(chalk.bold('\nPipelines:\n'));
      console.log(chalk.dim('  Name                 Status       Cost        Worktree'));
      console.log(chalk.dim('  ' + '-'.repeat(72)));

      for (const ns of pipelines) {
        const state = new StateManager(swarmDir, ns);
        const ps = state.getState();

        // Determine overall status from stages
        const stageStatuses = Object.values(ps.stages).map(s => s.status);
        let overallStatus = 'pending';
        if (stageStatuses.some(s => s === 'running')) {
          overallStatus = 'running';
        } else if (stageStatuses.every(s => s === 'done')) {
          overallStatus = 'done';
        } else if (stageStatuses.some(s => s === 'error')) {
          overallStatus = 'error';
        } else if (stageStatuses.some(s => s === 'done')) {
          overallStatus = 'in-progress';
        }

        const isActive = ns === activePipeline;
        const marker = isActive ? chalk.green('* ') : '  ';
        const nameStr = ns.padEnd(20);
        const statusColor = overallStatus === 'done' ? chalk.green
          : overallStatus === 'running' ? chalk.cyan
          : overallStatus === 'error' ? chalk.red
          : overallStatus === 'in-progress' ? chalk.yellow
          : chalk.gray;
        const statusStr = statusColor(overallStatus).padEnd(20); // padEnd accounts for ANSI codes
        const costStr = ('$' + ps.totalCost.totalUsd.toFixed(4)).padEnd(12);
        const worktreeStr = ps.worktreePath ? chalk.dim(ps.worktreePath) : chalk.dim('(project root)');

        console.log(`${marker}${nameStr} ${statusStr} ${costStr} ${worktreeStr}`);
      }

      console.log('');
    });

  // --- switch ---
  pipeline
    .command('switch <name>')
    .description('Switch the active pipeline')
    .action(async (name: string) => {
      const swarmDir = requireSwarmDir();

      // Check if pipeline exists
      const existing = StateManager.listPipelines(swarmDir);
      if (!existing.includes(name)) {
        console.error(chalk.red(`Pipeline "${name}" does not exist.`));
        process.exit(1);
      }

      // Update config's activePipeline
      const configPath = join(swarmDir, 'config.yaml');
      let config: SwarmConfig;
      try {
        const raw = readFileSync(configPath, 'utf-8');
        config = parseYaml(raw) as SwarmConfig;
      } catch {
        console.error(chalk.red('Could not read config.yaml'));
        process.exit(1);
      }

      config.activePipeline = name;
      writeFileSync(configPath, toYaml(config));

      console.log(chalk.green(`Switched active pipeline to "${name}".`));
    });
}
