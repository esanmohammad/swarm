import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import type { StageName } from '../types.js';

export interface QualityScore {
  stage: StageName;
  artifact: string;
  overall: number; // 0-100
  dimensions: QualityDimension[];
  timestamp: number;
}

export interface QualityDimension {
  name: string;
  score: number; // 0-100
  detail: string;
}

/** Rubrics for each artifact — scored heuristically (no LLM needed for basic checks) */
const RUBRICS: Record<string, Array<{ name: string; check: (content: string) => { score: number; detail: string } }>> = {
  'REQUIREMENTS.md': [
    {
      name: 'Completeness',
      check: (c) => {
        const required = ['Summary', 'Scope', 'Functional Requirements', 'Data Requirements', 'Non-Functional Requirements', 'Testing', 'Open Questions'];
        const found = required.filter(s => new RegExp(`#{1,4}\\s+.*${s}`, 'i').test(c));
        const score = Math.round((found.length / required.length) * 100);
        return { score, detail: `${found.length}/${required.length} required sections present` };
      },
    },
    {
      name: 'User Stories',
      check: (c) => {
        const stories = (c.match(/As a .+? I want .+? So that/gi) ?? []).length;
        const score = stories >= 5 ? 100 : stories >= 3 ? 75 : stories >= 1 ? 50 : 0;
        return { score, detail: `${stories} user stories found` };
      },
    },
    {
      name: 'Acceptance Criteria',
      check: (c) => {
        const ac = (c.match(/Given .+? [Ww]hen .+? [Tt]hen/gi) ?? []).length;
        const score = ac >= 5 ? 100 : ac >= 3 ? 75 : ac >= 1 ? 50 : 0;
        return { score, detail: `${ac} Given/When/Then criteria found` };
      },
    },
    {
      name: 'Depth',
      check: (c) => {
        const words = c.trim().split(/\s+/).length;
        const score = words >= 2000 ? 100 : words >= 1000 ? 80 : words >= 500 ? 60 : words >= 200 ? 40 : 20;
        return { score, detail: `${words} words` };
      },
    },
  ],
  'SPEC.md': [
    {
      name: 'Completeness',
      check: (c) => {
        const required = ['Overview', 'Architecture', 'ADR', 'API', 'Data Model', 'Testing Strategy', 'Security'];
        const found = required.filter(s => new RegExp(`#{1,4}\\s+.*${s}`, 'i').test(c));
        const score = Math.round((found.length / required.length) * 100);
        return { score, detail: `${found.length}/${required.length} required sections present` };
      },
    },
    {
      name: 'Diagrams',
      check: (c) => {
        const mermaid = (c.match(/```mermaid/g) ?? []).length;
        const score = mermaid >= 3 ? 100 : mermaid >= 2 ? 80 : mermaid >= 1 ? 60 : 0;
        return { score, detail: `${mermaid} Mermaid diagrams` };
      },
    },
    {
      name: 'ADRs',
      check: (c) => {
        const adrs = (c.match(/ADR-\d/g) ?? []).length;
        const score = adrs >= 3 ? 100 : adrs >= 2 ? 75 : adrs >= 1 ? 50 : 0;
        return { score, detail: `${adrs} Architecture Decision Records` };
      },
    },
    {
      name: 'Depth',
      check: (c) => {
        const words = c.trim().split(/\s+/).length;
        const score = words >= 3000 ? 100 : words >= 1500 ? 80 : words >= 800 ? 60 : words >= 400 ? 40 : 20;
        return { score, detail: `${words} words` };
      },
    },
  ],
  'TASKS.md': [
    {
      name: 'Task Count',
      check: (c) => {
        const tasks = (c.match(/^-\s+\[\s*\]/gm) ?? []).length;
        const score = tasks >= 15 ? 100 : tasks >= 10 ? 80 : tasks >= 5 ? 60 : tasks >= 1 ? 40 : 0;
        return { score, detail: `${tasks} tasks defined` };
      },
    },
    {
      name: 'Parallelization',
      check: (c) => {
        const parallel = (c.match(/\[P\]/g) ?? []).length;
        const total = (c.match(/^-\s+\[\s*\]/gm) ?? []).length;
        const ratio = total > 0 ? parallel / total : 0;
        const score = ratio >= 0.5 ? 100 : ratio >= 0.3 ? 75 : ratio > 0 ? 50 : 0;
        return { score, detail: `${parallel}/${total} tasks marked parallel` };
      },
    },
    {
      name: 'File Paths',
      check: (c) => {
        const paths = (c.match(/`[^`]+\.[a-z]{1,4}`/g) ?? []).length;
        const tasks = (c.match(/^-\s+\[\s*\]/gm) ?? []).length;
        const ratio = tasks > 0 ? paths / tasks : 0;
        const score = ratio >= 0.8 ? 100 : ratio >= 0.5 ? 70 : ratio > 0 ? 40 : 0;
        return { score, detail: `${paths} file paths for ${tasks} tasks` };
      },
    },
    {
      name: 'Acceptance Criteria',
      check: (c) => {
        const ac = (c.match(/AC:/g) ?? []).length;
        const tasks = (c.match(/^-\s+\[\s*\]/gm) ?? []).length;
        const ratio = tasks > 0 ? ac / tasks : 0;
        const score = ratio >= 0.8 ? 100 : ratio >= 0.5 ? 70 : ratio > 0 ? 40 : 0;
        return { score, detail: `${ac} AC markers for ${tasks} tasks` };
      },
    },
  ],
  'TESTPLAN.md': [
    {
      name: 'Test Cases',
      check: (c) => {
        const cases = (c.match(/TC-\d{3}/g) ?? []).length;
        const score = cases >= 10 ? 100 : cases >= 5 ? 75 : cases >= 3 ? 50 : cases >= 1 ? 30 : 0;
        return { score, detail: `${cases} test cases defined` };
      },
    },
    {
      name: 'Coverage',
      check: (c) => {
        const sections = ['Overview', 'Test Strategy', 'Test Cases', 'Acceptance Criteria'];
        const found = sections.filter(s => new RegExp(`#{1,4}\\s+.*${s}`, 'i').test(c));
        const score = Math.round((found.length / sections.length) * 100);
        return { score, detail: `${found.length}/${sections.length} sections` };
      },
    },
    {
      name: 'Test File Paths',
      check: (c) => {
        const paths = (c.match(/[a-z0-9/-]+\.spec\.[a-z]+/g) ?? []).length;
        const score = paths >= 5 ? 100 : paths >= 3 ? 75 : paths >= 1 ? 50 : 0;
        return { score, detail: `${paths} test file paths` };
      },
    },
  ],
};

const STAGE_ARTIFACT: Record<StageName, string> = {
  analyze: 'REQUIREMENTS.md',
  architect: 'SPEC.md',
  plan: 'TASKS.md',
  build: '', // no single artifact
  test: 'TESTPLAN.md',
  evaluate: '',
};

export class QualityScorer {
  /** Score a single artifact */
  scoreArtifact(cwd: string, stage: StageName): QualityScore | null {
    const artifact = STAGE_ARTIFACT[stage];
    if (!artifact) return null;

    const filePath = join(cwd, artifact);
    if (!existsSync(filePath)) return null;

    const content = readFileSync(filePath, 'utf-8');
    const rubric = RUBRICS[artifact];
    if (!rubric) return null;

    const dimensions: QualityDimension[] = rubric.map(r => {
      const result = r.check(content);
      return { name: r.name, score: result.score, detail: result.detail };
    });

    const overall = Math.round(dimensions.reduce((sum, d) => sum + d.score, 0) / dimensions.length);

    return { stage, artifact, overall, dimensions, timestamp: Date.now() };
  }

  /** Score all available artifacts */
  scoreAll(cwd: string): QualityScore[] {
    const stages: StageName[] = ['analyze', 'architect', 'plan', 'test'];
    return stages
      .map(s => this.scoreArtifact(cwd, s))
      .filter((s): s is QualityScore => s !== null);
  }

  /** Run an LLM-based quality evaluation using claude CLI (expensive — use sparingly) */
  async scoreLLM(cwd: string, artifact: string, model = 'haiku'): Promise<QualityDimension | null> {
    const filePath = join(cwd, artifact);
    if (!existsSync(filePath)) return null;

    const content = readFileSync(filePath, 'utf-8');
    if (content.length > 50000) return null; // Too large for a quick eval

    const prompt = [
      `Score the quality of this ${artifact} on a scale of 0-100.`,
      'Evaluate: completeness, clarity, consistency, actionability.',
      'Respond with ONLY a JSON object: {"score": <number>, "detail": "<one sentence>"}',
      '',
      '---',
      content.slice(0, 30000),
    ].join('\n');

    try {
      const result = execSync(
        `claude -p "${prompt.replace(/"/g, '\\"')}" --model ${model} --max-budget-usd 0.50`,
        { cwd, stdio: ['pipe', 'pipe', 'pipe'], timeout: 60000 },
      ).toString();

      const match = result.match(/\{[^}]+\}/);
      if (match) {
        const parsed = JSON.parse(match[0]) as { score: number; detail: string };
        return { name: 'LLM Quality', score: parsed.score, detail: parsed.detail };
      }
    } catch {
      // LLM eval failed — non-critical
    }

    return null;
  }
}
