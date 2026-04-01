import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import type { Persona, StageName } from '../types.js';

/**
 * Definition of a single pipeline stage from `.swarm/pipeline.yaml`.
 */
export interface PipelineStageDefinition {
  /** Unique stage name (used as key in state tracking) */
  name: string;
  /** Which persona runs this stage */
  persona: Persona;
  /** Expected output artifact filename (e.g. "REQUIREMENTS.md") */
  artifact?: string;
  /** Stage names that must complete before this stage starts */
  dependsOn?: string[];
  /** Whether this stage can run in parallel with other parallel-eligible stages */
  parallel?: boolean;
  /** Condition to check before running; stage is skipped if condition fails.
   *  Format: "file-exists:FILENAME" */
  condition?: string;
  /** Custom prompt to pass to the agent (appended to the default stage prompt) */
  prompt?: string;
}

/**
 * Full pipeline definition loaded from YAML.
 */
export interface PipelineDefinition {
  stages: PipelineStageDefinition[];
}

/** Valid persona values for validation */
const VALID_PERSONAS: ReadonlySet<string> = new Set<Persona>([
  'analyst', 'architect', 'lead', 'engineer', 'tester',
]);

/**
 * Map a custom stage name to the closest StageName for state tracking.
 * Custom stages that don't match a known stage get mapped to 'evaluate' (the catch-all).
 */
export function stageNameForDefinition(def: PipelineStageDefinition): StageName {
  const personaStageMap: Record<Persona, StageName> = {
    analyst: 'analyze',
    architect: 'architect',
    lead: 'plan',
    engineer: 'build',
    tester: 'test',
  };
  return personaStageMap[def.persona] ?? 'evaluate';
}

/**
 * Load a custom pipeline definition from `.swarm/pipeline.yaml`.
 * Returns null if the file does not exist.
 */
export function loadPipelineDefinition(swarmDir: string): PipelineDefinition | null {
  const yamlPath = join(swarmDir, 'pipeline.yaml');
  if (!existsSync(yamlPath)) {
    return null;
  }

  const raw = readFileSync(yamlPath, 'utf-8');
  const parsed = parseYaml(raw) as Record<string, unknown>;

  if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.stages)) {
    throw new Error(
      `Invalid pipeline.yaml: expected top-level "stages" array. Got: ${JSON.stringify(Object.keys(parsed ?? {}))}`
    );
  }

  const stages: PipelineStageDefinition[] = (parsed.stages as Record<string, unknown>[]).map((s, i) => {
    if (!s.name || typeof s.name !== 'string') {
      throw new Error(`pipeline.yaml: stage[${i}] missing required "name" field`);
    }
    if (!s.persona || typeof s.persona !== 'string') {
      throw new Error(`pipeline.yaml: stage[${i}] ("${s.name}") missing required "persona" field`);
    }
    return {
      name: s.name as string,
      persona: s.persona as Persona,
      artifact: s.artifact as string | undefined,
      dependsOn: Array.isArray(s.dependsOn) ? (s.dependsOn as string[]) : undefined,
      parallel: typeof s.parallel === 'boolean' ? s.parallel : undefined,
      condition: typeof s.condition === 'string' ? s.condition : undefined,
      prompt: typeof s.prompt === 'string' ? s.prompt : undefined,
    };
  });

  const definition: PipelineDefinition = { stages };

  const errors = validateDefinition(definition);
  if (errors.length > 0) {
    throw new Error(`Invalid pipeline.yaml:\n  - ${errors.join('\n  - ')}`);
  }

  return definition;
}

/**
 * Return the standard 5-stage pipeline definition (analyze -> architect -> plan -> build -> test).
 */
export function getDefaultPipelineDefinition(): PipelineDefinition {
  return {
    stages: [
      {
        name: 'analyze',
        persona: 'analyst',
        artifact: 'REQUIREMENTS.md',
      },
      {
        name: 'architect',
        persona: 'architect',
        artifact: 'SPEC.md',
        dependsOn: ['analyze'],
      },
      {
        name: 'plan',
        persona: 'lead',
        artifact: 'TASKS.md',
        dependsOn: ['architect'],
      },
      {
        name: 'build',
        persona: 'engineer',
        dependsOn: ['plan'],
      },
      {
        name: 'test',
        persona: 'tester',
        artifact: 'TESTPLAN.md',
        dependsOn: ['build'],
      },
    ],
  };
}

/**
 * Validate a pipeline definition. Returns an array of error messages (empty = valid).
 */
export function validateDefinition(def: PipelineDefinition): string[] {
  const errors: string[] = [];

  if (!def.stages || def.stages.length === 0) {
    errors.push('Pipeline must have at least one stage');
    return errors;
  }

  // Check for duplicate names
  const names = new Set<string>();
  for (const stage of def.stages) {
    if (names.has(stage.name)) {
      errors.push(`Duplicate stage name: "${stage.name}"`);
    }
    names.add(stage.name);
  }

  // Validate each stage
  for (const stage of def.stages) {
    // Valid persona
    if (!VALID_PERSONAS.has(stage.persona)) {
      errors.push(
        `Stage "${stage.name}": invalid persona "${stage.persona}". ` +
        `Must be one of: ${[...VALID_PERSONAS].join(', ')}`
      );
    }

    // dependsOn references exist
    if (stage.dependsOn) {
      for (const dep of stage.dependsOn) {
        if (!names.has(dep)) {
          errors.push(`Stage "${stage.name}": depends on unknown stage "${dep}"`);
        }
      }
    }

    // Validate condition format
    if (stage.condition) {
      if (!stage.condition.startsWith('file-exists:')) {
        errors.push(
          `Stage "${stage.name}": invalid condition "${stage.condition}". ` +
          `Supported formats: "file-exists:FILENAME"`
        );
      }
    }
  }

  // Check for circular dependencies
  const circularError = detectCircularDeps(def.stages);
  if (circularError) {
    errors.push(circularError);
  }

  return errors;
}

/**
 * Detect circular dependencies via topological sort.
 * Returns an error string if a cycle is found, null otherwise.
 */
function detectCircularDeps(stages: PipelineStageDefinition[]): string | null {
  const visited = new Set<string>();
  const visiting = new Set<string>();
  const stageMap = new Map<string, PipelineStageDefinition>();

  for (const s of stages) {
    stageMap.set(s.name, s);
  }

  function visit(name: string): string | null {
    if (visiting.has(name)) {
      return `Circular dependency detected involving stage "${name}"`;
    }
    if (visited.has(name)) {
      return null;
    }

    visiting.add(name);
    const stage = stageMap.get(name);
    if (stage?.dependsOn) {
      for (const dep of stage.dependsOn) {
        const err = visit(dep);
        if (err) return err;
      }
    }
    visiting.delete(name);
    visited.add(name);
    return null;
  }

  for (const s of stages) {
    const err = visit(s.name);
    if (err) return err;
  }

  return null;
}
