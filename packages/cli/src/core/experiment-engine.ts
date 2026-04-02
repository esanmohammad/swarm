import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { ExperimentDefinition, ExperimentResult, ExperimentState } from '../types.js';

type Experiment = ExperimentState['experiments'][number];

const EXPERIMENTS_FILE = 'experiments.json';

function emptyState(): ExperimentState {
  return {
    experiments: [],
    flagProvider: 'local',
    totalExperiments: 0,
    activeCount: 0,
  };
}

export class ExperimentEngine {
  private swarmDir: string;
  private state: ExperimentState;

  constructor(swarmDir: string) {
    this.swarmDir = swarmDir;
    this.state = this.load();
  }

  // ─── Persistence ────────────────────────────────────────────

  private filePath(): string {
    return join(this.swarmDir, EXPERIMENTS_FILE);
  }

  private load(): ExperimentState {
    const fp = this.filePath();
    if (!existsSync(fp)) return emptyState();
    try {
      const raw = readFileSync(fp, 'utf-8');
      return JSON.parse(raw) as ExperimentState;
    } catch {
      return emptyState();
    }
  }

  private save(): void {
    if (!existsSync(this.swarmDir)) {
      mkdirSync(this.swarmDir, { recursive: true });
    }
    this.state.totalExperiments = this.state.experiments.length;
    this.state.activeCount = this.state.experiments.filter(
      e => e.status === 'running' || e.status === 'analyzing',
    ).length;
    writeFileSync(this.filePath(), JSON.stringify(this.state, null, 2));
  }

  // ─── Lifecycle ──────────────────────────────────────────────

  create(def: ExperimentDefinition): Experiment {
    const existing = this.state.experiments.find(e => e.name === def.name);
    if (existing) {
      throw new Error(`Experiment "${def.name}" already exists (status: ${existing.status})`);
    }

    const experiment: Experiment = {
      id: randomUUID(),
      name: def.name,
      hypothesis: def.hypothesis,
      flag: def.flag,
      status: 'draft',
      currentPercentage: 0,
      rampSchedule: def.targeting.rampSchedule,
      duration: def.duration,
      results: [],
      guardrailStatus: 'ok',
      sampleSize: 0,
    };

    this.state.experiments.push(experiment);
    this.save();
    return experiment;
  }

  start(name: string): Experiment {
    const exp = this.findOrThrow(name);
    if (exp.status !== 'draft') {
      throw new Error(`Cannot start experiment "${name}" — current status: ${exp.status}`);
    }

    exp.status = 'running';
    exp.startedAt = Date.now();
    exp.currentPercentage = exp.rampSchedule.length > 0 ? exp.rampSchedule[0] : 10;
    this.save();
    return exp;
  }

  analyze(name: string): ExperimentResult[] {
    const exp = this.findOrThrow(name);
    if (exp.status !== 'running' && exp.status !== 'analyzing') {
      throw new Error(`Cannot analyze experiment "${name}" — current status: ${exp.status}`);
    }

    exp.status = 'analyzing';

    // Generate simulated results for demonstration purposes.
    // In production this would pull real metric data from an analytics provider.
    const results = this.runStatisticalAnalysis(exp);
    exp.results = results;

    // Derive recommendation from results
    const allSignificant = results.length > 0 && results.every(r => r.significant);
    const anyNegative = results.some(r => r.liftPercent < 0 && r.significant);
    const guardrailBreached = exp.guardrailStatus === 'breached';

    if (guardrailBreached || anyNegative) {
      exp.recommendation = 'kill';
    } else if (allSignificant) {
      exp.recommendation = 'ship';
    } else if (exp.sampleSize < (exp.rampSchedule[exp.rampSchedule.length - 1] || 100)) {
      exp.recommendation = 'ramp';
    } else {
      exp.recommendation = 'extend';
    }

    this.save();
    return results;
  }

  ship(name: string): Experiment {
    const exp = this.findOrThrow(name);
    if (exp.status !== 'running' && exp.status !== 'analyzing') {
      throw new Error(`Cannot ship experiment "${name}" — current status: ${exp.status}`);
    }

    exp.status = 'shipped';
    exp.currentPercentage = 100;
    exp.endedAt = Date.now();
    this.save();
    return exp;
  }

  kill(name: string): Experiment {
    const exp = this.findOrThrow(name);
    if (exp.status === 'shipped' || exp.status === 'killed') {
      throw new Error(`Experiment "${name}" is already ${exp.status}`);
    }

    exp.status = 'killed';
    exp.currentPercentage = 0;
    exp.endedAt = Date.now();
    this.save();
    return exp;
  }

  // ─── Queries ────────────────────────────────────────────────

  getState(): ExperimentState {
    return this.state;
  }

  getExperiment(name: string): Experiment | undefined {
    return this.state.experiments.find(e => e.name === name);
  }

  getActive(): Experiment[] {
    return this.state.experiments.filter(e => e.status === 'running' || e.status === 'analyzing');
  }

  getHistory(): Experiment[] {
    return this.state.experiments.filter(e => e.status === 'shipped' || e.status === 'killed');
  }

  // ─── Guardrails ─────────────────────────────────────────────

  checkGuardrails(name: string): { status: 'ok' | 'warning' | 'breached'; details: string[] } {
    const exp = this.findOrThrow(name);
    const details: string[] = [];
    let status: 'ok' | 'warning' | 'breached' = 'ok';

    // Check duration guardrail
    if (exp.startedAt) {
      const elapsedDays = (Date.now() - exp.startedAt) / (1000 * 60 * 60 * 24);
      if (elapsedDays > exp.duration * 1.5) {
        status = 'breached';
        details.push(`Duration exceeded: ${elapsedDays.toFixed(1)}d vs ${exp.duration}d limit`);
      } else if (elapsedDays > exp.duration) {
        status = 'warning';
        details.push(`Duration warning: ${elapsedDays.toFixed(1)}d vs ${exp.duration}d limit`);
      }
    }

    // Check for negative results on guardrail metrics
    for (const result of exp.results) {
      if (result.liftPercent < -5 && result.significant) {
        status = 'breached';
        details.push(`Metric "${result.metric}" regressed: ${result.liftPercent.toFixed(1)}% (p=${result.pValue.toFixed(4)})`);
      } else if (result.liftPercent < 0) {
        if (status !== 'breached') status = 'warning';
        details.push(`Metric "${result.metric}" trending negative: ${result.liftPercent.toFixed(1)}%`);
      }
    }

    exp.guardrailStatus = status;
    this.save();

    return { status, details };
  }

  // ─── Ramp Schedule ──────────────────────────────────────────

  ramp(name: string): Experiment {
    const exp = this.findOrThrow(name);
    if (exp.status !== 'running') {
      throw new Error(`Cannot ramp experiment "${name}" — current status: ${exp.status}`);
    }

    const currentIdx = exp.rampSchedule.indexOf(exp.currentPercentage);
    const nextIdx = currentIdx + 1;

    if (nextIdx >= exp.rampSchedule.length) {
      throw new Error(`Experiment "${name}" is already at max ramp (${exp.currentPercentage}%)`);
    }

    exp.currentPercentage = exp.rampSchedule[nextIdx];
    this.save();
    return exp;
  }

  // ─── Statistical Analysis ──────────────────────────────────

  private runStatisticalAnalysis(exp: Experiment): ExperimentResult[] {
    // Simulated analysis — in production, this would ingest real metric data.
    // We generate a plausible result based on the experiment's current state.
    const elapsed = exp.startedAt ? (Date.now() - exp.startedAt) / (1000 * 60 * 60 * 24) : 0;
    const estimatedSamples = Math.floor(exp.currentPercentage * elapsed * 10);
    exp.sampleSize = Math.max(estimatedSamples, exp.sampleSize);

    // Primary metric result via simulated z-test
    const controlMean = 100;
    const treatmentMean = controlMean * (1 + (Math.random() * 0.1 - 0.02)); // slight positive bias
    const stddev = controlMean * 0.15;
    const n = Math.max(exp.sampleSize, 30);

    const result = this.zTest(
      { mean: controlMean, stddev, sampleSize: n },
      { mean: treatmentMean, stddev: stddev * 0.95, sampleSize: n },
      'primary',
    );

    return [result];
  }

  private zTest(
    control: { mean: number; stddev: number; sampleSize: number },
    treatment: { mean: number; stddev: number; sampleSize: number },
    metric: string,
    significanceLevel = 0.05,
  ): ExperimentResult {
    const pooledSE = Math.sqrt(
      (control.stddev ** 2) / control.sampleSize +
      (treatment.stddev ** 2) / treatment.sampleSize,
    );

    const zScore = pooledSE > 0
      ? (treatment.mean - control.mean) / pooledSE
      : 0;

    // Approximate two-tailed p-value using normal CDF approximation
    const pValue = 2 * (1 - this.normalCDF(Math.abs(zScore)));
    const liftPercent = control.mean !== 0
      ? ((treatment.mean - control.mean) / control.mean) * 100
      : 0;

    return {
      metric,
      control,
      treatment,
      pValue,
      significant: pValue < significanceLevel,
      liftPercent,
    };
  }

  /** Approximation of the standard normal CDF (Abramowitz & Stegun). */
  private normalCDF(x: number): number {
    const a1 = 0.254829592;
    const a2 = -0.284496736;
    const a3 = 1.421413741;
    const a4 = -1.453152027;
    const a5 = 1.061405429;
    const p = 0.3275911;

    const sign = x < 0 ? -1 : 1;
    x = Math.abs(x) / Math.SQRT2;

    const t = 1.0 / (1.0 + p * x);
    const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);

    return 0.5 * (1.0 + sign * y);
  }

  // ─── Helpers ────────────────────────────────────────────────

  private findOrThrow(name: string): Experiment {
    const exp = this.state.experiments.find(e => e.name === name);
    if (!exp) {
      throw new Error(`Experiment "${name}" not found`);
    }
    return exp;
  }
}
