/**
 * Telemetry module — opt-in, local-only anonymous usage statistics.
 *
 * All data is stored at ~/.swarm/telemetry.json. Nothing is sent remotely.
 * Telemetry is OFF by default; users must explicitly enable it via `swarm telemetry on`.
 *
 * ── Pipeline integration point ──
 * To wire telemetry into the pipeline, add calls in `packages/cli/src/core/pipeline.ts`:
 *
 *   import { Telemetry } from './telemetry.js';
 *   const telemetry = new Telemetry();
 *
 *   // After each stage completes (in runStage / runMayday):
 *   telemetry.record({
 *     type: 'stage-run',
 *     stage: stageName,          // e.g. 'analyze', 'build'
 *     status: 'success',         // or 'error'
 *     cost: agent.cost.totalUsd,
 *     duration: Date.now() - stageStartedAt,
 *     stack: config.stack,
 *     model: agent.model,
 *   });
 *
 *   // After a full pipeline run completes:
 *   telemetry.record({
 *     type: 'pipeline-run',
 *     stages: ['analyze', 'architect', 'plan', 'build', 'test'],
 *     totalCost: state.totalCost.totalUsd,
 *     duration: Date.now() - pipelineStartedAt,
 *     success: true,
 *   });
 *
 *   // After each fix loop iteration:
 *   telemetry.record({
 *     type: 'fix-iteration',
 *     iteration: currentIteration,
 *     fixed: fixedCount,
 *     remaining: remainingCount,
 *   });
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

// ── Event types ──

export interface StageRunEvent {
  type: 'stage-run';
  stage: string;
  status: 'success' | 'error';
  cost: number;
  duration: number;
  stack?: string;
  model?: string;
}

export interface PipelineRunEvent {
  type: 'pipeline-run';
  stages: string[];
  totalCost: number;
  duration: number;
  success: boolean;
}

export interface FixIterationEvent {
  type: 'fix-iteration';
  iteration: number;
  fixed: number;
  remaining: number;
}

export type TelemetryEvent = StageRunEvent | PipelineRunEvent | FixIterationEvent;

// ── Persisted data shape ──

export interface StageStats {
  runs: number;
  successes: number;
  failures: number;
  totalCost: number;
  totalDuration: number;
}

export interface TelemetryData {
  enabled: boolean;
  firstRecordedAt: number | null;
  lastRecordedAt: number | null;

  /** Per-stage aggregated stats */
  stages: Record<string, StageStats>;

  /** Pipeline run totals */
  pipelineRuns: number;
  pipelineSuccesses: number;
  pipelineFailures: number;
  pipelineTotalCost: number;
  pipelineTotalDuration: number;

  /** Stack usage counts */
  stacks: Record<string, number>;

  /** Model usage counts */
  models: Record<string, number>;

  /** Fix loop stats */
  fixIterationsTotal: number;
  fixIterationsMax: number;
  fixTotalFixed: number;
  fixTotalRemaining: number;
  fixLoopRuns: number;
}

function emptyData(): TelemetryData {
  return {
    enabled: false,
    firstRecordedAt: null,
    lastRecordedAt: null,
    stages: {},
    pipelineRuns: 0,
    pipelineSuccesses: 0,
    pipelineFailures: 0,
    pipelineTotalCost: 0,
    pipelineTotalDuration: 0,
    stacks: {},
    models: {},
    fixIterationsTotal: 0,
    fixIterationsMax: 0,
    fixTotalFixed: 0,
    fixTotalRemaining: 0,
    fixLoopRuns: 0,
  };
}

export class Telemetry {
  private filePath: string;
  private data: TelemetryData;

  constructor(baseDir?: string) {
    const dir = baseDir ?? join(homedir(), '.swarm');
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    this.filePath = join(dir, 'telemetry.json');
    this.data = this.load();
  }

  // ── Public API ──

  isEnabled(): boolean {
    return this.data.enabled;
  }

  setEnabled(enabled: boolean): void {
    this.data.enabled = enabled;
    this.save();
  }

  reset(): void {
    const wasEnabled = this.data.enabled;
    this.data = emptyData();
    this.data.enabled = wasEnabled;
    this.save();
  }

  record(event: TelemetryEvent): void {
    if (!this.data.enabled) return;

    const now = Date.now();
    if (!this.data.firstRecordedAt) this.data.firstRecordedAt = now;
    this.data.lastRecordedAt = now;

    switch (event.type) {
      case 'stage-run':
        this.recordStageRun(event);
        break;
      case 'pipeline-run':
        this.recordPipelineRun(event);
        break;
      case 'fix-iteration':
        this.recordFixIteration(event);
        break;
    }

    this.save();
  }

  getData(): TelemetryData {
    return { ...this.data };
  }

  getSummary(): string {
    const d = this.data;
    const lines: string[] = [];

    // Header
    lines.push('');
    lines.push('  SWARM TELEMETRY — Local Usage Statistics');
    lines.push('  ========================================');
    lines.push('');

    if (!d.firstRecordedAt) {
      lines.push('  No data recorded yet. Run some pipelines to see stats!');
      lines.push('');
      return lines.join('\n');
    }

    // Time range
    const first = new Date(d.firstRecordedAt).toLocaleDateString();
    const last = new Date(d.lastRecordedAt!).toLocaleDateString();
    lines.push(`  Tracking since: ${first}  |  Last activity: ${last}`);
    lines.push('');

    // Pipeline overview
    lines.push('  PIPELINE RUNS');
    lines.push('  ─────────────');
    lines.push(`  Total runs:     ${d.pipelineRuns}`);
    lines.push(`  Successes:      ${d.pipelineSuccesses}`);
    lines.push(`  Failures:       ${d.pipelineFailures}`);
    if (d.pipelineRuns > 0) {
      const successRate = ((d.pipelineSuccesses / d.pipelineRuns) * 100).toFixed(1);
      const avgCost = (d.pipelineTotalCost / d.pipelineRuns).toFixed(4);
      const avgDuration = formatDuration(d.pipelineTotalDuration / d.pipelineRuns);
      lines.push(`  Success rate:   ${successRate}%`);
      lines.push(`  Total cost:     $${d.pipelineTotalCost.toFixed(4)}`);
      lines.push(`  Avg cost/run:   $${avgCost}`);
      lines.push(`  Avg duration:   ${avgDuration}`);
    }
    lines.push('');

    // Stage breakdown
    const stageNames = Object.keys(d.stages);
    if (stageNames.length > 0) {
      lines.push('  STAGE BREAKDOWN');
      lines.push('  ───────────────');
      const header = '  ' + 'Stage'.padEnd(14) + 'Runs'.padEnd(8) + 'OK'.padEnd(6) + 'Fail'.padEnd(8) + 'Avg Cost'.padEnd(12) + 'Avg Time';
      lines.push(header);
      lines.push('  ' + '─'.repeat(60));

      for (const name of stageNames) {
        const s = d.stages[name];
        const avgCost = s.runs > 0 ? `$${(s.totalCost / s.runs).toFixed(4)}` : '$0.0000';
        const avgTime = s.runs > 0 ? formatDuration(s.totalDuration / s.runs) : '—';
        lines.push(
          '  ' +
          name.padEnd(14) +
          String(s.runs).padEnd(8) +
          String(s.successes).padEnd(6) +
          String(s.failures).padEnd(8) +
          avgCost.padEnd(12) +
          avgTime
        );
      }
      lines.push('');
    }

    // Models & stacks
    const modelEntries = Object.entries(d.models).sort((a, b) => b[1] - a[1]);
    const stackEntries = Object.entries(d.stacks).sort((a, b) => b[1] - a[1]);

    if (modelEntries.length > 0 || stackEntries.length > 0) {
      lines.push('  USAGE PATTERNS');
      lines.push('  ──────────────');
      if (modelEntries.length > 0) {
        lines.push(`  Models:  ${modelEntries.map(([m, c]) => `${m} (${c})`).join(', ')}`);
      }
      if (stackEntries.length > 0) {
        lines.push(`  Stacks:  ${stackEntries.map(([s, c]) => `${s} (${c})`).join(', ')}`);
      }
      lines.push('');
    }

    // Fix loop stats
    if (d.fixLoopRuns > 0) {
      const avgIterations = (d.fixIterationsTotal / d.fixLoopRuns).toFixed(1);
      lines.push('  FIX LOOP STATS');
      lines.push('  ──────────────');
      lines.push(`  Total fix loops:    ${d.fixLoopRuns}`);
      lines.push(`  Avg iterations:     ${avgIterations}`);
      lines.push(`  Max iterations:     ${d.fixIterationsMax}`);
      lines.push(`  Total tests fixed:  ${d.fixTotalFixed}`);
      lines.push('');
    }

    return lines.join('\n');
  }

  // ── Private helpers ──

  private recordStageRun(event: StageRunEvent): void {
    const stage = event.stage;
    if (!this.data.stages[stage]) {
      this.data.stages[stage] = { runs: 0, successes: 0, failures: 0, totalCost: 0, totalDuration: 0 };
    }
    const s = this.data.stages[stage];
    s.runs++;
    if (event.status === 'success') {
      s.successes++;
    } else {
      s.failures++;
    }
    s.totalCost += event.cost;
    s.totalDuration += event.duration;

    if (event.stack) {
      this.data.stacks[event.stack] = (this.data.stacks[event.stack] || 0) + 1;
    }
    if (event.model) {
      this.data.models[event.model] = (this.data.models[event.model] || 0) + 1;
    }
  }

  private recordPipelineRun(event: PipelineRunEvent): void {
    this.data.pipelineRuns++;
    if (event.success) {
      this.data.pipelineSuccesses++;
    } else {
      this.data.pipelineFailures++;
    }
    this.data.pipelineTotalCost += event.totalCost;
    this.data.pipelineTotalDuration += event.duration;
  }

  private recordFixIteration(event: FixIterationEvent): void {
    // Each fix-iteration event with iteration === 1 starts a new fix loop run
    if (event.iteration === 1) {
      this.data.fixLoopRuns++;
    }
    this.data.fixIterationsTotal++;
    if (event.iteration > this.data.fixIterationsMax) {
      this.data.fixIterationsMax = event.iteration;
    }
    this.data.fixTotalFixed += event.fixed;
    this.data.fixTotalRemaining += event.remaining;
  }

  private load(): TelemetryData {
    if (!existsSync(this.filePath)) return emptyData();
    try {
      const raw = readFileSync(this.filePath, 'utf-8');
      const parsed = JSON.parse(raw) as Partial<TelemetryData>;
      return { ...emptyData(), ...parsed };
    } catch {
      return emptyData();
    }
  }

  private save(): void {
    try {
      writeFileSync(this.filePath, JSON.stringify(this.data, null, 2) + '\n');
    } catch {
      // Non-critical — don't crash if telemetry write fails
    }
  }
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const minutes = Math.floor(seconds / 60);
  const secs = Math.round(seconds % 60);
  if (minutes < 60) return `${minutes}m ${secs}s`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${hours}h ${mins}m`;
}
