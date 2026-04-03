import chalk from 'chalk';
import type { Command } from 'commander';
import { requireSwarmDir, loadConfig } from '../core/config.js';
import { SpecializationEngine, BUILTIN_DOMAINS } from '../core/specialization.js';

function renderBar(score: number, width = 20): string {
  const filled = Math.round((score / 100) * width);
  const empty = width - filled;
  const colorFn = score >= 75 ? chalk.green : score >= 50 ? chalk.cyan : score >= 25 ? chalk.yellow : chalk.dim;
  return chalk.dim('[') + colorFn('\u2588'.repeat(filled)) + chalk.dim('\u2591'.repeat(empty)) + chalk.dim(']');
}

function domainColor(domain: string): string {
  const colors: Record<string, (s: string) => string> = {
    security: chalk.red,
    performance: chalk.yellow,
    database: chalk.blue,
    frontend: chalk.magenta,
    infrastructure: chalk.cyan,
    testing: chalk.green,
    custom: chalk.white,
  };
  const fn = colors[domain] ?? chalk.white;
  return fn(domain);
}

export function registerSpecialize(program: Command): void {
  const specialize = program
    .command('specialize')
    .description('Multi-agent specialization — manage specialist agents and route tasks')
    .action(() => {
      let swarmDir: string;
      try {
        swarmDir = requireSwarmDir();
      } catch {
        console.error(chalk.red('No .swarm/ directory found. Run `hivemind init` first.'));
        process.exit(1);
      }

      const engine = new SpecializationEngine(swarmDir);
      const specialists = engine.getSpecialists();

      if (specialists.length === 0) {
        console.log(chalk.bold('\nSpecialist Agents\n'));
        console.log(chalk.dim('  No specialists configured yet.'));
        console.log(chalk.dim('  Create one with: swarm specialize create <domain>\n'));
        console.log(chalk.dim('  Built-in domains: ') + BUILTIN_DOMAINS.map(d => domainColor(d)).join(chalk.dim(', ')));
        console.log(chalk.dim('  Or use any custom domain name.\n'));
        return;
      }

      // Overview
      console.log(chalk.bold('\nSpecialist Agents\n'));

      const stats = engine.getStats();
      console.log(`  ${chalk.dim('Specialists:')} ${chalk.bold(String(stats.totalSpecialists))}  ${chalk.dim('Tasks:')} ${chalk.bold(String(stats.totalTasks))}  ${chalk.dim('Success:')} ${chalk.bold(stats.overallSuccessRate + '%')}  ${chalk.dim('Avg Expertise:')} ${chalk.bold(String(stats.avgExpertise))}`);
      console.log('');

      for (const s of specialists) {
        const statusDot = s.status === 'active' ? chalk.green('\u25cf') : s.status === 'idle' ? chalk.dim('\u25cb') : chalk.red('\u25cf');
        const bar = renderBar(s.expertiseScore);
        console.log(`  ${statusDot} ${chalk.bold(s.name)} ${chalk.dim('(' + domainColor(s.domain) + chalk.dim(')'))} ${bar} ${s.expertiseScore}`);
        console.log(`    ${chalk.dim('Tasks:')} ${s.tasksCompleted}  ${chalk.dim('Success:')} ${s.successRate}%  ${chalk.dim('Memory:')} ${s.memoryItems} items`);
      }
      console.log('');
    });

  specialize
    .command('list')
    .description('Detailed specialist table')
    .option('--json', 'Output as JSON')
    .action((opts) => {
      let swarmDir: string;
      try {
        swarmDir = requireSwarmDir();
      } catch {
        console.error(chalk.red('No .swarm/ directory found. Run `hivemind init` first.'));
        process.exit(1);
      }

      const engine = new SpecializationEngine(swarmDir);
      const specialists = engine.getSpecialists();

      if (opts.json) {
        console.log(JSON.stringify(specialists, null, 2));
        return;
      }

      if (specialists.length === 0) {
        console.log(chalk.dim('\nNo specialists found. Create one with: swarm specialize create <domain>\n'));
        return;
      }

      console.log(chalk.bold('\nSpecialist Agents — Detailed View\n'));

      // Table header
      const nameW = 24;
      const domainW = 16;
      const expertW = 10;
      const tasksW = 8;
      const successW = 10;
      const memoryW = 8;

      console.log(
        '  ' +
        chalk.dim('Name'.padEnd(nameW)) +
        chalk.dim('Domain'.padEnd(domainW)) +
        chalk.dim('Expertise'.padEnd(expertW)) +
        chalk.dim('Tasks'.padEnd(tasksW)) +
        chalk.dim('Success'.padEnd(successW)) +
        chalk.dim('Memory'.padEnd(memoryW)) +
        chalk.dim('Last Used'),
      );
      console.log(chalk.dim('  ' + '\u2500'.repeat(nameW + domainW + expertW + tasksW + successW + memoryW + 20)));

      for (const s of specialists) {
        const successStr = s.tasksCompleted > 0 ? s.successRate + '%' : '-';
        const lastUsed = s.lastUsed ? timeSince(s.lastUsed) : 'never';
        const customTag = s.domain === 'custom' ? chalk.dim(' [custom]') : '';

        console.log(
          '  ' +
          chalk.bold(s.name.padEnd(nameW)) +
          (domainColor(s.domain) + customTag).padEnd(domainW + 10) + // extra pad for ANSI
          String(s.expertiseScore).padEnd(expertW) +
          String(s.tasksCompleted).padEnd(tasksW) +
          successStr.padEnd(successW) +
          String(s.memoryItems).padEnd(memoryW) +
          chalk.dim(lastUsed),
        );
      }
      console.log('');
    });

  specialize
    .command('create <domain>')
    .description('Create a new specialist agent')
    .option('-n, --name <name>', 'Custom name for the specialist')
    .action((domain: string, opts) => {
      let swarmDir: string;
      try {
        swarmDir = requireSwarmDir();
      } catch {
        console.error(chalk.red('No .swarm/ directory found. Run `hivemind init` first.'));
        process.exit(1);
      }

      const engine = new SpecializationEngine(swarmDir);

      // Check for duplicate domain (for built-in) or name (for custom)
      const normalizedDomain = domain.toLowerCase().trim();
      const isBuiltin = (BUILTIN_DOMAINS as readonly string[]).includes(normalizedDomain);
      const existing = engine.getSpecialists().find(s =>
        isBuiltin ? s.domain === normalizedDomain : s.name === (opts.name || `${normalizedDomain}-specialist`),
      );
      if (existing) {
        console.log(chalk.yellow(`\nA specialist for "${domain}" already exists: ${existing.name}`));
        console.log(chalk.dim('Each domain should have one specialist.\n'));
        return;
      }

      const specialist = engine.createSpecialist(domain, opts.name);

      console.log(chalk.bold('\nSpecialist Created\n'));
      console.log(`  ${chalk.bold('Name:')}    ${specialist.name}`);
      console.log(`  ${chalk.bold('Domain:')}  ${domainColor(specialist.domain)}${specialist.domain === 'custom' ? chalk.dim(' (custom)') : ''}`);
      console.log(`  ${chalk.bold('ID:')}      ${chalk.dim(specialist.id)}`);
      console.log('');
      console.log(chalk.dim(`  State saved to .swarm/specialists.json`));
      console.log(chalk.dim(`  Route tasks with: swarm specialize route "<task description>"`));
      console.log('');
    });

  specialize
    .command('route <task>')
    .description('Show routing decision for a task description')
    .option('--top <n>', 'Number of top matches to show', '3')
    .option('--json', 'Output as JSON')
    .action((task: string, opts) => {
      let swarmDir: string;
      try {
        swarmDir = requireSwarmDir();
      } catch {
        console.error(chalk.red('No .swarm/ directory found. Run `hivemind init` first.'));
        process.exit(1);
      }

      const engine = new SpecializationEngine(swarmDir);
      const specialists = engine.getSpecialists();

      if (specialists.length === 0) {
        console.log(chalk.yellow('\nNo specialists available. Create some first with: swarm specialize create <domain>\n'));
        return;
      }

      const results = engine.routeTask(task);
      const top = parseInt(opts.top, 10) || 3;
      const topResults = results.slice(0, top);

      if (opts.json) {
        console.log(JSON.stringify(topResults, null, 2));
        return;
      }

      console.log(chalk.bold('\nTask Routing Analysis\n'));
      console.log(`  ${chalk.dim('Task:')} ${task}`);
      console.log('');

      if (topResults.length === 0) {
        console.log(chalk.yellow('  No specialists matched this task.'));
        console.log(chalk.dim('  Consider creating a specialist for the relevant domain.\n'));
        return;
      }

      console.log(chalk.dim('  Rank  Specialist                Score  Keywords'));
      console.log(chalk.dim('  ' + '\u2500'.repeat(70)));

      for (let i = 0; i < topResults.length; i++) {
        const r = topResults[i];
        const rank = i === 0 ? chalk.green('\u2605 #1') : chalk.dim(`  #${i + 1}`);
        const bar = renderBar(r.score, 10);
        const keywords = r.matchedKeywords.slice(0, 4).join(', ');
        const more = r.matchedKeywords.length > 4 ? ` +${r.matchedKeywords.length - 4}` : '';

        console.log(
          `  ${rank}   ${chalk.bold(r.specialist.name.padEnd(22))} ${bar} ${String(r.score).padStart(3)}  ${chalk.dim(keywords + more)}`,
        );
      }

      if (topResults.length > 0) {
        console.log('');
        console.log(`  ${chalk.green('\u2192')} Recommended: ${chalk.bold(topResults[0].specialist.name)} ${chalk.dim('(score: ' + topResults[0].score + ')')}`);
      }
      console.log('');
    });

  specialize
    .command('stats')
    .description('Utilization and effectiveness statistics')
    .option('--json', 'Output as JSON')
    .action((opts) => {
      let swarmDir: string;
      try {
        swarmDir = requireSwarmDir();
      } catch {
        console.error(chalk.red('No .swarm/ directory found. Run `hivemind init` first.'));
        process.exit(1);
      }

      const engine = new SpecializationEngine(swarmDir);
      const stats = engine.getStats();
      const specialists = engine.getSpecialists();

      if (opts.json) {
        console.log(JSON.stringify({ stats, specialists }, null, 2));
        return;
      }

      console.log(chalk.bold('\nSpecialization Statistics\n'));

      // Overview
      console.log(chalk.bold('  Overview'));
      console.log(`    ${chalk.dim('Total Specialists:')}    ${stats.totalSpecialists}`);
      console.log(`    ${chalk.dim('Total Tasks:')}          ${stats.totalTasks}`);
      console.log(`    ${chalk.dim('Overall Success Rate:')} ${stats.overallSuccessRate}%`);
      console.log(`    ${chalk.dim('Average Expertise:')}    ${stats.avgExpertise}`);
      console.log(`    ${chalk.dim('Top Domain:')}           ${stats.topDomain ? domainColor(stats.topDomain) : chalk.dim('none')}`);
      console.log(`    ${chalk.dim('Collaborations:')}       ${stats.collaborationCount}`);
      console.log('');

      if (specialists.length === 0) {
        console.log(chalk.dim('  No specialists to report on.\n'));
        return;
      }

      // Per-specialist breakdown
      console.log(chalk.bold('  Per-Specialist Breakdown'));

      const sorted = [...specialists].sort((a, b) => b.expertiseScore - a.expertiseScore);
      for (const s of sorted) {
        const bar = renderBar(s.expertiseScore);

        console.log(`    ${chalk.bold(s.name)}`);
        console.log(`      Expertise: ${bar} ${s.expertiseScore}`);
        console.log(`      Tasks: ${s.tasksCompleted} completed (${s.successRate}% success)`);
        console.log(`      Knowledge: ${s.memoryItems} memory items`);
        console.log(`      Last used: ${s.lastUsed ? timeSince(s.lastUsed) : chalk.dim('never')}`);
        console.log('');
      }

      // Utilization summary
      const active = specialists.filter(s => s.status === 'active').length;
      const idle = specialists.filter(s => s.status === 'idle').length;
      const disabled = specialists.filter(s => s.status === 'disabled').length;
      console.log(chalk.bold('  Utilization'));
      console.log(`    ${chalk.green(String(active))} active  ${chalk.dim(String(idle))} idle  ${disabled > 0 ? chalk.red(String(disabled) + ' disabled') : ''}`);
      console.log('');
    });
}

function timeSince(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
