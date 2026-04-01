import chalk from 'chalk';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Command } from 'commander';
import { requireSwarmDir, loadConfig } from '../core/config.js';
import { PluginLoader } from '../core/plugins.js';

const TEMPLATE_PLUGIN = `// Swarm Plugin — customize stages and personas
// Docs: https://github.com/your-org/swarm#plugins

/** @type {import('@swarm/cli').SwarmPlugin} */
export default {
  name: 'my-plugin',
  version: '0.1.0',
  description: 'A custom Swarm plugin',

  stages: [
    // Example: add a security review stage after the architect stage
    // {
    //   name: 'security-review',
    //   persona: 'architect',
    //   artifact: 'SECURITY.md',
    //   prompt: 'Review the architecture for security vulnerabilities and write a security report.',
    //   after: 'architect',
    // },
  ],

  personas: [
    // Example: add a custom DevOps persona
    // {
    //   name: 'devops',
    //   description: 'Infrastructure and deployment specialist',
    //   promptTemplate: 'You are a DevOps engineer specializing in {{stack}} deployments...',
    //   stack: ['node', 'react', 'python'],
    // },
  ],
};
`;

export function registerPlugin(program: Command): void {
  const pluginCmd = program
    .command('plugin')
    .description('Manage Swarm plugins (stages & personas)');

  // --- swarm plugin list ---
  pluginCmd
    .command('list')
    .description('Show installed plugins with their stages and personas')
    .action(async () => {
      const swarmDir = requireSwarmDir();
      const config = loadConfig();
      const loader = new PluginLoader(swarmDir, config.plugins);

      const plugins = await loader.loadAll();

      if (plugins.length === 0) {
        console.log(chalk.dim('No plugins installed.'));
        console.log(
          chalk.dim('  Run ') +
            chalk.cyan('swarm plugin init') +
            chalk.dim(' to create one, or add npm packages to config.plugins[]'),
        );
        return;
      }

      console.log(chalk.bold(`Found ${plugins.length} plugin(s):\n`));

      for (const plugin of plugins) {
        console.log(
          chalk.green(`  ${plugin.name}`) +
            chalk.dim(` v${plugin.version}`) +
            (plugin.description ? chalk.dim(` — ${plugin.description}`) : ''),
        );

        if (plugin.stages && plugin.stages.length > 0) {
          console.log(chalk.yellow('    Stages:'));
          for (const stage of plugin.stages) {
            const position = stage.before
              ? `before ${stage.before}`
              : stage.after
                ? `after ${stage.after}`
                : 'unpositioned';
            console.log(
              `      ${chalk.cyan(stage.name)} ` +
                chalk.dim(`(${stage.persona}, ${position})`) +
                (stage.artifact ? chalk.dim(` -> ${stage.artifact}`) : ''),
            );
          }
        }

        if (plugin.personas && plugin.personas.length > 0) {
          console.log(chalk.yellow('    Personas:'));
          for (const persona of plugin.personas) {
            const stacks = persona.stack?.length
              ? persona.stack.join(', ')
              : 'all stacks';
            console.log(
              `      ${chalk.cyan(persona.name)} ` +
                chalk.dim(`(${stacks})`) +
                (persona.description ? chalk.dim(` — ${persona.description}`) : ''),
            );
          }
        }

        console.log();
      }
    });

  // --- swarm plugin init ---
  pluginCmd
    .command('init')
    .description('Create a template plugin at .swarm/plugins/my-plugin.js')
    .action(async () => {
      const swarmDir = requireSwarmDir();
      const pluginsDir = join(swarmDir, 'plugins');
      const pluginPath = join(pluginsDir, 'my-plugin.js');

      if (existsSync(pluginPath)) {
        console.log(chalk.yellow(`Plugin already exists at ${pluginPath}`));
        console.log(chalk.dim('Edit the file to customize your plugin.'));
        return;
      }

      if (!existsSync(pluginsDir)) {
        mkdirSync(pluginsDir, { recursive: true });
      }

      writeFileSync(pluginPath, TEMPLATE_PLUGIN, 'utf-8');

      console.log(chalk.green('Created plugin template:'));
      console.log(chalk.cyan(`  ${pluginPath}`));
      console.log();
      console.log(chalk.dim('Next steps:'));
      console.log(chalk.dim('  1. Edit the plugin file to add custom stages or personas'));
      console.log(chalk.dim('  2. Run ') + chalk.cyan('swarm plugin list') + chalk.dim(' to verify'));
    });
}
