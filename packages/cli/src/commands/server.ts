import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createServer } from 'node:http';
import chalk from 'chalk';
import type { Command } from 'commander';
import type { TechStack } from '../types.js';
import { loadConfig, requireSwarmDir, autoDetectStack, autoInit } from '../core/config.js';
import { createContext } from './shared.js';

interface Job {
  id: string;
  prompt: string;
  priority: 'high' | 'normal' | 'low';
  status: 'queued' | 'running' | 'done' | 'error';
  submittedAt: number;
  startedAt?: number;
  finishedAt?: number;
  cost?: number;
  error?: string;
  submittedBy?: string;
}

export function registerServer(program: Command): void {
  const cmd = program
    .command('server')
    .description('Run Swarm as a shared HTTP server with job queue');

  cmd
    .command('start')
    .description('Start the Swarm server')
    .option('-p, --port <port>', 'HTTP port', '3850')
    .option('--max-concurrent <n>', 'Max concurrent pipelines', '2')
    .option('--budget <amount>', 'Team budget per day in USD', '50')
    .action(async (opts) => {
      let swarmDir: string;
      try {
        swarmDir = requireSwarmDir();
      } catch {
        const cwd = process.cwd();
        const stack = autoDetectStack(cwd);
        const projectName = cwd.split('/').pop() || 'my-project';
        console.log(chalk.yellow(`No .swarm/ found — auto-initializing (stack: ${stack})...`));
        swarmDir = autoInit(projectName, stack, cwd);
      }

      const config = loadConfig();
      const port = parseInt(opts.port) || 3850;
      const maxConcurrent = parseInt(opts.maxConcurrent) || 2;
      const dailyBudget = parseFloat(opts.budget) || 50;

      // Job queue state
      const jobs: Job[] = [];
      let running = 0;
      let dailySpend = 0;

      const jobsPath = join(swarmDir, 'server-jobs.json');
      const saveJobs = () => {
        try { writeFileSync(jobsPath, JSON.stringify(jobs.slice(-500), null, 2)); } catch {}
      };

      const processQueue = async () => {
        if (running >= maxConcurrent) return;
        if (dailySpend >= dailyBudget) {
          console.log(chalk.yellow(`[server] Daily budget ($${dailyBudget}) reached. Pausing queue.`));
          return;
        }

        const next = jobs.find(j => j.status === 'queued');
        if (!next) return;

        running++;
        next.status = 'running';
        next.startedAt = Date.now();
        saveJobs();

        console.log(chalk.cyan(`[server] Running job ${next.id}: ${next.prompt.slice(0, 60)}`));

        const { pipeline, cleanup } = createContext(swarmDir, config);
        try {
          await pipeline.runMayday(next.prompt, {
            stack: config.stack as TechStack,
            maxIterations: 5,
            parallel: 3,
            headless: true,
          });
          next.status = 'done';
          next.cost = 0; // Cost tracked via state
          dailySpend += next.cost;
          console.log(chalk.green(`[server] Job ${next.id} complete ($${next.cost.toFixed(2)})`));
        } catch (err) {
          next.status = 'error';
          next.error = err instanceof Error ? err.message : String(err);
          console.error(chalk.red(`[server] Job ${next.id} failed: ${next.error}`));
        } finally {
          next.finishedAt = Date.now();
          running--;
          saveJobs();
          cleanup();
          // Process next in queue
          processQueue();
        }
      };

      // HTTP API
      const server = createServer((req, res) => {
        const url = new URL(req.url || '/', `http://localhost:${port}`);
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

        if (req.method === 'OPTIONS') {
          res.writeHead(200);
          res.end();
          return;
        }

        if (req.method === 'POST' && url.pathname === '/api/jobs') {
          let body = '';
          req.on('data', chunk => body += chunk);
          req.on('end', () => {
            try {
              const data = JSON.parse(body);
              if (!data.prompt) {
                res.writeHead(400);
                res.end(JSON.stringify({ error: 'prompt is required' }));
                return;
              }
              const job: Job = {
                id: `job-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                prompt: data.prompt,
                priority: data.priority || 'normal',
                status: 'queued',
                submittedAt: Date.now(),
                submittedBy: data.submittedBy || 'anonymous',
              };
              // Insert by priority
              if (job.priority === 'high') {
                const idx = jobs.findIndex(j => j.status === 'queued' && j.priority !== 'high');
                if (idx >= 0) jobs.splice(idx, 0, job);
                else jobs.push(job);
              } else {
                jobs.push(job);
              }
              saveJobs();
              console.log(chalk.cyan(`[server] Job submitted: ${job.id} (${job.priority})`));
              res.writeHead(201);
              res.end(JSON.stringify(job));
              processQueue();
            } catch {
              res.writeHead(400);
              res.end(JSON.stringify({ error: 'Invalid JSON' }));
            }
          });
          return;
        }

        if (req.method === 'GET' && url.pathname === '/api/jobs') {
          res.writeHead(200);
          res.end(JSON.stringify({ jobs, running, dailySpend, dailyBudget }));
          return;
        }

        if (req.method === 'GET' && url.pathname === '/api/health') {
          res.writeHead(200);
          res.end(JSON.stringify({ status: 'ok', running, queued: jobs.filter(j => j.status === 'queued').length }));
          return;
        }

        res.writeHead(404);
        res.end(JSON.stringify({ error: 'Not found' }));
      });

      server.listen(port, () => {
        console.log(chalk.bold(`\nSwarm Server`));
        console.log(chalk.dim(`Port: ${port} | Max concurrent: ${maxConcurrent} | Daily budget: $${dailyBudget}`));
        console.log(chalk.dim(`\nAPI:`));
        console.log(chalk.dim(`  POST /api/jobs   — Submit a pipeline job`));
        console.log(chalk.dim(`  GET  /api/jobs   — List all jobs`));
        console.log(chalk.dim(`  GET  /api/health — Server health`));
        console.log(chalk.dim(`\nReady. Ctrl+C to stop.\n`));
      });

      // Reset daily spend at midnight
      const resetDaily = () => {
        const now = new Date();
        const msToMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime() - now.getTime();
        setTimeout(() => {
          dailySpend = 0;
          console.log(chalk.dim('[server] Daily budget reset.'));
          processQueue();
          resetDaily();
        }, msToMidnight);
      };
      resetDaily();

      process.on('SIGINT', () => {
        console.log(chalk.yellow('\nServer stopping...'));
        server.close();
        process.exit(0);
      });
    });

  cmd
    .command('submit')
    .description('Submit a job to a running Swarm server')
    .argument('<prompt>', 'Feature request')
    .option('-p, --port <port>', 'Server port', '3850')
    .option('--priority <level>', 'Priority: high, normal, low', 'normal')
    .action(async (prompt: string, opts) => {
      const port = opts.port || 3850;
      try {
        const resp = await fetch(`http://localhost:${port}/api/jobs`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt, priority: opts.priority }),
        });
        const data = await resp.json();
        if (resp.ok) {
          console.log(chalk.green(`Job submitted: ${data.id}`));
        } else {
          console.error(chalk.red(`Error: ${data.error}`));
        }
      } catch {
        console.error(chalk.red(`Could not connect to server on port ${port}`));
      }
    });

  cmd
    .command('jobs')
    .description('List jobs on a running Swarm server')
    .option('-p, --port <port>', 'Server port', '3850')
    .action(async (opts) => {
      const port = opts.port || 3850;
      try {
        const resp = await fetch(`http://localhost:${port}/api/jobs`);
        const data = await resp.json();
        console.log(chalk.bold(`\nSwarm Server — ${data.jobs.length} jobs\n`));
        console.log(chalk.dim(`Running: ${data.running} | Daily spend: $${data.dailySpend.toFixed(2)}/$${data.dailyBudget}\n`));
        for (const job of data.jobs.slice(-20)) {
          const color = job.status === 'done' ? chalk.green : job.status === 'error' ? chalk.red : job.status === 'running' ? chalk.cyan : chalk.dim;
          console.log(`  ${color(job.status.padEnd(8))} ${job.id} — ${job.prompt.slice(0, 60)} ${job.cost ? `($${job.cost.toFixed(2)})` : ''}`);
        }
      } catch {
        console.error(chalk.red(`Could not connect to server on port ${port}`));
      }
    });
}
