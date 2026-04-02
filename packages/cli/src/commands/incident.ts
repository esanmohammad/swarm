import { execSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import chalk from 'chalk';
import ora from 'ora';
import type { Command } from 'commander';
import type { TechStack } from '../types.js';
import { loadConfig, requireSwarmDir, autoDetectStack, autoInit } from '../core/config.js';
import { createContext } from './shared.js';

export interface IncidentRecord {
  id: string;
  description: string;
  severity: string;
  status: 'investigating' | 'identified' | 'fixed' | 'resolved';
  startedAt: number;
  resolvedAt?: number;
  rootCause?: string;
  fix?: string;
  cost: number;
  agentIds: string[];
}

function loadIncidents(swarmDir: string): IncidentRecord[] {
  const filePath = join(swarmDir, 'incidents.json');
  if (!existsSync(filePath)) return [];
  try {
    return JSON.parse(readFileSync(filePath, 'utf-8'));
  } catch {
    return [];
  }
}

function saveIncidents(swarmDir: string, incidents: IncidentRecord[]): void {
  const filePath = join(swarmDir, 'incidents.json');
  writeFileSync(filePath, JSON.stringify(incidents, null, 2));
}

export function registerIncident(program: Command): void {
  const incident = program
    .command('incident')
    .description('Production incident response — diagnose, analyze root cause, and optionally fix');

  // --- swarm incident respond <description> ---
  incident
    .command('respond')
    .description('Trigger incident response: diagnose root cause and recommend a fix')
    .argument('<description>', 'Description of the incident')
    .option('--severity <level>', 'Severity level (P1, P2, P3, P4)', 'P3')
    .option('--logs <path>', 'Path to log file or URL')
    .option('-m, --model <model>', 'Model override', 'sonnet')
    .option('-b, --budget <amount>', 'Max budget in USD', '10')
    .option('--fix', 'Attempt to generate a fix (not just diagnose)')
    .action(async (description: string, opts) => {
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
      config.model = opts.model || 'sonnet';
      if (opts.budget) {
        config.maxBudgetUsd = opts.budget === 'none' ? null : (parseFloat(opts.budget) || null);
      }

      const stack = config.stack;
      const { agentManager, cleanup } = createContext(swarmDir, config);

      try {
        const incidentId = randomUUID().slice(0, 8);
        const severity = opts.severity || 'P3';

        console.log(chalk.bold.red(`\nIncident Response — ${severity}`));
        console.log(chalk.dim(`ID: ${incidentId}`));
        console.log(chalk.dim(`Description: ${description.slice(0, 120)}${description.length > 120 ? '...' : ''}`));
        console.log(chalk.dim(`Model: ${config.model} | Budget: ${config.maxBudgetUsd ? '$' + config.maxBudgetUsd : 'unlimited'}\n`));

        // 1. Gather context
        const contextParts: string[] = [];

        // Recent git log
        try {
          const gitLog = execSync('git log --oneline -20', {
            encoding: 'utf-8',
            cwd: process.cwd(),
          }).trim();
          if (gitLog) {
            contextParts.push(`## Recent Git History (last 20 commits)\n\`\`\`\n${gitLog}\n\`\`\``);
          }
        } catch { /* not a git repo */ }

        // Recent deploys — check for deploy tags or recent merges to main
        try {
          const deployTags = execSync('git tag -l "deploy-*" --sort=-creatordate | head -5', {
            encoding: 'utf-8',
            cwd: process.cwd(),
          }).trim();
          if (deployTags) {
            contextParts.push(`## Recent Deploy Tags\n\`\`\`\n${deployTags}\n\`\`\``);
          }
        } catch { /* no tags */ }

        try {
          const recentMerges = execSync('git log --merges --oneline -5 main 2>/dev/null || git log --merges --oneline -5 master 2>/dev/null', {
            encoding: 'utf-8',
            cwd: process.cwd(),
          }).trim();
          if (recentMerges) {
            contextParts.push(`## Recent Merges to Main\n\`\`\`\n${recentMerges}\n\`\`\``);
          }
        } catch { /* no merges or no main branch */ }

        // Read log file if provided
        if (opts.logs) {
          try {
            let logContent = '';
            if (existsSync(opts.logs)) {
              logContent = readFileSync(opts.logs, 'utf-8');
            } else {
              console.log(chalk.dim(`Log path "${opts.logs}" not found as local file, including as reference.`));
              logContent = `[Log reference: ${opts.logs}]`;
            }
            // Truncate to 20KB
            if (logContent.length > 20_000) {
              logContent = logContent.slice(-20_000);
              logContent = '[...truncated to last 20KB...]\n' + logContent;
            }
            contextParts.push(`## Application Logs\n\`\`\`\n${logContent}\n\`\`\``);
          } catch (err) {
            console.log(chalk.yellow(`Warning: Could not read logs from ${opts.logs}`));
          }
        }

        const contextBlock = contextParts.length > 0
          ? '\n\n--- GATHERED CONTEXT ---\n' + contextParts.join('\n\n')
          : '';

        // 2. Spawn diagnostic agent
        const diagnosticPrompt = [
          `You are responding to a production incident. Severity: ${severity}.`,
          '',
          `## Incident Description`,
          description,
          contextBlock,
          '',
          '## Your Task',
          'Perform a thorough root cause analysis. Produce a structured report with:',
          '',
          '1. **Timeline of Events** — reconstruct what likely happened based on git history, logs, and code changes',
          '2. **Suspected Culprit** — identify the specific commit, file, or change most likely responsible',
          '3. **Root Cause Analysis** — explain WHY the issue occurred (not just what happened)',
          '4. **Recommended Fix or Rollback** — provide a concrete recommendation:',
          '   - If a rollback is safer, specify the exact commit to revert to',
          '   - If a forward fix is better, describe the minimal change needed',
          '5. **Severity Assessment** — confirm or adjust the severity based on your analysis',
          '6. **Prevention** — what guard (test, lint rule, CI check) would prevent this class of issue',
          '',
          'Read the codebase to understand the relevant code. Focus on recent changes that could have caused the incident.',
          'Be precise and actionable — this is a production incident.',
        ].join('\n');

        const spinner = ora('Investigating incident...').start();

        const diagnosticAgent = await agentManager.spawn({
          name: `incident-diagnostic-${incidentId}`,
          persona: 'engineer',
          stack,
          prompt: diagnosticPrompt,
          model: config.model,
          cwd: process.cwd(),
          interactive: false,
          permissionMode: 'plan', // read-only investigation
        });

        const agentIds: string[] = [diagnosticAgent.id];
        await agentManager.waitForAgent(diagnosticAgent.id);
        let totalCost = diagnosticAgent.cost.totalUsd;

        // Create initial incident record
        const record: IncidentRecord = {
          id: incidentId,
          description,
          severity,
          status: 'investigating',
          startedAt: Date.now(),
          cost: totalCost,
          agentIds,
        };

        if (diagnosticAgent.status === 'done') {
          spinner.succeed('Root cause analysis complete.');
          record.status = 'identified';
          record.rootCause = diagnosticAgent.output.slice(0, 5000);

          console.log(chalk.bold('\n--- Root Cause Analysis ---'));
          console.log(diagnosticAgent.output);
        } else {
          spinner.fail(`Investigation failed: ${diagnosticAgent.error || 'Unknown error'}`);
          record.status = 'investigating';
        }

        // 4. If --fix: spawn a second agent to implement the fix
        if (opts.fix && record.status === 'identified') {
          const fixSpinner = ora('Implementing fix...').start();

          const fixPrompt = [
            `You are implementing a fix for a production incident (${severity}).`,
            '',
            '## Incident Description',
            description,
            '',
            '## Root Cause Analysis',
            diagnosticAgent.output.slice(0, 10_000),
            '',
            '## Your Task',
            '1. Implement the minimal fix to resolve this incident.',
            '2. Do NOT refactor unrelated code — this is an emergency fix.',
            '3. Run existing tests to verify the fix does not break anything.',
            '4. If appropriate, add a test that would catch this regression.',
            '5. Summarize what you changed and why.',
          ].join('\n');

          const fixAgent = await agentManager.spawn({
            name: `incident-fix-${incidentId}`,
            persona: 'engineer',
            stack,
            prompt: fixPrompt,
            model: config.model,
            cwd: process.cwd(),
            interactive: false,
            permissionMode: 'auto',
          });

          agentIds.push(fixAgent.id);
          await agentManager.waitForAgent(fixAgent.id);
          totalCost += fixAgent.cost.totalUsd;

          if (fixAgent.status === 'done') {
            fixSpinner.succeed('Fix implemented.');
            record.status = 'fixed';
            record.fix = fixAgent.output.slice(0, 5000);
            record.resolvedAt = Date.now();

            console.log(chalk.bold('\n--- Fix Summary ---'));
            console.log(fixAgent.output);
          } else {
            fixSpinner.fail(`Fix attempt failed: ${fixAgent.error || 'Unknown error'}`);
          }
        }

        // 5. Save incident record
        record.cost = totalCost;
        record.agentIds = agentIds;
        const incidents = loadIncidents(swarmDir);
        incidents.push(record);
        saveIncidents(swarmDir, incidents);

        console.log(chalk.dim(`\nIncident ${incidentId} saved. Total cost: $${totalCost.toFixed(2)}`));
        console.log(chalk.dim(`Status: ${record.status}`));
      } catch (err) {
        console.error(chalk.red(err instanceof Error ? err.message : String(err)));
        process.exit(1);
      } finally {
        cleanup();
      }
    });

  // --- swarm incident history ---
  incident
    .command('history')
    .description('Show past incident responses')
    .action(async () => {
      let swarmDir: string;
      try {
        swarmDir = requireSwarmDir();
      } catch {
        console.error(chalk.red('No .swarm/ directory found. Run swarm init first.'));
        process.exit(1);
      }

      const incidents = loadIncidents(swarmDir);
      if (incidents.length === 0) {
        console.log(chalk.dim('No incidents recorded yet.'));
        return;
      }

      console.log(chalk.bold(`\nIncident History (${incidents.length} total)\n`));

      for (const inc of incidents.reverse()) {
        const date = new Date(inc.startedAt).toLocaleString();
        const statusColor = inc.status === 'fixed' || inc.status === 'resolved'
          ? chalk.green
          : inc.status === 'identified'
          ? chalk.yellow
          : chalk.red;

        console.log(`  ${chalk.bold(inc.id)}  ${statusColor(inc.status.toUpperCase().padEnd(14))}  ${chalk.dim(inc.severity)}  $${inc.cost.toFixed(2)}  ${chalk.dim(date)}`);
        console.log(`    ${inc.description.slice(0, 100)}${inc.description.length > 100 ? '...' : ''}`);
        if (inc.rootCause) {
          const firstLine = inc.rootCause.split('\n').find(l => l.trim()) || '';
          console.log(chalk.dim(`    Root cause: ${firstLine.slice(0, 100)}`));
        }
        console.log('');
      }
    });

  // --- swarm incident status ---
  incident
    .command('status')
    .description('Show current incident state')
    .action(async () => {
      let swarmDir: string;
      try {
        swarmDir = requireSwarmDir();
      } catch {
        console.error(chalk.red('No .swarm/ directory found. Run swarm init first.'));
        process.exit(1);
      }

      const incidents = loadIncidents(swarmDir);
      const active = incidents.filter(i => i.status === 'investigating' || i.status === 'identified');

      if (active.length === 0) {
        console.log(chalk.green('No active incidents.'));
        const recent = incidents.filter(i => i.status === 'fixed' || i.status === 'resolved').slice(-3);
        if (recent.length > 0) {
          console.log(chalk.dim(`\nLast ${recent.length} resolved incident(s):`));
          for (const inc of recent) {
            const date = new Date(inc.resolvedAt || inc.startedAt).toLocaleString();
            console.log(chalk.dim(`  ${inc.id}  ${inc.severity}  ${inc.description.slice(0, 80)}  (${date})`));
          }
        }
        return;
      }

      console.log(chalk.bold.red(`\nActive Incidents: ${active.length}\n`));

      for (const inc of active) {
        const elapsed = Math.round((Date.now() - inc.startedAt) / 1000 / 60);
        const statusColor = inc.status === 'identified' ? chalk.yellow : chalk.red;

        console.log(`  ${chalk.bold(inc.id)}  ${statusColor(inc.status.toUpperCase())}  ${chalk.dim(inc.severity)}  ${elapsed}min elapsed  $${inc.cost.toFixed(2)}`);
        console.log(`    ${inc.description.slice(0, 120)}`);
        if (inc.rootCause) {
          const firstLine = inc.rootCause.split('\n').find(l => l.trim()) || '';
          console.log(chalk.dim(`    Root cause: ${firstLine.slice(0, 100)}`));
        }
        console.log('');
      }
    });
}
