import chalk from 'chalk';
import type { Command } from 'commander';
import { requireSwarmDir } from '../core/config.js';
import { buildIndex, loadIndex, queryIndex, getFragileFiles } from '../core/codebase-index.js';

export function registerContext(program: Command): void {
  const ctx = program
    .command('context')
    .description('Codebase intelligence — index, query, and analyze your project')
    .action(() => {
      // Default: show index summary
      const swarmDir = requireSwarmDir();
      const index = loadIndex(swarmDir);

      if (!index) {
        console.log(chalk.yellow('No codebase index found.'));
        console.log(chalk.dim('Run `swarm context build` to create one.'));
        return;
      }

      const age = Date.now() - index.builtAt;
      const ageStr = age < 3600000
        ? `${Math.round(age / 60000)}m ago`
        : age < 86400000
          ? `${Math.round(age / 3600000)}h ago`
          : `${Math.round(age / 86400000)}d ago`;

      console.log(chalk.bold('\nCodebase Index Summary\n'));
      console.log(`  ${chalk.cyan('Files:')}       ${index.files.length}`);
      console.log(`  ${chalk.cyan('Symbols:')}     ${index.symbols.length}`);
      console.log(`  ${chalk.cyan('Modules:')}     ${index.modules.length}`);
      console.log(`  ${chalk.cyan('Fragile:')}     ${index.fragileFiles.length} files`);
      console.log(`  ${chalk.cyan('Co-changes:')}  ${index.coChangePatterns.length} patterns`);
      console.log(`  ${chalk.cyan('Built:')}       ${new Date(index.builtAt).toLocaleString()} (${ageStr})`);

      if (age > 86400000) {
        console.log(chalk.yellow('\n  Index is stale. Run `swarm context build` to refresh.'));
      }
      console.log();
    });

  ctx
    .command('build')
    .description('Rebuild the full codebase index')
    .action(() => {
      const swarmDir = requireSwarmDir();
      const cwd = process.cwd();

      console.log(chalk.dim('Scanning codebase...'));
      const start = Date.now();
      const index = buildIndex(cwd, swarmDir);
      const elapsed = ((Date.now() - start) / 1000).toFixed(1);

      console.log(chalk.green(`\nIndex built in ${elapsed}s\n`));
      console.log(`  ${chalk.cyan('Files:')}       ${index.files.length}`);
      console.log(`  ${chalk.cyan('Symbols:')}     ${index.symbols.length}`);
      console.log(`  ${chalk.cyan('Modules:')}     ${index.modules.length}`);
      console.log(`  ${chalk.cyan('Fragile:')}     ${index.fragileFiles.length} files`);
      console.log(`  ${chalk.cyan('Co-changes:')}  ${index.coChangePatterns.length} patterns`);
      console.log(chalk.dim(`\n  Saved to .swarm/index/graph.json`));
      console.log();
    });

  ctx
    .command('query <question>')
    .description('Search the codebase index')
    .action((question: string) => {
      const swarmDir = requireSwarmDir();
      const index = loadIndex(swarmDir);

      if (!index) {
        console.log(chalk.yellow('No codebase index found. Run `swarm context build` first.'));
        return;
      }

      console.log(chalk.dim(`Searching for: "${question}"\n`));
      const result = queryIndex(index, question);
      const lines = result.split('\n');

      for (const line of lines) {
        if (line.startsWith('File:')) {
          console.log(chalk.cyan('  ') + line);
        } else if (line.startsWith('Symbol:')) {
          console.log(chalk.yellow('  ') + line);
        } else if (line.startsWith('Module:')) {
          console.log(chalk.green('  ') + line);
        } else {
          console.log(chalk.dim('  ' + line));
        }
      }
      console.log();
    });

  ctx
    .command('graph [dir]')
    .description('Show dependency graph for a directory')
    .action((dir?: string) => {
      const swarmDir = requireSwarmDir();
      const index = loadIndex(swarmDir);

      if (!index) {
        console.log(chalk.yellow('No codebase index found. Run `swarm context build` first.'));
        return;
      }

      const prefix = dir || '';
      const files = index.files.filter(f => f.path.startsWith(prefix));

      if (files.length === 0) {
        console.log(chalk.yellow(`No files found${dir ? ` in ${dir}` : ''}.`));
        return;
      }

      console.log(chalk.bold(`\nDependency Graph${dir ? ` — ${dir}` : ''}\n`));

      for (const f of files) {
        const deps = index.dependencyGraph[f.path] || [];
        const localDeps = deps.filter(d => !d.startsWith('.') ? false : true);
        const externalDeps = deps.filter(d => d.startsWith('.') ? false : true);

        console.log(chalk.cyan(f.path));
        if (localDeps.length > 0) {
          console.log(chalk.dim('  local: ') + localDeps.join(', '));
        }
        if (externalDeps.length > 0) {
          console.log(chalk.dim('  external: ') + chalk.dim(externalDeps.join(', ')));
        }
        if (deps.length === 0) {
          console.log(chalk.dim('  (no dependencies)'));
        }
      }
      console.log();
    });

  ctx
    .command('fragile')
    .description('Show fragile files ranked by risk')
    .action(() => {
      const swarmDir = requireSwarmDir();
      const index = loadIndex(swarmDir);

      if (!index) {
        console.log(chalk.yellow('No codebase index found. Run `swarm context build` first.'));
        return;
      }

      const fragile = getFragileFiles(index);

      if (fragile.length === 0) {
        console.log(chalk.green('\nNo fragile files detected.\n'));
        return;
      }

      console.log(chalk.bold('\nFragile Files (ranked by risk)\n'));
      console.log(chalk.dim('  Risk   File                                           Reason'));
      console.log(chalk.dim('  ────   ────                                           ──────'));

      for (const f of fragile) {
        const riskPct = `${(f.failureRate * 100).toFixed(0)}%`.padEnd(5);
        const riskColor = f.failureRate > 0.7 ? chalk.red : f.failureRate > 0.4 ? chalk.yellow : chalk.dim;
        const filePadded = f.path.length > 45 ? f.path.slice(0, 42) + '...' : f.path.padEnd(45);
        console.log(`  ${riskColor(riskPct)}  ${chalk.cyan(filePadded)}  ${chalk.dim(f.reason)}`);
      }
      console.log();
    });

  ctx
    .command('stale')
    .description('Show stale index entries (files modified after index was built)')
    .action(() => {
      const swarmDir = requireSwarmDir();
      const index = loadIndex(swarmDir);

      if (!index) {
        console.log(chalk.yellow('No codebase index found. Run `swarm context build` first.'));
        return;
      }

      const staleFiles = index.files.filter(f => f.lastModified > index.builtAt);

      if (staleFiles.length === 0) {
        console.log(chalk.green('\nIndex is up to date — no stale entries.\n'));
        return;
      }

      console.log(chalk.bold(`\nStale Index Entries (${staleFiles.length} files modified since last build)\n`));

      for (const f of staleFiles) {
        const modifiedAgo = Date.now() - f.lastModified;
        const agoStr = modifiedAgo < 3600000
          ? `${Math.round(modifiedAgo / 60000)}m ago`
          : modifiedAgo < 86400000
            ? `${Math.round(modifiedAgo / 3600000)}h ago`
            : `${Math.round(modifiedAgo / 86400000)}d ago`;
        console.log(`  ${chalk.yellow(f.path)} ${chalk.dim(`modified ${agoStr}`)}`);
      }

      console.log(chalk.dim(`\n  Run \`swarm context build\` to refresh the index.\n`));
    });
}
