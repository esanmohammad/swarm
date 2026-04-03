import chalk from 'chalk';
import { existsSync, readFileSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Command } from 'commander';
import { requireSwarmDir } from '../core/config.js';

export function registerRecover(program: Command): void {
  program
    .command('recover')
    .description('Restore pipeline state from the most recent backup')
    .action(async () => {
      const swarmDir = requireSwarmDir();
      const statePath = join(swarmDir, 'state.json');
      const backupPath = statePath + '.bak';

      if (!existsSync(backupPath)) {
        console.log(chalk.yellow('No backup found (state.json.bak). Nothing to recover.'));
        return;
      }

      // Validate backup is parseable
      try {
        const raw = readFileSync(backupPath, 'utf-8');
        JSON.parse(raw);
      } catch {
        console.log(chalk.red('Backup file is corrupted. Cannot recover.'));
        return;
      }

      // Overwrite state.json with backup
      copyFileSync(backupPath, statePath);
      console.log(chalk.green('State restored from backup (state.json.bak → state.json).'));
      console.log(chalk.dim('Run `hivemind status` to verify.'));
    });
}
