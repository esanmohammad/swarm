import { Command } from 'commander';
import chalk from 'chalk';
import { requireSwarmDir, loadConfig } from '../core/config.js';
import { CompetitiveIntel } from '../core/competitive-intel.js';

function getIntel(): CompetitiveIntel {
  const swarmDir = requireSwarmDir();
  return new CompetitiveIntel(swarmDir);
}

function trendColor(trend: string): string {
  switch (trend) {
    case 'growing': return chalk.green(trend);
    case 'stable': return chalk.blue(trend);
    case 'declining': return chalk.red(trend);
    default: return trend;
  }
}

function ringColor(ring: string): string {
  switch (ring) {
    case 'adopt': return chalk.green(ring);
    case 'trial': return chalk.cyan(ring);
    case 'assess': return chalk.yellow(ring);
    case 'hold': return chalk.red(ring);
    default: return ring;
  }
}

function priorityColor(priority: string): string {
  switch (priority) {
    case 'high': return chalk.red(priority);
    case 'medium': return chalk.yellow(priority);
    case 'low': return chalk.dim(priority);
    default: return priority;
  }
}

export function registerCompete(program: Command): void {
  const cmd = program
    .command('compete')
    .description('Competitive intelligence — track competitors, identify gaps, technology radar')
    .action(() => {
      const intel = getIntel();
      const state = intel.getState();

      if (state.competitors.length === 0 && state.radar.length === 0) {
        console.log(chalk.dim('No competitive data yet. Add a competitor with: swarm compete scan --add <repo>'));
        return;
      }

      console.log(chalk.bold('\nCompetitive Landscape\n'));

      if (state.competitors.length > 0) {
        console.log(chalk.bold('  Competitors:'));
        for (const c of state.competitors) {
          const stars = c.stars ? chalk.dim(` (${c.stars} stars)`) : '';
          console.log(`    ${chalk.cyan(c.name)}${stars} — ${trendColor(c.trend)}`);
          if (c.repo) console.log(chalk.dim(`      ${c.repo}`));
        }
        console.log();
      }

      if (state.featureGaps.length > 0) {
        console.log(chalk.bold(`  Feature Gaps: ${chalk.yellow(String(state.featureGaps.length))}`));
        const highPriority = state.featureGaps.filter(g => g.priority === 'high');
        if (highPriority.length > 0) {
          console.log(chalk.dim(`    High priority: ${highPriority.length}`));
        }
        console.log();
      }

      if (state.radar.length > 0) {
        console.log(chalk.bold(`  Radar Entries: ${chalk.cyan(String(state.radar.length))}`));
        const byRing = { adopt: 0, trial: 0, assess: 0, hold: 0 };
        for (const entry of state.radar) {
          byRing[entry.ring]++;
        }
        console.log(
          chalk.dim('    ') +
          chalk.green(`Adopt: ${byRing.adopt}`) + '  ' +
          chalk.cyan(`Trial: ${byRing.trial}`) + '  ' +
          chalk.yellow(`Assess: ${byRing.assess}`) + '  ' +
          chalk.red(`Hold: ${byRing.hold}`),
        );
        console.log();
      }

      if (state.lastScanned > 0) {
        console.log(chalk.dim(`  Last scanned: ${new Date(state.lastScanned).toLocaleString()}`));
      }
    });

  // ─── scan ──────────────────────────────────────────────────

  cmd
    .command('scan')
    .description('Scan competitive landscape and refresh data')
    .option('--add <repo>', 'Add a competitor by GitHub repo URL or name')
    .action((opts) => {
      const intel = getIntel();

      if (opts.add) {
        const name = opts.add.includes('/') ? opts.add.split('/').pop()! : opts.add;
        const repo = opts.add.includes('/') ? opts.add : undefined;
        const competitor = intel.addCompetitor(name, repo);
        console.log(chalk.green(`\nAdded competitor: ${competitor.name}`));
        if (competitor.repo) {
          console.log(chalk.dim(`  Repo: ${competitor.repo}`));
        }
      }

      console.log(chalk.dim('\nScanning competitive landscape...'));
      const state = intel.scan();

      console.log(chalk.green(`\nScan complete`));
      console.log(chalk.dim(`  Competitors tracked: ${state.competitors.length}`));
      console.log(chalk.dim(`  Radar entries: ${state.radar.length}`));
      console.log(chalk.dim(`  Last scanned: ${new Date(state.lastScanned).toLocaleString()}`));

      if (state.competitors.length > 0) {
        console.log(chalk.bold('\n  Competitors:\n'));
        for (const c of state.competitors) {
          const stars = c.stars ? chalk.dim(` (${c.stars} stars)`) : '';
          console.log(`    ${chalk.cyan(c.name)}${stars} — ${trendColor(c.trend)}`);
        }
      }
    });

  // ─── gaps ──────────────────────────────────────────────────

  cmd
    .command('gaps')
    .description('Identify feature gaps vs competitors')
    .action(() => {
      const intel = getIntel();
      const gaps = intel.getGaps();

      if (gaps.length === 0) {
        console.log(chalk.dim('No feature gaps identified. Add competitors first: swarm compete scan --add <repo>'));
        return;
      }

      console.log(chalk.bold('\nFeature Gaps\n'));
      console.log(
        chalk.dim('Feature'.padEnd(35)) +
        chalk.dim('Competitor'.padEnd(20)) +
        chalk.dim('Priority'.padEnd(12)) +
        chalk.dim('Effort'),
      );
      console.log(chalk.dim('─'.repeat(80)));

      for (const gap of gaps) {
        console.log(
          gap.feature.padEnd(35) +
          chalk.cyan(gap.competitor).padEnd(20 + 10) +
          priorityColor(gap.priority).padEnd(12 + 10) +
          chalk.dim(gap.effort),
        );
      }

      const highCount = gaps.filter(g => g.priority === 'high').length;
      const mediumCount = gaps.filter(g => g.priority === 'medium').length;
      console.log(chalk.dim(`\nTotal: ${gaps.length} gaps | High: ${highCount} | Medium: ${mediumCount}`));
    });

  // ─── radar ─────────────────────────────────────────────────

  cmd
    .command('radar')
    .description('Technology radar — trends relevant to the stack')
    .action(() => {
      const intel = getIntel();
      const radar = intel.getRadar();

      if (radar.length === 0) {
        console.log(chalk.dim('No radar entries. Run a scan first: swarm compete scan'));
        return;
      }

      console.log(chalk.bold('\nTechnology Radar\n'));

      const rings = ['adopt', 'trial', 'assess', 'hold'] as const;
      for (const ring of rings) {
        const entries = radar.filter(e => e.ring === ring);
        if (entries.length === 0) continue;

        console.log(chalk.bold(`  ${ringColor(ring.toUpperCase())}\n`));
        for (const entry of entries) {
          console.log(`    ${chalk.cyan(entry.name)} ${chalk.dim(`(${entry.category})`)}`);
          console.log(chalk.dim(`      ${entry.relevance}`));
        }
        console.log();
      }

      console.log(chalk.dim(`Total: ${radar.length} technologies tracked`));
    });
}
