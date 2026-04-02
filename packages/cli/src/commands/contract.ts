import { Command } from 'commander';
import chalk from 'chalk';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { requireSwarmDir, loadConfig } from '../core/config.js';
import type { ApiEndpoint, BreakingChange, ContractData } from '../types.js';
import { ApiLifecycleManager } from '../core/api-lifecycle.js';

function loadContractData(swarmDir: string): ContractData {
  const filePath = join(swarmDir, 'contracts.json');
  if (!existsSync(filePath)) {
    return {
      endpoints: [],
      breakingChanges: [],
      versions: [],
      consumers: [],
      lastGenerated: 0,
    };
  }
  try {
    return JSON.parse(readFileSync(filePath, 'utf-8'));
  } catch {
    return {
      endpoints: [],
      breakingChanges: [],
      versions: [],
      consumers: [],
      lastGenerated: 0,
    };
  }
}

function saveContractData(swarmDir: string, data: ContractData): void {
  const filePath = join(swarmDir, 'contracts.json');
  writeFileSync(filePath, JSON.stringify(data, null, 2));
}

export function registerContract(program: Command): void {
  const contract = program
    .command('contract')
    .description('API lifecycle management — generate schemas, detect breaking changes, publish & generate SDKs')
    .action(() => {
      let swarmDir: string;
      try {
        swarmDir = requireSwarmDir();
      } catch {
        console.error(chalk.red('No .swarm/ directory found. Run `swarm init` first.'));
        process.exit(1);
      }
      loadConfig();

      const data = loadContractData(swarmDir);

      console.log(chalk.bold('\nAPI Contracts Overview\n'));

      if (data.endpoints.length === 0) {
        console.log(chalk.dim('  No API contracts generated yet. Run `swarm contract generate` to scan your codebase.'));
        console.log('');
        return;
      }

      console.log(`  Endpoints:        ${chalk.bold(String(data.endpoints.length))}`);
      console.log(`  Breaking changes: ${data.breakingChanges.length > 0 ? chalk.red(String(data.breakingChanges.length)) : chalk.green('0')}`);
      console.log(`  Versions:         ${data.versions.length}`);
      console.log(`  Consumers:        ${data.consumers.length}`);
      console.log(`  Last generated:   ${data.lastGenerated ? new Date(data.lastGenerated).toLocaleString() : 'never'}`);
      console.log('');

      // Endpoint summary by method
      const byMethod = new Map<string, number>();
      for (const ep of data.endpoints) {
        byMethod.set(ep.method, (byMethod.get(ep.method) || 0) + 1);
      }

      console.log(chalk.bold('  Endpoints by Method:'));
      for (const [method, count] of byMethod) {
        console.log(`    ${method.toUpperCase().padEnd(8)} ${count}`);
      }

      // Breaking changes
      if (data.breakingChanges.length > 0) {
        console.log('');
        console.log(chalk.bold.red('  Breaking Changes:'));
        for (const bc of data.breakingChanges.slice(0, 10)) {
          const severityColor = bc.severity === 'breaking' ? chalk.red : bc.severity === 'deprecation' ? chalk.yellow : chalk.green;
          console.log(`    ${severityColor(bc.severity.padEnd(12))} ${bc.endpoint}  ${chalk.dim(bc.type)}`);
          console.log(`      ${bc.description}`);
          if (bc.affectedConsumers.length > 0) {
            console.log(chalk.dim(`      Affects: ${bc.affectedConsumers.join(', ')}`));
          }
        }
      }

      console.log('');
    });

  // --- swarm contract generate ---
  contract
    .command('generate')
    .description('Generate API schema by scanning route files in the codebase')
    .option('--scope <dir>', 'Directory to scan (relative to project root)', '.')
    .action(async (opts) => {
      let swarmDir: string;
      try {
        swarmDir = requireSwarmDir();
      } catch {
        console.error(chalk.red('No .swarm/ directory found. Run `swarm init` first.'));
        process.exit(1);
      }
      loadConfig();

      const cwd = process.cwd();
      const scope = opts.scope || '.';

      console.log(chalk.bold('\nGenerating API Schema\n'));
      console.log(chalk.dim(`  Scanning: ${join(cwd, scope)}`));

      const manager = new ApiLifecycleManager(swarmDir);
      const result = manager.generateSchema(cwd, scope === '.' ? undefined : scope);
      const endpoints = result.endpoints;

      console.log('');
      console.log(chalk.green(`  Found ${endpoints.length} API endpoint${endpoints.length !== 1 ? 's' : ''}.`));

      if (endpoints.length > 0) {
        console.log('');
        console.log(chalk.bold('  Endpoints:'));
        for (const ep of endpoints.slice(0, 20)) {
          console.log(`    ${ep.method.toUpperCase().padEnd(8)} ${ep.path}  ${chalk.dim(ep.version)}`);
        }
        if (endpoints.length > 20) {
          console.log(chalk.dim(`    ... and ${endpoints.length - 20} more`));
        }
      }

      console.log('');
      console.log(chalk.dim(`  Schema saved to .swarm/contracts.json`));
      console.log('');
    });

  // --- swarm contract check ---
  contract
    .command('check')
    .description('Detect breaking changes between current and published schemas')
    .action(async () => {
      let swarmDir: string;
      try {
        swarmDir = requireSwarmDir();
      } catch {
        console.error(chalk.red('No .swarm/ directory found. Run `swarm init` first.'));
        process.exit(1);
      }
      loadConfig();

      const manager = new ApiLifecycleManager(swarmDir);
      const changes = manager.detectBreakingChanges();

      const data = loadContractData(swarmDir);
      data.breakingChanges = changes;
      saveContractData(swarmDir, data);

      console.log(chalk.bold('\nBreaking Change Detection\n'));

      if (changes.length === 0) {
        console.log(chalk.green('  No breaking changes detected.'));
        console.log('');
        return;
      }

      const breaking = changes.filter(c => c.severity === 'breaking');
      const deprecations = changes.filter(c => c.severity === 'deprecation');
      const compatible = changes.filter(c => c.severity === 'compatible');

      if (breaking.length > 0) {
        console.log(chalk.red(`  ${breaking.length} BREAKING change${breaking.length !== 1 ? 's' : ''}:`));
        for (const bc of breaking) {
          console.log(`    ${chalk.red('BREAK')}  ${bc.endpoint}  ${bc.type}`);
          console.log(`           ${bc.description}`);
          if (bc.affectedConsumers.length > 0) {
            console.log(chalk.dim(`           Affects: ${bc.affectedConsumers.join(', ')}`));
          }
        }
        console.log('');
      }

      if (deprecations.length > 0) {
        console.log(chalk.yellow(`  ${deprecations.length} deprecation${deprecations.length !== 1 ? 's' : ''}:`));
        for (const bc of deprecations) {
          console.log(`    ${chalk.yellow('DEPR')}   ${bc.endpoint}  ${bc.description}`);
        }
        console.log('');
      }

      if (compatible.length > 0) {
        console.log(chalk.green(`  ${compatible.length} compatible change${compatible.length !== 1 ? 's' : ''}`));
        console.log('');
      }

      if (breaking.length > 0) {
        console.log(chalk.red('  API compatibility check FAILED. Fix breaking changes before publishing.'));
      } else {
        console.log(chalk.green('  API compatibility check passed.'));
      }
      console.log('');
    });

  // --- swarm contract publish ---
  contract
    .command('publish')
    .description('Publish the current API schema as a new version')
    .requiredOption('--version <v>', 'Version string (e.g., v2.1.0)')
    .action(async (opts) => {
      let swarmDir: string;
      try {
        swarmDir = requireSwarmDir();
      } catch {
        console.error(chalk.red('No .swarm/ directory found. Run `swarm init` first.'));
        process.exit(1);
      }
      loadConfig();

      const data = loadContractData(swarmDir);

      if (data.endpoints.length === 0) {
        console.error(chalk.red('No API schema found. Run `swarm contract generate` first.'));
        process.exit(1);
      }

      // Check for duplicate version
      if (data.versions.find(v => v.version === opts.version)) {
        console.error(chalk.red(`Version "${opts.version}" already published.`));
        process.exit(1);
      }

      // Store versioned snapshot
      const versionedDir = join(swarmDir, 'contract-versions');
      if (!existsSync(versionedDir)) {
        mkdirSync(versionedDir, { recursive: true });
      }

      const snapshot = {
        version: opts.version,
        endpoints: data.endpoints,
        publishedAt: Date.now(),
      };

      writeFileSync(
        join(versionedDir, `${opts.version}.json`),
        JSON.stringify(snapshot, null, 2),
      );

      data.versions.push({
        version: opts.version,
        endpoints: data.endpoints.length,
        publishedAt: Date.now(),
      });

      // Update endpoint versions
      for (const ep of data.endpoints) {
        ep.version = opts.version;
      }

      saveContractData(swarmDir, data);

      console.log(chalk.green(`\nAPI schema published as ${opts.version}`));
      console.log(chalk.dim(`  Endpoints: ${data.endpoints.length}`));
      console.log(chalk.dim(`  Snapshot:  .swarm/contract-versions/${opts.version}.json`));
      console.log('');
    });

  // --- swarm contract sdk ---
  contract
    .command('sdk')
    .description('Generate client SDK scaffolding from the API schema')
    .requiredOption('--language <lang>', 'Target language (typescript, python, go, rust, swift)')
    .option('--output <dir>', 'Output directory', './generated-sdk')
    .action(async (opts) => {
      let swarmDir: string;
      try {
        swarmDir = requireSwarmDir();
      } catch {
        console.error(chalk.red('No .swarm/ directory found. Run `swarm init` first.'));
        process.exit(1);
      }
      loadConfig();

      const data = loadContractData(swarmDir);

      if (data.endpoints.length === 0) {
        console.error(chalk.red('No API schema found. Run `swarm contract generate` first.'));
        process.exit(1);
      }

      const lang = opts.language.toLowerCase();
      const supportedLangs = ['typescript', 'python', 'go', 'rust', 'swift'];
      if (!supportedLangs.includes(lang)) {
        console.error(chalk.red(`Unsupported language "${lang}". Supported: ${supportedLangs.join(', ')}`));
        process.exit(1);
      }

      const outputDir = join(process.cwd(), opts.output);
      if (!existsSync(outputDir)) {
        mkdirSync(outputDir, { recursive: true });
      }

      console.log(chalk.bold(`\nGenerating ${lang} SDK\n`));

      // Generate SDK scaffolding
      const extMap: Record<string, string> = {
        typescript: 'ts',
        python: 'py',
        go: 'go',
        rust: 'rs',
        swift: 'swift',
      };
      const ext = extMap[lang];

      // Group endpoints by path prefix for client modules
      const groups = new Map<string, ApiEndpoint[]>();
      for (const ep of data.endpoints) {
        const parts = ep.path.split('/').filter(Boolean);
        const prefix = parts[0] || 'root';
        const list = groups.get(prefix) || [];
        list.push(ep);
        groups.set(prefix, list);
      }

      let fileCount = 0;
      for (const [group, endpoints] of groups) {
        const fileName = `${group}_client.${ext}`;
        const filePath = join(outputDir, fileName);

        const lines: string[] = [];
        lines.push(`// Auto-generated SDK client for /${group} endpoints`);
        lines.push(`// Generated by swarm contract sdk on ${new Date().toISOString()}`);
        lines.push('');

        for (const ep of endpoints) {
          lines.push(`// ${ep.method.toUpperCase()} ${ep.path}`);
        }

        lines.push('');
        lines.push(`// TODO: Implement ${endpoints.length} endpoint(s) for the ${group} resource`);

        writeFileSync(filePath, lines.join('\n'), 'utf-8');
        fileCount++;
        console.log(chalk.dim(`  Generated: ${fileName} (${endpoints.length} endpoints)`));
      }

      console.log('');
      console.log(chalk.green(`  SDK scaffolding generated: ${fileCount} file${fileCount !== 1 ? 's' : ''}`));
      console.log(chalk.dim(`  Output: ${outputDir}`));
      console.log(chalk.dim('  Complete the TODO stubs with full request/response implementations.'));
      console.log('');
    });

  // --- swarm contract migrate ---
  contract
    .command('migrate')
    .description('Coordinate API migration — plan consumer updates for breaking changes')
    .action(async () => {
      let swarmDir: string;
      try {
        swarmDir = requireSwarmDir();
      } catch {
        console.error(chalk.red('No .swarm/ directory found. Run `swarm init` first.'));
        process.exit(1);
      }
      loadConfig();

      const data = loadContractData(swarmDir);

      if (data.breakingChanges.length === 0) {
        console.log(chalk.green('\nNo breaking changes to migrate. API is compatible.'));
        console.log('');
        return;
      }

      console.log(chalk.bold('\nAPI Migration Plan\n'));

      // Group breaking changes by affected consumer
      const consumerChanges = new Map<string, BreakingChange[]>();
      for (const bc of data.breakingChanges) {
        for (const consumer of bc.affectedConsumers) {
          const list = consumerChanges.get(consumer) || [];
          list.push(bc);
          consumerChanges.set(consumer, list);
        }
        // Also track unassigned
        if (bc.affectedConsumers.length === 0) {
          const list = consumerChanges.get('(unassigned)') || [];
          list.push(bc);
          consumerChanges.set('(unassigned)', list);
        }
      }

      let step = 1;

      console.log(chalk.bold('  Migration Steps:\n'));

      // Step 1: Deprecation phase
      const deprecations = data.breakingChanges.filter(bc => bc.severity !== 'compatible');
      if (deprecations.length > 0) {
        console.log(`  ${step++}. ${chalk.yellow('Deprecation Phase')}`);
        console.log(chalk.dim('     Add deprecation warnings to the following endpoints:'));
        for (const bc of deprecations) {
          console.log(`     - ${bc.endpoint}: ${bc.description}`);
        }
        console.log('');
      }

      // Step 2: Consumer updates
      if (consumerChanges.size > 0) {
        console.log(`  ${step++}. ${chalk.yellow('Consumer Updates')}`);
        for (const [consumer, changes] of consumerChanges) {
          console.log(`     ${chalk.bold(consumer)}: ${changes.length} change${changes.length !== 1 ? 's' : ''}`);
          for (const bc of changes) {
            console.log(chalk.dim(`       - ${bc.endpoint}: ${bc.type} — ${bc.description}`));
          }
        }
        console.log('');
      }

      // Step 3: Cutover
      console.log(`  ${step++}. ${chalk.yellow('Cutover')}`);
      console.log(chalk.dim('     Remove deprecated endpoints after all consumers are updated.'));
      console.log('');

      // Step 4: Verification
      console.log(`  ${step++}. ${chalk.yellow('Verification')}`);
      console.log(chalk.dim('     Run `swarm contract check` to verify no remaining breaking changes.'));
      console.log('');

      // Save migration plan
      const migrationPlan = {
        createdAt: Date.now(),
        breakingChanges: data.breakingChanges.length,
        affectedConsumers: [...consumerChanges.keys()],
        steps: step - 1,
      };

      writeFileSync(
        join(swarmDir, 'migration-plan.json'),
        JSON.stringify(migrationPlan, null, 2),
      );

      console.log(chalk.dim('  Migration plan saved to .swarm/migration-plan.json'));
      console.log('');
    });
}
