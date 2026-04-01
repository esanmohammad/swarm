import { existsSync, readdirSync } from 'node:fs';
import { join, resolve, isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { StageName, TechStack, Persona } from '../types.js';

// ---------------------------------------------------------------------------
// Plugin interfaces
// ---------------------------------------------------------------------------

export interface CustomStagePlugin {
  /** Unique stage name (e.g. 'security-scan', 'lint') */
  name: string;
  /** Which persona runs this stage */
  persona: Persona;
  /** Expected artifact filename (optional) */
  artifact?: string;
  /** System prompt for the agent */
  prompt: string;
  /** Insert this stage before an existing stage */
  before?: StageName;
  /** Insert this stage after an existing stage */
  after?: StageName;
}

export interface CustomPersonaPlugin {
  /** Persona identifier (e.g. 'security-reviewer') */
  name: string;
  /** Human-readable description */
  description: string;
  /** System prompt template. May contain {{stack}} placeholder. */
  promptTemplate: string;
  /** Restrict to certain stacks (empty = all stacks) */
  stack?: TechStack[];
}

export interface SwarmPlugin {
  /** Plugin name (should be unique) */
  name: string;
  /** Semver version */
  version: string;
  /** Short description */
  description: string;
  /** Custom pipeline stages provided by this plugin */
  stages?: CustomStagePlugin[];
  /** Custom personas provided by this plugin */
  personas?: CustomPersonaPlugin[];
}

// ---------------------------------------------------------------------------
// PluginLoader
// ---------------------------------------------------------------------------

export class PluginLoader {
  private swarmDir: string;
  private projectRoot: string;
  private configPlugins: string[];
  private loaded: SwarmPlugin[] | null = null;

  constructor(swarmDir: string, configPlugins: string[] = []) {
    this.swarmDir = swarmDir;
    this.projectRoot = resolve(swarmDir, '..');
    this.configPlugins = configPlugins;
  }

  /**
   * Discover and load all plugins from the three sources:
   *   1. `.swarm/plugins/` — local JS files (default-export a SwarmPlugin)
   *   2. `node_modules/swarm-plugin-*` — npm packages
   *   3. `config.plugins[]` — explicit package names or local paths
   */
  async loadAll(): Promise<SwarmPlugin[]> {
    if (this.loaded) return this.loaded;

    const plugins: SwarmPlugin[] = [];
    const seen = new Set<string>();

    const add = (p: SwarmPlugin) => {
      if (seen.has(p.name)) return;
      seen.add(p.name);
      plugins.push(p);
    };

    // 1. Local plugins from .swarm/plugins/
    const localDir = join(this.swarmDir, 'plugins');
    if (existsSync(localDir)) {
      const files = readdirSync(localDir).filter(
        (f) => f.endsWith('.js') || f.endsWith('.mjs'),
      );
      for (const file of files) {
        const fullPath = join(localDir, file);
        const plugin = await this.importPlugin(fullPath);
        if (plugin) add(plugin);
      }
    }

    // 2. node_modules/swarm-plugin-*
    const nodeModulesDir = join(this.projectRoot, 'node_modules');
    if (existsSync(nodeModulesDir)) {
      const entries = readdirSync(nodeModulesDir).filter((d) =>
        d.startsWith('swarm-plugin-'),
      );
      for (const entry of entries) {
        const fullPath = join(nodeModulesDir, entry);
        const plugin = await this.importPlugin(fullPath);
        if (plugin) add(plugin);
      }
    }

    // 3. Explicit config plugins
    for (const spec of this.configPlugins) {
      const resolved = isAbsolute(spec) ? spec : join(this.projectRoot, spec);
      const plugin = await this.importPlugin(resolved);
      if (plugin) add(plugin);
    }

    this.loaded = plugins;
    return plugins;
  }

  /**
   * Return all custom stages across all loaded plugins, in order.
   */
  async getCustomStages(): Promise<CustomStagePlugin[]> {
    const plugins = await this.loadAll();
    const stages: CustomStagePlugin[] = [];
    for (const plugin of plugins) {
      if (plugin.stages) {
        stages.push(...plugin.stages);
      }
    }
    return stages;
  }

  /**
   * Return all custom personas across all loaded plugins.
   */
  async getCustomPersonas(): Promise<CustomPersonaPlugin[]> {
    const plugins = await this.loadAll();
    const personas: CustomPersonaPlugin[] = [];
    for (const plugin of plugins) {
      if (plugin.personas) {
        personas.push(...plugin.personas);
      }
    }
    return personas;
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  private async importPlugin(pathOrPackage: string): Promise<SwarmPlugin | null> {
    try {
      // For local files, convert to file:// URL for ESM import
      const importPath = existsSync(pathOrPackage)
        ? pathToFileURL(resolve(pathOrPackage)).href
        : pathOrPackage;

      const mod = await import(importPath);
      const plugin: SwarmPlugin = mod.default ?? mod;

      if (!plugin.name || !plugin.version) {
        return null;
      }

      return plugin;
    } catch {
      // Silently skip plugins that fail to load — they may be optional deps
      return null;
    }
  }
}
