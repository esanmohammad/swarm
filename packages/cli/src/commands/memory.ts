import { join } from 'node:path';
import chalk from 'chalk';
import type { Command } from 'commander';
import type { TechStack } from '../types.js';
import { requireSwarmDir, autoDetectStack, autoInit } from '../core/config.js';
import { MemoryStore } from '../core/memory-store.js';
import type { MemoryKind } from '../core/memory-store.js';

export function registerMemory(program: Command): void {
  const mem = program
    .command('memory')
    .description('Manage cross-run pipeline memory — what worked, what failed, patterns learned');

  mem
    .command('list')
    .description('List all active memories')
    .option('-k, --kind <kind>', 'Filter by kind (fix-pattern, flaky-test, approach, performance, manual, success)')
    .option('-t, --tag <tag>', 'Filter by tag')
    .action((opts) => {
      const swarmDir = getSwarmDir();
      const store = new MemoryStore(swarmDir);
      let entries = store.list();

      if (opts.kind) {
        entries = entries.filter(e => e.kind === opts.kind);
      }
      if (opts.tag) {
        entries = entries.filter(e =>
          e.tags.includes(opts.tag) || e.content.toLowerCase().includes(opts.tag.toLowerCase())
        );
      }

      if (entries.length === 0) {
        console.log(chalk.dim('No memories stored. Memories are recorded automatically after pipeline runs.'));
        console.log(chalk.dim('Add one manually: swarm memory add "note about your project"'));
        return;
      }

      console.log(chalk.bold(`\nStored memories (${entries.length}):\n`));
      for (const entry of entries) {
        const kindColor = {
          'fix-pattern': chalk.yellow,
          'flaky-test': chalk.red,
          'approach': chalk.blue,
          'performance': chalk.magenta,
          'manual': chalk.green,
          'success': chalk.cyan,
        }[entry.kind] ?? chalk.white;

        const confidence = entry.confidence >= 80 ? chalk.green('HIGH') :
          entry.confidence >= 50 ? chalk.yellow('MED') : chalk.red('LOW');

        console.log(`  ${kindColor(`[${entry.kind}]`)} ${confidence} — ${entry.content}`);
        console.log(chalk.dim(`    ID: ${entry.id} | Expires: ${entry.expiresAt.split('T')[0]} | Tags: ${entry.tags.join(', ') || 'none'}`));
        console.log('');
      }
    });

  mem
    .command('add')
    .description('Manually add a memory note')
    .argument('<note>', 'Memory content')
    .option('-k, --kind <kind>', 'Memory kind', 'manual')
    .option('-c, --confidence <n>', 'Confidence score 0-100', '80')
    .option('-t, --tags <tags>', 'Comma-separated tags')
    .action((note: string, opts) => {
      const swarmDir = getSwarmDir();
      const store = new MemoryStore(swarmDir);
      const entry = store.add({
        kind: (opts.kind || 'manual') as MemoryKind,
        content: note,
        confidence: parseInt(opts.confidence) || 80,
        source: 'manual',
        tags: opts.tags ? opts.tags.split(',').map((t: string) => t.trim()) : [],
      });
      console.log(chalk.green(`Memory added: ${entry.id}`));
    });

  mem
    .command('clear')
    .description('Clear all stored memories')
    .action(() => {
      const swarmDir = getSwarmDir();
      const store = new MemoryStore(swarmDir);
      store.clear();
      console.log(chalk.yellow('All memories cleared.'));
    });

  mem
    .command('remove')
    .description('Remove a specific memory by ID')
    .argument('<id>', 'Memory ID')
    .action((id: string) => {
      const swarmDir = getSwarmDir();
      const store = new MemoryStore(swarmDir);
      if (store.remove(id)) {
        console.log(chalk.green(`Memory ${id} removed.`));
      } else {
        console.log(chalk.red(`Memory ${id} not found.`));
      }
    });

  mem
    .command('show')
    .description('Show memory context as it would be injected into agents')
    .action(() => {
      const swarmDir = getSwarmDir();
      const store = new MemoryStore(swarmDir);
      const context = store.buildMemoryContext();
      if (!context) {
        console.log(chalk.dim('No memories to show.'));
        return;
      }
      console.log(context);
    });
}

function getSwarmDir(): string {
  try {
    return requireSwarmDir();
  } catch {
    const cwd = process.cwd();
    const stack = autoDetectStack(cwd);
    const projectName = cwd.split('/').pop() || 'my-project';
    console.log(chalk.yellow(`No .swarm/ found — auto-initializing (stack: ${stack})...`));
    return autoInit(projectName, stack, cwd);
  }
}
