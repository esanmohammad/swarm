import { Command } from 'commander';
import chalk from 'chalk';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { requireSwarmDir, loadConfig } from '../core/config.js';
import { StakeholderEngine } from '../core/stakeholder-engine.js';
import type { Audience, FeasibilityResult } from '../core/stakeholder-engine.js';
import type { ScopeOption, NegotiateState } from '../types.js';

function riskColor(risk: string): (text: string) => string {
  if (risk === 'low') return chalk.green;
  if (risk === 'medium') return chalk.yellow;
  return chalk.red;
}

function statusBadge(status: string): string {
  switch (status) {
    case 'accepted': return chalk.bgGreen.black(' ACCEPTED ');
    case 'rejected': return chalk.bgRed.white(' REJECTED ');
    case 'proposed': return chalk.bgYellow.black(' PROPOSED ');
    case 'analyzing': return chalk.bgBlue.white(' ANALYZING ');
    default: return status;
  }
}

function printFeasibility(result: FeasibilityResult): void {
  console.log();
  console.log(chalk.bold('Feasibility Analysis'));
  console.log(chalk.dim('─'.repeat(60)));
  console.log();

  // Request
  console.log(chalk.dim('Request: ') + result.request);
  if (result.deadline) {
    console.log(chalk.dim('Deadline: ') + result.deadline);
  }
  console.log(chalk.dim('Audience: ') + result.audience);
  console.log();

  // Feasibility
  const feasibleLabel = result.feasible
    ? chalk.green.bold('FEASIBLE')
    : chalk.red.bold('AT RISK');
  console.log(`  Feasibility:  ${feasibleLabel}`);
  console.log(`  Confidence:   ${chalk.white(result.confidence + '%')}`);
  if (result.velocityBaseline > 0) {
    console.log(`  Velocity:     ${chalk.white(result.velocityBaseline + ' runs/week')}`);
  }
  console.log();

  // Reasoning
  console.log(chalk.dim('  ' + result.reasoning));
  console.log();

  // Risks
  if (result.risks.length > 0) {
    console.log(chalk.red.bold('  Risks'));
    for (const risk of result.risks) {
      console.log(chalk.red(`    • ${risk}`));
    }
    console.log();
  }

  // Assumptions
  if (result.assumptions.length > 0) {
    console.log(chalk.dim.bold('  Assumptions'));
    for (const assumption of result.assumptions) {
      console.log(chalk.dim(`    • ${assumption}`));
    }
    console.log();
  }

  // Scope options
  console.log(chalk.bold('  Scope Options'));
  console.log(chalk.dim('  ' + '─'.repeat(56)));
  for (let i = 0; i < result.options.length; i++) {
    const opt = result.options[i]!;
    const rec = opt.recommended ? chalk.green(' ★ RECOMMENDED') : '';
    const rFn = riskColor(opt.risk);
    console.log();
    console.log(`  ${chalk.bold(`[${i + 1}]`)} ${chalk.bold.white(opt.name)}${rec}`);
    console.log(`      ${chalk.dim(opt.description)}`);
    console.log(`      Cost: ${chalk.white('$' + opt.cost.toFixed(2))}  Timeline: ${chalk.white(opt.timeline)}  Coverage: ${chalk.white(opt.coverage + '%')}  Risk: ${rFn(opt.risk)}`);
    if (opt.deferred.length > 0) {
      console.log(`      Deferred:`);
      for (const item of opt.deferred) {
        console.log(`        ${chalk.dim('•')} ${chalk.dim(item)}`);
      }
    }
  }
  console.log();
}

function printNegotiations(state: NegotiateState): void {
  if (state.negotiations.length === 0) {
    console.log(chalk.dim('No negotiations yet. Run: swarm negotiate "<request>"'));
    return;
  }

  console.log();
  console.log(chalk.bold('Recent Negotiations'));
  console.log(chalk.dim('─'.repeat(60)));
  console.log();

  const recent = state.negotiations.slice(-10);
  for (const neg of recent) {
    const date = new Date(neg.createdAt).toISOString().slice(0, 10);
    const badge = statusBadge(neg.status);
    const feasibleTag = neg.feasible ? chalk.green('feasible') : chalk.red('at risk');

    console.log(`  ${chalk.dim(date)}  ${badge}  ${feasibleTag}  ${chalk.dim(neg.audience)}`);
    console.log(`  ${chalk.white(neg.request.slice(0, 80))}${neg.request.length > 80 ? chalk.dim('...') : ''}`);

    if (neg.options.length > 0 && neg.selectedOption) {
      const selected = neg.options.find(o => o.name === neg.selectedOption);
      if (selected) {
        console.log(`  ${chalk.dim('Selected:')} ${chalk.cyan(selected.name)} — ${selected.timeline}, $${selected.cost.toFixed(2)}`);
      }
    }
    console.log();
  }
}

export function registerNegotiate(program: Command): void {
  const cmd = program
    .command('negotiate')
    .description('Stakeholder communication and scope negotiation');

  // Default: show recent negotiations
  cmd.action(() => {
    let swarmDir: string;
    try {
      swarmDir = requireSwarmDir();
    } catch {
      console.error(chalk.red('No .swarm/ directory found. Run `swarm init` first.'));
      process.exit(1);
    }

    const engine = new StakeholderEngine(swarmDir);
    const state = engine.getState();
    printNegotiations(state);
  });

  // swarm negotiate analyze "<request>" — feasibility analysis
  cmd
    .command('analyze')
    .description('Analyze feasibility of a request with scope options')
    .argument('<request>', 'Feature request or task description')
    .option('--deadline <date>', 'Target deadline (YYYY-MM-DD)')
    .option('--audience <audience>', 'Target audience: engineer, pm, executive, customer', 'engineer')
    .option('--json', 'Output as JSON')
    .action((request: string, opts) => {
      let swarmDir: string;
      try {
        swarmDir = requireSwarmDir();
      } catch {
        console.error(chalk.red('No .swarm/ directory found. Run `swarm init` first.'));
        process.exit(1);
      }

      const audience = opts.audience as Audience;
      const engine = new StakeholderEngine(swarmDir);
      const result = engine.analyzeFeasibility(request, opts.deadline, audience);

      if (opts.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }

      printFeasibility(result);
    });

  // swarm negotiate status — status report
  cmd
    .command('status')
    .description('Generate a status report for the specified audience')
    .option('--audience <audience>', 'Target audience: engineer, pm, executive, customer', 'pm')
    .option('--json', 'Output as JSON')
    .action((opts) => {
      let swarmDir: string;
      try {
        swarmDir = requireSwarmDir();
      } catch {
        console.error(chalk.red('No .swarm/ directory found. Run `swarm init` first.'));
        process.exit(1);
      }

      const audience = opts.audience as Audience;
      const engine = new StakeholderEngine(swarmDir);
      const report = engine.generateReport('weekly', audience);

      if (opts.json) {
        console.log(JSON.stringify(report, null, 2));
        return;
      }

      console.log();
      console.log(report.content);
      console.log();
    });

  // swarm negotiate report — auto-generate period report
  cmd
    .command('report')
    .description('Auto-generate a period report')
    .option('--period <period>', 'Report period: weekly, monthly', 'weekly')
    .option('--audience <audience>', 'Target audience: engineer, pm, executive, customer', 'pm')
    .option('--output <path>', 'Save report to file')
    .option('--json', 'Output as JSON')
    .action((opts) => {
      let swarmDir: string;
      try {
        swarmDir = requireSwarmDir();
      } catch {
        console.error(chalk.red('No .swarm/ directory found. Run `swarm init` first.'));
        process.exit(1);
      }

      const audience = opts.audience as Audience;
      const period = opts.period as 'weekly' | 'monthly';
      const engine = new StakeholderEngine(swarmDir);
      const report = engine.generateReport(period, audience);

      if (opts.json) {
        console.log(JSON.stringify(report, null, 2));
        return;
      }

      console.log();
      console.log(report.content);
      console.log();

      if (opts.output) {
        const outputPath = join(process.cwd(), opts.output);
        writeFileSync(outputPath, report.content, 'utf-8');
        console.log(chalk.dim(`Saved to ${outputPath}`));
      }
    });

  // swarm negotiate present "<topic>" — presentation-ready content
  cmd
    .command('present')
    .description('Generate presentation-ready content')
    .argument('<topic>', 'Presentation topic or title')
    .option('--output <path>', 'Save presentation to file')
    .action((topic: string, opts) => {
      let swarmDir: string;
      try {
        swarmDir = requireSwarmDir();
      } catch {
        console.error(chalk.red('No .swarm/ directory found. Run `swarm init` first.'));
        process.exit(1);
      }

      const engine = new StakeholderEngine(swarmDir);
      const content = engine.formatPresentation(topic);

      console.log();
      console.log(content);
      console.log();

      if (opts.output) {
        const outputPath = join(process.cwd(), opts.output);
        writeFileSync(outputPath, content, 'utf-8');
        console.log(chalk.dim(`Saved to ${outputPath}`));
      }
    });
}
