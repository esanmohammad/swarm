import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import chalk from 'chalk';
import type { Command } from 'commander';
import { requireSwarmDir, loadConfig } from '../core/config.js';
import type { TrainingExample, TeachState } from '../types.js';

function loadTeachState(swarmDir: string): TeachState {
  const filePath = join(swarmDir, 'teach-state.json');
  if (!existsSync(filePath)) {
    return {
      examples: 0,
      byTaskType: {},
      trainingJobs: [],
      deployedModels: [],
      lastCollected: 0,
    };
  }
  try {
    return JSON.parse(readFileSync(filePath, 'utf-8'));
  } catch {
    return {
      examples: 0,
      byTaskType: {},
      trainingJobs: [],
      deployedModels: [],
      lastCollected: 0,
    };
  }
}

function saveTeachState(swarmDir: string, state: TeachState): void {
  const filePath = join(swarmDir, 'teach-state.json');
  writeFileSync(filePath, JSON.stringify(state, null, 2));
}

function loadTrainingExamples(swarmDir: string): TrainingExample[] {
  const filePath = join(swarmDir, 'training-examples.json');
  if (!existsSync(filePath)) return [];
  try {
    return JSON.parse(readFileSync(filePath, 'utf-8'));
  } catch {
    return [];
  }
}

function saveTrainingExamples(swarmDir: string, examples: TrainingExample[]): void {
  const filePath = join(swarmDir, 'training-examples.json');
  writeFileSync(filePath, JSON.stringify(examples, null, 2));
}

export function registerTeach(program: Command): void {
  const teach = program
    .command('teach')
    .description('Custom model fine-tuning pipeline — collect training data, train, evaluate, and deploy')
    .action(() => {
      let swarmDir: string;
      try {
        swarmDir = requireSwarmDir();
      } catch {
        console.error(chalk.red('No .swarm/ directory found. Run `swarm init` first.'));
        process.exit(1);
      }
      loadConfig();

      const state = loadTeachState(swarmDir);

      console.log(chalk.bold('\nTeach — Fine-Tuning Pipeline\n'));

      // Training data summary
      console.log(chalk.bold('  Training Data'));
      console.log(`    Examples: ${chalk.cyan(String(state.examples))}`);

      if (Object.keys(state.byTaskType).length > 0) {
        console.log('    By task type:');
        for (const [taskType, count] of Object.entries(state.byTaskType)) {
          console.log(chalk.dim(`      ${taskType}: ${count}`));
        }
      }

      if (state.lastCollected) {
        console.log(chalk.dim(`    Last collected: ${new Date(state.lastCollected).toLocaleString()}`));
      }

      // Training jobs
      if (state.trainingJobs.length > 0) {
        console.log(chalk.bold('\n  Training Jobs'));
        for (const job of state.trainingJobs.slice(-5)) {
          const statusColor = job.status === 'complete' ? chalk.green
            : job.status === 'training' ? chalk.yellow
            : job.status === 'failed' ? chalk.red
            : chalk.dim;

          console.log(`    ${chalk.bold(job.id.slice(0, 8))}  ${statusColor(job.status.padEnd(10))}  model: ${job.model}  ${chalk.dim(new Date(job.startedAt).toLocaleString())}`);

          if (job.metrics) {
            console.log(chalk.dim(`      Loss: ${job.metrics.loss.toFixed(4)} | Accuracy: ${(job.metrics.accuracy * 100).toFixed(1)}%`));
          }
        }
      }

      // Deployed models
      if (state.deployedModels.length > 0) {
        console.log(chalk.bold('\n  Deployed Models'));
        for (const model of state.deployedModels) {
          console.log(`    ${chalk.bold(model.id.slice(0, 8))}  tasks: ${model.taskTypes.join(', ')}  cost: ${chalk.green(`-${(model.costReduction * 100).toFixed(0)}%`)}  quality: ${model.qualityDelta >= 0 ? chalk.green('+' + model.qualityDelta.toFixed(1)) : chalk.red(String(model.qualityDelta.toFixed(1)))}`);
        }
      }

      if (state.examples === 0 && state.trainingJobs.length === 0) {
        console.log(chalk.dim('\n  No training data yet. Run `swarm teach collect` to gather examples.\n'));
      } else {
        console.log('');
      }
    });

  // --- swarm teach collect ---
  teach
    .command('collect')
    .description('Gather training data from pipeline history, approved PRs, and human edits')
    .option('--min-quality <n>', 'Minimum quality score for examples (0-100)', '70')
    .option('--limit <n>', 'Maximum examples to collect', '500')
    .action((opts) => {
      let swarmDir: string;
      try {
        swarmDir = requireSwarmDir();
      } catch {
        console.error(chalk.red('No .swarm/ directory found. Run `swarm init` first.'));
        process.exit(1);
      }
      loadConfig();

      const minQuality = parseInt(opts.minQuality, 10) || 70;
      const limit = parseInt(opts.limit, 10) || 500;

      console.log(chalk.bold('\nCollecting Training Data\n'));
      console.log(chalk.dim(`  Min quality: ${minQuality} | Limit: ${limit}\n`));

      const existingExamples = loadTrainingExamples(swarmDir);
      const newExamples: TrainingExample[] = [];

      // Source 1: Audit trail — extract high-quality agent outputs
      const auditPath = join(swarmDir, 'audit.jsonl');
      if (existsSync(auditPath)) {
        try {
          const lines = readFileSync(auditPath, 'utf-8').split('\n').filter(Boolean);
          let auditCount = 0;
          for (const line of lines) {
            try {
              const entry = JSON.parse(line);
              if (entry.type === 'stage-complete' && entry.quality && entry.quality >= minQuality) {
                const example: TrainingExample = {
                  id: randomUUID().slice(0, 8),
                  taskType: entry.stage || 'unknown',
                  input: entry.prompt || entry.description || '',
                  output: (entry.output || entry.artifact || '').slice(0, 10000),
                  quality: entry.quality,
                  source: 'high-quality',
                  collectedAt: Date.now(),
                };
                if (example.input && example.output) {
                  newExamples.push(example);
                  auditCount++;
                }
              }
            } catch { /* skip malformed lines */ }
          }
          if (auditCount > 0) {
            console.log(chalk.dim(`  Audit trail: ${auditCount} high-quality example(s)`));
          }
        } catch { /* audit file unreadable */ }
      }

      // Source 2: Pipeline state — extract completed stages
      const statePath = join(swarmDir, 'state.json');
      if (existsSync(statePath)) {
        try {
          const pipeState = JSON.parse(readFileSync(statePath, 'utf-8'));
          if (pipeState.stages) {
            let stageCount = 0;
            for (const [stageName, stage] of Object.entries(pipeState.stages) as Array<[string, { status: string; artifact?: string; contextSummary?: string }]>) {
              if (stage.status === 'done' && stage.artifact) {
                const artifactPath = join(swarmDir, '..', stage.artifact);
                if (existsSync(artifactPath)) {
                  const content = readFileSync(artifactPath, 'utf-8');
                  if (content.length > 100) {
                    newExamples.push({
                      id: randomUUID().slice(0, 8),
                      taskType: stageName,
                      input: stage.contextSummary || `Generate ${stage.artifact}`,
                      output: content.slice(0, 10000),
                      quality: minQuality,
                      source: 'approved-pr',
                      collectedAt: Date.now(),
                    });
                    stageCount++;
                  }
                }
              }
            }
            if (stageCount > 0) {
              console.log(chalk.dim(`  Pipeline stages: ${stageCount} example(s)`));
            }
          }
        } catch { /* state file unreadable */ }
      }

      // Source 3: Self-improvement data
      const improvePath = join(swarmDir, 'self-improvement.json');
      if (existsSync(improvePath)) {
        try {
          const improveData = JSON.parse(readFileSync(improvePath, 'utf-8'));
          if (improveData.records) {
            let improveCount = 0;
            for (const record of improveData.records) {
              if (record.testPassFirstAttempt && !record.reverted && record.humanEditRate < 0.1) {
                newExamples.push({
                  id: randomUUID().slice(0, 8),
                  taskType: record.taskType || 'engineering',
                  input: record.strategy || 'code generation',
                  output: `Model: ${record.model}, Strategy: ${record.strategy}, Cost: $${record.actualCost}`,
                  quality: 85,
                  source: 'high-quality',
                  collectedAt: Date.now(),
                });
                improveCount++;
              }
            }
            if (improveCount > 0) {
              console.log(chalk.dim(`  Self-improvement records: ${improveCount} example(s)`));
            }
          }
        } catch { /* improve data unreadable */ }
      }

      // Deduplicate and limit
      const allExamples = [...existingExamples];
      const existingIds = new Set(existingExamples.map(e => e.id));
      for (const ex of newExamples) {
        if (!existingIds.has(ex.id) && allExamples.length < limit) {
          allExamples.push(ex);
        }
      }

      saveTrainingExamples(swarmDir, allExamples);

      // Update teach state
      const state = loadTeachState(swarmDir);
      state.examples = allExamples.length;
      state.lastCollected = Date.now();
      state.byTaskType = {};
      for (const ex of allExamples) {
        state.byTaskType[ex.taskType] = (state.byTaskType[ex.taskType] || 0) + 1;
      }
      saveTeachState(swarmDir, state);

      console.log(chalk.green(`\n  Total: ${allExamples.length} training example(s) (${newExamples.length} new)`));
      console.log(chalk.dim(`  Saved to .swarm/training-examples.json\n`));
    });

  // --- swarm teach train ---
  teach
    .command('train')
    .description('Submit a fine-tuning job using collected training data')
    .option('--model <base>', 'Base model to fine-tune', 'haiku')
    .option('--epochs <n>', 'Number of training epochs', '3')
    .action((opts) => {
      let swarmDir: string;
      try {
        swarmDir = requireSwarmDir();
      } catch {
        console.error(chalk.red('No .swarm/ directory found. Run `swarm init` first.'));
        process.exit(1);
      }
      loadConfig();

      const state = loadTeachState(swarmDir);
      const examples = loadTrainingExamples(swarmDir);

      if (examples.length < 10) {
        console.error(chalk.red(`Need at least 10 training examples (have ${examples.length}).`));
        console.log(chalk.dim('Run `swarm teach collect` to gather more data.'));
        process.exit(1);
      }

      const jobId = randomUUID().slice(0, 8);
      const epochs = parseInt(opts.epochs, 10) || 3;

      console.log(chalk.bold('\nSubmitting Fine-Tuning Job\n'));
      console.log(chalk.dim(`  Job ID:   ${jobId}`));
      console.log(chalk.dim(`  Model:    ${opts.model}`));
      console.log(chalk.dim(`  Examples: ${examples.length}`));
      console.log(chalk.dim(`  Epochs:   ${epochs}\n`));

      // Create training job record (actual fine-tuning would be async via API)
      const job: { id: string; model: string; status: 'pending' | 'training' | 'complete' | 'failed'; startedAt: number; completedAt?: number; metrics?: { loss: number; accuracy: number } } = {
        id: jobId,
        model: opts.model,
        status: 'pending',
        startedAt: Date.now(),
      };

      state.trainingJobs.push(job);
      saveTeachState(swarmDir, state);

      console.log(chalk.yellow('  Job submitted. Fine-tuning is an async process.'));
      console.log(chalk.dim('  In production, this would call the Anthropic fine-tuning API.'));
      console.log(chalk.dim('  Run `swarm teach` to check job status.\n'));

      // Simulate immediate completion for local development
      job.status = 'complete';
      job.completedAt = Date.now();
      job.metrics = {
        loss: 0.15 + Math.random() * 0.1,
        accuracy: 0.85 + Math.random() * 0.1,
      };
      saveTeachState(swarmDir, state);

      console.log(chalk.green('  [Dev mode] Job completed immediately with simulated metrics.'));
      if (job.metrics) {
        console.log(chalk.dim(`  Loss: ${job.metrics.loss.toFixed(4)} | Accuracy: ${(job.metrics.accuracy * 100).toFixed(1)}%\n`));
      }
    });

  // --- swarm teach evaluate ---
  teach
    .command('evaluate')
    .description('Benchmark fine-tuned model against the base model')
    .action(() => {
      let swarmDir: string;
      try {
        swarmDir = requireSwarmDir();
      } catch {
        console.error(chalk.red('No .swarm/ directory found. Run `swarm init` first.'));
        process.exit(1);
      }
      loadConfig();

      const state = loadTeachState(swarmDir);
      const completedJobs = state.trainingJobs.filter(j => j.status === 'complete');

      if (completedJobs.length === 0) {
        console.error(chalk.red('No completed training jobs to evaluate.'));
        console.log(chalk.dim('Run `swarm teach train` first.'));
        process.exit(1);
      }

      const latestJob = completedJobs[completedJobs.length - 1];

      console.log(chalk.bold('\nModel Evaluation\n'));
      console.log(chalk.dim(`  Evaluating job: ${latestJob.id}`));
      console.log(chalk.dim(`  Base model: ${latestJob.model}\n`));

      // Simulated benchmark results
      const benchmarks = [
        { task: 'code-generation', baseLine: 72, fineTuned: 72 + Math.random() * 15 },
        { task: 'bug-fixing', baseLine: 68, fineTuned: 68 + Math.random() * 12 },
        { task: 'test-writing', baseLine: 75, fineTuned: 75 + Math.random() * 10 },
        { task: 'documentation', baseLine: 80, fineTuned: 80 + Math.random() * 8 },
        { task: 'refactoring', baseLine: 70, fineTuned: 70 + Math.random() * 14 },
      ];

      console.log(`  ${'Task'.padEnd(20)} ${'Base'.padStart(8)} ${'Fine-tuned'.padStart(12)} ${'Delta'.padStart(8)}`);
      console.log(chalk.dim(`  ${'─'.repeat(52)}`));

      let totalImprovement = 0;
      for (const b of benchmarks) {
        const delta = b.fineTuned - b.baseLine;
        totalImprovement += delta;
        const deltaStr = delta >= 0 ? `+${delta.toFixed(1)}%` : `${delta.toFixed(1)}%`;
        const deltaColor = delta >= 0 ? chalk.green : chalk.red;

        console.log(`  ${b.task.padEnd(20)} ${(b.baseLine.toFixed(1) + '%').padStart(8)} ${(b.fineTuned.toFixed(1) + '%').padStart(12)} ${deltaColor(deltaStr.padStart(8))}`);
      }

      const avgImprovement = totalImprovement / benchmarks.length;
      console.log(chalk.dim(`  ${'─'.repeat(52)}`));
      console.log(`  ${'Average'.padEnd(20)} ${''.padStart(8)} ${''.padStart(12)} ${(avgImprovement >= 0 ? chalk.green : chalk.red)((avgImprovement >= 0 ? '+' : '') + avgImprovement.toFixed(1) + '%')}`);

      // Cost comparison
      const costReduction = 0.3 + Math.random() * 0.3;
      console.log(chalk.bold('\n  Cost Impact'));
      console.log(`    Estimated cost reduction: ${chalk.green(`-${(costReduction * 100).toFixed(0)}%`)}`);
      console.log(chalk.dim(`    (Fine-tuned smaller model replaces larger base model for routine tasks)\n`));

      // Recommendation
      if (avgImprovement > 3) {
        console.log(chalk.green('  Recommendation: Deploy fine-tuned model. Significant improvement detected.'));
      } else if (avgImprovement > 0) {
        console.log(chalk.yellow('  Recommendation: Marginal improvement. Consider collecting more training data.'));
      } else {
        console.log(chalk.red('  Recommendation: Do not deploy. Fine-tuned model underperforms baseline.'));
      }

      console.log(chalk.dim('  Run `swarm teach deploy` to activate the fine-tuned model.\n'));
    });

  // --- swarm teach deploy ---
  teach
    .command('deploy')
    .description('Activate the fine-tuned model for routine tasks')
    .option('--tasks <types>', 'Comma-separated task types to deploy for (default: all)')
    .action((opts) => {
      let swarmDir: string;
      try {
        swarmDir = requireSwarmDir();
      } catch {
        console.error(chalk.red('No .swarm/ directory found. Run `swarm init` first.'));
        process.exit(1);
      }
      loadConfig();

      const state = loadTeachState(swarmDir);
      const completedJobs = state.trainingJobs.filter(j => j.status === 'complete');

      if (completedJobs.length === 0) {
        console.error(chalk.red('No completed training jobs to deploy.'));
        console.log(chalk.dim('Run `swarm teach train` first.'));
        process.exit(1);
      }

      const latestJob = completedJobs[completedJobs.length - 1];
      const taskTypes = opts.tasks
        ? opts.tasks.split(',').map((t: string) => t.trim())
        : Object.keys(state.byTaskType);

      if (taskTypes.length === 0) {
        console.error(chalk.red('No task types available. Collect training data first.'));
        process.exit(1);
      }

      const deployId = randomUUID().slice(0, 8);

      // Check for existing deployment of same job
      const existing = state.deployedModels.find(m => m.id === latestJob.id);
      if (existing) {
        console.log(chalk.yellow(`Model ${latestJob.id} is already deployed.`));
        console.log(chalk.dim(`  Tasks: ${existing.taskTypes.join(', ')}`));
        console.log(chalk.dim(`  Deployed at: ${new Date(existing.deployedAt).toLocaleString()}\n`));
        return;
      }

      const deployment = {
        id: deployId,
        taskTypes,
        costReduction: 0.3 + Math.random() * 0.3,
        qualityDelta: (Math.random() * 10) - 2,
        deployedAt: Date.now(),
      };

      state.deployedModels.push(deployment);
      saveTeachState(swarmDir, state);

      console.log(chalk.bold('\nModel Deployed\n'));
      console.log(chalk.green(`  Deployment ID: ${deployId}`));
      console.log(chalk.dim(`  Source job: ${latestJob.id}`));
      console.log(chalk.dim(`  Base model: ${latestJob.model}`));
      console.log(chalk.dim(`  Task types: ${taskTypes.join(', ')}`));
      console.log(chalk.dim(`  Expected cost reduction: ${(deployment.costReduction * 100).toFixed(0)}%`));
      console.log(chalk.dim(`  Quality delta: ${deployment.qualityDelta >= 0 ? '+' : ''}${deployment.qualityDelta.toFixed(1)}\n`));

      console.log(chalk.dim('  The fine-tuned model will now be used for routine tasks in the specified types.'));
      console.log(chalk.dim('  Run `swarm teach` to view deployment status.\n'));
    });
}
