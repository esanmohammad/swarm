import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { TrainingExample, TeachState } from '../types.js';

const STATE_PATH = '.swarm/teach-state.json';
const HISTORY_PATH = '.swarm/history.json';

/** Minimum quality score to include in training data */
const MIN_QUALITY = 0.7;

/** Maximum human edit rate to consider an example high-quality */
const MAX_HUMAN_EDIT_RATE = 0.3;

/** History entry as stored in history.json */
interface HistoryEntry {
  id: string;
  type: string;
  taskType?: string;
  input?: string;
  output?: string;
  status: 'success' | 'failure' | 'reverted';
  testsPassed?: boolean;
  humanEdits?: number;
  totalLines?: number;
  quality?: number;
  approvedPr?: boolean;
  timestamp: number;
}

/** Training job status record */
interface TrainingJob {
  id: string;
  model: string;
  status: 'pending' | 'training' | 'complete' | 'failed';
  startedAt: number;
  completedAt?: number;
  metrics?: { loss: number; accuracy: number };
  exampleCount: number;
  taskTypes: string[];
}

/** Deployed model record */
interface DeployedModel {
  id: string;
  taskTypes: string[];
  costReduction: number;
  qualityDelta: number;
  deployedAt: number;
  trainingJobId: string;
}

/** Evaluation result for a model */
interface EvaluationResult {
  modelId: string;
  accuracy: number;
  qualityScore: number;
  costReduction: number;
  taskBreakdown: Array<{ taskType: string; accuracy: number; sampleCount: number }>;
  evaluatedAt: number;
}

export class TrainingPipeline {
  private cwd: string;
  private examples: TrainingExample[] = [];
  private trainingJobs: TrainingJob[] = [];
  private deployedModels: DeployedModel[] = [];
  private lastCollected: number = 0;

  constructor(cwd: string) {
    this.cwd = cwd;
    this.loadState();
  }

  // ── Public API ──────────────────────────────────────────────

  /** Collect training examples from history */
  collect(): TrainingExample[] {
    const history = this.loadHistory();
    const newExamples: TrainingExample[] = [];

    for (const entry of history) {
      // Skip already-collected entries
      if (entry.timestamp <= this.lastCollected) continue;
      // Skip failures and reverted entries
      if (entry.status !== 'success') continue;
      // Need input/output pair
      if (!entry.input || !entry.output) continue;

      const source = this.classifySource(entry);
      const quality = this.computeQuality(entry);

      const example: TrainingExample = {
        id: randomUUID(),
        taskType: entry.taskType ?? entry.type ?? 'unknown',
        input: entry.input,
        output: entry.output,
        quality,
        source,
        collectedAt: Date.now(),
      };

      newExamples.push(example);
    }

    this.examples.push(...newExamples);
    this.lastCollected = Date.now();
    this.persist();

    return newExamples;
  }

  /** Curate the dataset: filter by quality signals */
  curate(): TrainingExample[] {
    const before = this.examples.length;

    this.examples = this.examples.filter(ex => {
      // Must meet minimum quality
      if (ex.quality < MIN_QUALITY) return false;
      // Must have meaningful input and output
      if (ex.input.trim().length < 10) return false;
      if (ex.output.trim().length < 20) return false;
      return true;
    });

    // Deduplicate by input similarity
    this.examples = this.deduplicateExamples(this.examples);

    this.persist();
    return this.examples;
  }

  /** Start a training job (stub for fine-tuning API) */
  train(baseModel: string): TrainingJob {
    if (this.examples.length === 0) {
      throw new Error('No training examples available. Run collect() and curate() first.');
    }

    const taskTypes = [...new Set(this.examples.map(ex => ex.taskType))];

    const job: TrainingJob = {
      id: randomUUID(),
      model: baseModel,
      status: 'pending',
      startedAt: Date.now(),
      exampleCount: this.examples.length,
      taskTypes,
    };

    this.trainingJobs.push(job);

    // Simulate async training start — in production this would call a fine-tuning API
    job.status = 'training';

    this.persist();
    return job;
  }

  /** Evaluate a trained model (stub) */
  evaluate(): EvaluationResult | null {
    const completedJob = this.trainingJobs.find(j => j.status === 'complete');
    if (!completedJob) {
      // If a training job exists, simulate completion for evaluation
      const trainingJob = this.trainingJobs.find(j => j.status === 'training');
      if (trainingJob) {
        trainingJob.status = 'complete';
        trainingJob.completedAt = Date.now();
        trainingJob.metrics = {
          loss: 0.15 + Math.random() * 0.1,
          accuracy: 0.82 + Math.random() * 0.1,
        };
        this.persist();
        return this.evaluateModel(trainingJob);
      }
      return null;
    }

    return this.evaluateModel(completedJob);
  }

  /** Deploy a model (stub) */
  deploy(): DeployedModel | null {
    const completedJob = this.trainingJobs.find(j => j.status === 'complete');
    if (!completedJob) return null;

    const deployed: DeployedModel = {
      id: randomUUID(),
      taskTypes: completedJob.taskTypes,
      costReduction: 0.3 + Math.random() * 0.2,    // 30-50% estimated cost reduction
      qualityDelta: -0.02 + Math.random() * 0.06,   // -2% to +4% quality change
      deployedAt: Date.now(),
      trainingJobId: completedJob.id,
    };

    this.deployedModels.push(deployed);
    this.persist();
    return deployed;
  }

  /** Get current state summary */
  getState(): TeachState {
    const byTaskType: Record<string, number> = {};
    for (const ex of this.examples) {
      byTaskType[ex.taskType] = (byTaskType[ex.taskType] ?? 0) + 1;
    }

    return {
      examples: this.examples.length,
      byTaskType,
      trainingJobs: this.trainingJobs.map(j => ({
        id: j.id,
        model: j.model,
        status: j.status,
        startedAt: j.startedAt,
        completedAt: j.completedAt,
        metrics: j.metrics,
      })),
      deployedModels: this.deployedModels.map(m => ({
        id: m.id,
        taskTypes: m.taskTypes,
        costReduction: m.costReduction,
        qualityDelta: m.qualityDelta,
        deployedAt: m.deployedAt,
      })),
      lastCollected: this.lastCollected,
    };
  }

  // ── Source classification ───────────────────────────────────

  private classifySource(entry: HistoryEntry): TrainingExample['source'] {
    if (entry.approvedPr) return 'approved-pr';
    if (entry.humanEdits && entry.totalLines && entry.humanEdits / entry.totalLines > 0.1) {
      return 'human-edited';
    }
    return 'high-quality';
  }

  // ── Quality scoring ─────────────────────────────────────────

  private computeQuality(entry: HistoryEntry): number {
    let score = 0.5; // base score

    // Tests passing is a strong quality signal
    if (entry.testsPassed) score += 0.2;

    // Low human edit rate indicates good output
    if (entry.humanEdits !== undefined && entry.totalLines && entry.totalLines > 0) {
      const editRate = entry.humanEdits / entry.totalLines;
      if (editRate <= MAX_HUMAN_EDIT_RATE) {
        score += 0.15 * (1 - editRate / MAX_HUMAN_EDIT_RATE);
      }
    }

    // Not reverted is positive
    if (entry.status === 'success') score += 0.1;

    // Approved PRs are highest quality
    if (entry.approvedPr) score += 0.15;

    // Use existing quality field if available
    if (entry.quality !== undefined) {
      score = (score + entry.quality) / 2;
    }

    return Math.min(1.0, Math.round(score * 100) / 100);
  }

  // ── Deduplication ───────────────────────────────────────────

  private deduplicateExamples(examples: TrainingExample[]): TrainingExample[] {
    const seen = new Map<string, TrainingExample>();

    for (const ex of examples) {
      // Simple dedup key: normalized first 200 chars of input
      const key = ex.taskType + '::' + ex.input.trim().slice(0, 200).toLowerCase();
      const existing = seen.get(key);

      if (!existing || ex.quality > existing.quality) {
        seen.set(key, ex);
      }
    }

    return Array.from(seen.values());
  }

  // ── Model evaluation ────────────────────────────────────────

  private evaluateModel(job: TrainingJob): EvaluationResult {
    // Stub evaluation — in production would run examples through the model
    const taskBreakdown = job.taskTypes.map(taskType => {
      const taskExamples = this.examples.filter(ex => ex.taskType === taskType);
      return {
        taskType,
        accuracy: 0.75 + Math.random() * 0.2,
        sampleCount: taskExamples.length,
      };
    });

    const avgAccuracy = taskBreakdown.length > 0
      ? taskBreakdown.reduce((sum, t) => sum + t.accuracy, 0) / taskBreakdown.length
      : 0;

    return {
      modelId: job.id,
      accuracy: Math.round(avgAccuracy * 100) / 100,
      qualityScore: Math.round((avgAccuracy * 0.7 + 0.3) * 100) / 100,
      costReduction: 0.35,
      taskBreakdown,
      evaluatedAt: Date.now(),
    };
  }

  // ── Persistence ─────────────────────────────────────────────

  private loadHistory(): HistoryEntry[] {
    const historyPath = join(this.cwd, HISTORY_PATH);
    if (!existsSync(historyPath)) return [];
    try {
      return JSON.parse(readFileSync(historyPath, 'utf-8')) as HistoryEntry[];
    } catch {
      return [];
    }
  }

  private loadState(): void {
    const statePath = join(this.cwd, STATE_PATH);
    if (!existsSync(statePath)) return;

    try {
      const raw = JSON.parse(readFileSync(statePath, 'utf-8'));
      this.examples = raw.examples ?? [];
      this.trainingJobs = raw.trainingJobs ?? [];
      this.deployedModels = raw.deployedModels ?? [];
      this.lastCollected = raw.lastCollected ?? 0;
    } catch {
      // Corrupted state — start fresh
    }
  }

  private persist(): void {
    const swarmDir = join(this.cwd, '.swarm');
    if (!existsSync(swarmDir)) mkdirSync(swarmDir, { recursive: true });

    const statePath = join(this.cwd, STATE_PATH);
    const state = {
      examples: this.examples,
      trainingJobs: this.trainingJobs,
      deployedModels: this.deployedModels,
      lastCollected: this.lastCollected,
    };
    writeFileSync(statePath, JSON.stringify(state, null, 2), 'utf-8');
  }
}
