import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import chalk from 'chalk';
import { Command } from 'commander';
import { parse as parseYaml, stringify as toYaml } from 'yaml';
import { getModelCatalog, initModelCatalog } from '../core/providers/model-catalog.js';
import { getRegistry, initRegistry } from '../core/providers/registry.js';
import { estimatePipelineCost, isLocalModel, getCostPer1M } from '../core/providers/cost-table.js';
import type { ModelInfo } from '../core/providers/types.js';
import type { Persona, SwarmConfig } from '../types.js';
import { DEFAULT_CONFIG } from '../types.js';
import { loadConfig, findSwarmDir } from '../core/config.js';

/**
 * Load config safely — returns DEFAULT_CONFIG if .swarm/ doesn't exist.
 */
function safeLoadConfig(): SwarmConfig {
  try {
    return loadConfig();
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

/**
 * Ensure the provider registry and model catalog are initialized from config.
 */
function ensureProviders(config: SwarmConfig): void {
  initRegistry(config.providers, config.aliases);
  initModelCatalog(config.model, config.aliases);
}

/**
 * Format a context window size for display (e.g. 200000 → '200K', 1000000 → '1M').
 */
function formatContext(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(tokens % 1_000_000 === 0 ? 0 : 1)}M`;
  if (tokens >= 1000) return `${Math.round(tokens / 1000)}K`;
  return String(tokens);
}

/**
 * Format a cost value for display.
 */
function formatCost(cost: number): string {
  if (cost === 0) return chalk.green('free');
  return `$${cost.toFixed(2)}`;
}

/**
 * Pad a string to a fixed width.
 */
function pad(s: string, width: number): string {
  // Strip ANSI codes for length calculation
  const stripped = s.replace(/\x1b\[[0-9;]*m/g, '');
  const diff = width - stripped.length;
  return diff > 0 ? s + ' '.repeat(diff) : s;
}

const VALID_STAGES = ['analyst', 'architect', 'lead', 'engineer', 'tester', 'default'] as const;

export function registerModels(program: Command): void {
  const cmd = program
    .command('models')
    .description('Manage LLM models and providers');

  // swarm models (default: list configured)
  cmd
    .command('list', { isDefault: true })
    .description('List available models from all configured providers')
    .option('--provider <name>', 'Filter by provider')
    .option('--json', 'Output as JSON')
    .action(async (opts) => {
      const config = safeLoadConfig();
      ensureProviders(config);

      const catalog = getModelCatalog();
      let models: ModelInfo[];

      try {
        models = await catalog.listAll();
      } catch {
        models = catalog.getKnownModels();
      }

      // Filter by provider if requested
      if (opts.provider) {
        models = models.filter(m => m.provider === opts.provider);
        if (models.length === 0) {
          console.log(chalk.yellow(`No models found for provider "${opts.provider}".`));
          return;
        }
      }

      // JSON output
      if (opts.json) {
        console.log(JSON.stringify(models, null, 2));
        return;
      }

      // Resolve default model
      const defaultFullId = catalog.getDefaultModel();

      // Group by provider
      const byProvider = new Map<string, ModelInfo[]>();
      for (const m of models) {
        if (!byProvider.has(m.provider)) byProvider.set(m.provider, []);
        byProvider.get(m.provider)!.push(m);
      }

      // Column widths
      const colProvider = 13;
      const colModel = 22;
      const colContext = 10;
      const colTools = 7;
      const colTier = 7;
      const colInput = 10;
      const colOutput = 10;

      console.log(chalk.bold('\nAvailable Models\n'));

      // Header
      const header =
        pad(chalk.dim('Provider'), colProvider) +
        pad(chalk.dim('Model'), colModel) +
        pad(chalk.dim('Context'), colContext) +
        pad(chalk.dim('Tools'), colTools) +
        pad(chalk.dim('Tier'), colTier) +
        pad(chalk.dim('Input'), colInput) +
        pad(chalk.dim('Output'), colOutput);
      console.log(`  ${header}`);
      console.log(chalk.dim('  ' + '\u2500'.repeat(colProvider + colModel + colContext + colTools + colTier + colInput + colOutput)));

      for (const [provider, provModels] of byProvider) {
        for (const m of provModels) {
          const isDefault = m.fullId === defaultFullId;
          const tierLabel = m.tier === 3 ? 'Agent' : m.tier === 2 ? 'Tools' : 'Text';

          const line =
            pad(provider, colProvider) +
            pad(m.id, colModel) +
            pad(formatContext(m.contextWindow), colContext) +
            pad(m.supportsTools ? '\u2713' : '\u2717', colTools) +
            pad(String(m.tier), colTier) +
            pad(formatCost(m.costPer1MInput), colInput) +
            pad(formatCost(m.costPer1MOutput), colOutput);

          const suffix = isDefault ? chalk.cyan('  \u2190 default') : '';
          console.log(`  ${line}${suffix}`);
        }
      }

      // Show aliases
      const registry = getRegistry();
      const aliases = registry.getAliases();
      if (Object.keys(aliases).length > 0) {
        console.log(chalk.bold('\n  Aliases'));
        for (const [alias, target] of Object.entries(aliases)) {
          console.log(`  ${chalk.cyan(alias)} \u2192 ${target}`);
        }
      }

      // Show per-stage overrides if configured
      if (config.models && Object.keys(config.models).length > 0) {
        console.log(chalk.bold('\n  Per-Stage Overrides'));
        for (const [stage, model] of Object.entries(config.models)) {
          console.log(`  ${pad(stage, 12)} ${model}`);
        }
      }

      console.log('');
    });

  // swarm models test <model>
  cmd
    .command('test <model>')
    .description('Test connectivity and latency for a model')
    .action(async (model: string) => {
      const config = safeLoadConfig();
      ensureProviders(config);

      const registry = getRegistry();
      const resolved = registry.resolve(model);
      const provider = registry.getProvider(resolved.provider);

      console.log(chalk.bold('\nModel Connectivity Test\n'));
      console.log(`  Model:    ${resolved.fullId}`);
      console.log(`  Provider: ${resolved.provider}`);

      if (!provider) {
        console.log(chalk.yellow(`\n  Provider "${resolved.provider}" is not configured.`));
        console.log(chalk.dim('  Add it with: swarm models add-provider ' + resolved.provider));

        // Still show model info if we know about it
        const catalog = getModelCatalog();
        const known = catalog.getKnownModels().find(m => m.fullId === resolved.fullId);
        if (known) {
          console.log(chalk.dim(`\n  Known model info:`));
          console.log(`    Context:  ${formatContext(known.contextWindow)}`);
          console.log(`    Tools:    ${known.supportsTools ? 'Yes' : 'No'}`);
          console.log(`    Tier:     ${known.tier}`);
          console.log(`    Input:    ${formatCost(known.costPer1MInput)}/1M tokens`);
          console.log(`    Output:   ${formatCost(known.costPer1MOutput)}/1M tokens`);
        }
        console.log('');
        return;
      }

      console.log(chalk.dim('  Testing connection...'));
      const start = Date.now();

      try {
        const result = await provider.testConnection();
        const latency = result.latencyMs || (Date.now() - start);

        if (result.ok) {
          console.log(chalk.green(`\n  Status:  Connected`));
          console.log(`  Latency: ${latency}ms`);
        } else {
          console.log(chalk.red(`\n  Status:  Failed`));
          if (result.error) {
            console.log(`  Error:   ${result.error}`);
          }
        }
      } catch (err) {
        const latency = Date.now() - start;
        console.log(chalk.red(`\n  Status:  Error`));
        console.log(`  Latency: ${latency}ms`);
        console.log(`  Error:   ${err instanceof Error ? err.message : String(err)}`);
      }

      // Show pricing info
      const pricing = getCostPer1M(resolved.fullId);
      if (pricing) {
        console.log(`\n  Pricing:`);
        console.log(`    Input:  ${formatCost(pricing.input)}/1M tokens`);
        console.log(`    Output: ${formatCost(pricing.output)}/1M tokens`);
      }

      console.log('');
    });

  // swarm models set <stage> <model>
  cmd
    .command('set <stage> <model>')
    .description('Set the model for a pipeline stage')
    .action(async (stage: string, model: string) => {
      // Validate stage
      if (!VALID_STAGES.includes(stage as typeof VALID_STAGES[number])) {
        console.error(chalk.red(`Invalid stage: "${stage}". Must be one of: ${VALID_STAGES.join(', ')}`));
        process.exit(1);
      }

      const config = safeLoadConfig();
      ensureProviders(config);

      // Validate model resolves
      const registry = getRegistry();
      const resolved = registry.resolve(model);

      // Update config
      const swarmDir = findSwarmDir();
      const configPath = join(swarmDir, 'config.yaml');

      if (!existsSync(swarmDir)) {
        console.error(chalk.red('No .swarm/ directory found. Run `hivemind init` first.'));
        process.exit(1);
      }

      let rawConfig: Record<string, unknown> = {};
      if (existsSync(configPath)) {
        try {
          rawConfig = parseYaml(readFileSync(configPath, 'utf-8')) as Record<string, unknown> || {};
        } catch {
          rawConfig = {};
        }
      }

      if (stage === 'default') {
        rawConfig.model = model;
        console.log(chalk.green(`\nDefault model set to: ${chalk.bold(resolved.fullId)}`));
      } else {
        const models = (rawConfig.models as Record<string, string>) || {};
        models[stage] = model;
        rawConfig.models = models;
        console.log(chalk.green(`\n${stage} model set to: ${chalk.bold(resolved.fullId)}`));
      }

      writeFileSync(configPath, toYaml(rawConfig));
      console.log(chalk.dim(`Updated ${configPath}\n`));
    });

  // swarm models add-provider <name>
  cmd
    .command('add-provider <name>')
    .description('Configure a new LLM provider')
    .option('--key <apiKey>', 'API key (or env var reference like ${OPENAI_API_KEY})')
    .option('--url <baseUrl>', 'Base URL for API')
    .action(async (name: string, opts) => {
      const swarmDir = findSwarmDir();
      const configPath = join(swarmDir, 'config.yaml');

      if (!existsSync(swarmDir)) {
        console.error(chalk.red('No .swarm/ directory found. Run `hivemind init` first.'));
        process.exit(1);
      }

      let rawConfig: Record<string, unknown> = {};
      if (existsSync(configPath)) {
        try {
          rawConfig = parseYaml(readFileSync(configPath, 'utf-8')) as Record<string, unknown> || {};
        } catch {
          rawConfig = {};
        }
      }

      const providers = (rawConfig.providers as Record<string, Record<string, string>>) || {};
      const providerConfig: Record<string, string> = {};

      if (opts.key) providerConfig.apiKey = opts.key;
      if (opts.url) providerConfig.baseUrl = opts.url;

      // Suggest env var pattern if raw key is provided
      if (opts.key && !opts.key.startsWith('${')) {
        console.log(chalk.yellow(`\n  Tip: Consider using an env var reference instead of a raw key:`));
        console.log(chalk.dim(`    --key '\${${name.toUpperCase()}_API_KEY}'`));
      }

      providers[name] = providerConfig;
      rawConfig.providers = providers;

      writeFileSync(configPath, toYaml(rawConfig));

      console.log(chalk.green(`\nProvider "${name}" configured.`));
      console.log(chalk.dim(`Updated ${configPath}`));

      // Try to test if we can initialize the provider
      const config = safeLoadConfig();
      ensureProviders(config);

      const registry = getRegistry();
      const provider = registry.getProvider(name);

      if (provider) {
        console.log(chalk.dim('Testing connection...'));
        try {
          const result = await provider.testConnection();
          if (result.ok) {
            console.log(chalk.green(`  Connected (${result.latencyMs}ms)`));
          } else {
            console.log(chalk.yellow(`  Connection test failed: ${result.error || 'unknown error'}`));
          }
        } catch (err) {
          console.log(chalk.yellow(`  Could not test: ${err instanceof Error ? err.message : String(err)}`));
        }
      } else {
        console.log(chalk.dim(`  Provider registered but not yet instantiated. It will be initialized when first used.`));
      }

      console.log('');
    });

  // swarm models cost
  cmd
    .command('cost')
    .description('Estimate pipeline cost for current model configuration')
    .action(async () => {
      const config = safeLoadConfig();
      ensureProviders(config);

      const catalog = getModelCatalog();
      const registry = getRegistry();

      // Build per-stage model assignments from config
      const stages = ['analyze', 'architect', 'plan', 'build', 'test'] as const;
      const personaForStage: Record<string, Persona> = {
        analyze: 'analyst',
        architect: 'architect',
        plan: 'lead',
        build: 'engineer',
        test: 'tester',
      };
      const stageLabels: Record<string, string> = {
        analyze: 'Analyst',
        architect: 'Architect',
        plan: 'Lead',
        build: 'Engineer',
        test: 'Tester',
      };

      const stageModels: Record<string, string> = {};
      for (const stage of stages) {
        const persona = personaForStage[stage];
        const perStageModel = config.models?.[persona];
        const modelStr = perStageModel || config.model || 'sonnet';
        const resolved = registry.resolve(modelStr);
        stageModels[stage] = resolved.fullId;
      }

      // Get estimates
      const estimate = estimatePipelineCost(stageModels);

      // Column widths
      const colStage = 13;
      const colModel = 30;
      const colCost = 12;

      console.log(chalk.bold('\nPipeline Cost Estimate\n'));

      // Header
      console.log(
        `  ${pad(chalk.dim('Stage'), colStage)}` +
        `${pad(chalk.dim('Model'), colModel)}` +
        `${pad(chalk.dim('Est. Cost'), colCost)}`
      );
      console.log(chalk.dim('  ' + '\u2500'.repeat(colStage + colModel + colCost)));

      for (const stage of stages) {
        const model = stageModels[stage];
        const cost = estimate.breakdown[stage] ?? 0;
        const costStr = isLocalModel(model) ? chalk.green('$0.00') : `$${cost.toFixed(2)}`;

        console.log(
          `  ${pad(stageLabels[stage], colStage)}` +
          `${pad(model, colModel)}` +
          `${costStr}`
        );
      }

      console.log(chalk.dim('  ' + '\u2500'.repeat(colStage + colModel + colCost)));

      const rangeStr = `$${estimate.low.toFixed(2)} - $${estimate.high.toFixed(2)}`;
      console.log(`  ${pad(chalk.bold('Total (est)'), colStage)}${pad('', colModel)}${chalk.bold(rangeStr)}`);

      // Comparisons
      const allSonnet: Record<string, string> = {};
      const allLocal: Record<string, string> = {};
      for (const stage of stages) {
        allSonnet[stage] = 'anthropic/claude-sonnet-4';
        allLocal[stage] = 'ollama/llama3.1:70b';
      }

      const sonnetEst = estimatePipelineCost(allSonnet);

      console.log(chalk.bold('\n  Comparison:'));
      console.log(`    All Claude Sonnet: $${sonnetEst.low.toFixed(2)} - $${sonnetEst.high.toFixed(2)}`);
      console.log(`    Your mix:          $${estimate.low.toFixed(2)} - $${estimate.high.toFixed(2)}`);

      if (sonnetEst.high > 0 && estimate.high < sonnetEst.high) {
        const savingsPct = Math.round((1 - estimate.high / sonnetEst.high) * 100);
        if (savingsPct > 0) {
          console.log(chalk.green(`                       (${savingsPct}% savings)`));
        }
      }

      console.log(`    All local:         ${chalk.green('$0.00')}  (free)`);
      console.log('');
    });
}
