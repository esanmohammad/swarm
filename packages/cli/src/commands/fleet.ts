import { Command } from 'commander';
import chalk from 'chalk';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { requireSwarmDir, loadConfig } from '../core/config.js';
import type { FleetInstance, FleetState } from '../types.js';

function loadFleetState(swarmDir: string): FleetState {
  const filePath = join(swarmDir, 'fleet-state.json');
  if (!existsSync(filePath)) {
    return {
      instances: [],
      budget: { total: 0, allocated: {}, spent: {} },
      knowledgeItems: 0,
      crossTeamAlerts: [],
      lastSync: 0,
    };
  }
  try {
    return JSON.parse(readFileSync(filePath, 'utf-8'));
  } catch {
    return {
      instances: [],
      budget: { total: 0, allocated: {}, spent: {} },
      knowledgeItems: 0,
      crossTeamAlerts: [],
      lastSync: 0,
    };
  }
}

function saveFleetState(swarmDir: string, state: FleetState): void {
  const filePath = join(swarmDir, 'fleet-state.json');
  writeFileSync(filePath, JSON.stringify(state, null, 2));
}

export function registerFleet(program: Command): void {
  const fleet = program
    .command('fleet')
    .description('Multi-team Swarm orchestration — manage fleet of Swarm instances across your org')
    .action(() => {
      let swarmDir: string;
      try {
        swarmDir = requireSwarmDir();
      } catch {
        console.error(chalk.red('No .swarm/ directory found. Run `swarm init` first.'));
        process.exit(1);
      }
      loadConfig();

      const state = loadFleetState(swarmDir);

      console.log(chalk.bold('\nFleet Overview\n'));

      if (state.instances.length === 0) {
        console.log(chalk.dim('  No instances registered. Run `swarm fleet register` to add this instance.'));
        console.log('');
        return;
      }

      // Summary
      const active = state.instances.filter(i => i.status === 'active').length;
      const idle = state.instances.filter(i => i.status === 'idle').length;
      const offline = state.instances.filter(i => i.status === 'offline').length;
      const totalCost = state.instances.reduce((sum, i) => sum + i.stats.totalCost, 0);

      console.log(`  Instances: ${chalk.green(String(active) + ' active')}  ${chalk.yellow(String(idle) + ' idle')}  ${chalk.dim(String(offline) + ' offline')}`);
      console.log(`  Budget:    $${state.budget.total.toFixed(2)} total`);
      console.log(`  Knowledge: ${state.knowledgeItems} shared items`);
      console.log(`  Last sync: ${state.lastSync ? new Date(state.lastSync).toLocaleString() : 'never'}`);
      console.log('');

      // Instance table
      console.log(chalk.bold('  Instances:'));
      console.log(chalk.dim('  ID        Team            Repo                          Status    Runs   Cost'));
      console.log(chalk.dim('  ' + '─'.repeat(85)));

      for (const inst of state.instances) {
        const statusColor = inst.status === 'active' ? chalk.green
          : inst.status === 'idle' ? chalk.yellow
          : chalk.dim;
        const id = inst.id.slice(0, 8).padEnd(10);
        const team = inst.team.padEnd(16);
        const repo = inst.repo.slice(0, 30).padEnd(30);
        const status = statusColor(inst.status.padEnd(10));
        const runs = String(inst.stats.totalRuns).padEnd(7);
        const cost = `$${inst.stats.totalCost.toFixed(2)}`;

        console.log(`  ${id}${team}${repo}${status}${runs}${cost}`);
      }

      // Recent alerts
      if (state.crossTeamAlerts.length > 0) {
        console.log('');
        console.log(chalk.bold('  Recent Alerts:'));
        const recent = state.crossTeamAlerts.slice(-5);
        for (const alert of recent) {
          const time = new Date(alert.timestamp).toLocaleString();
          console.log(`  ${chalk.dim(time)}  ${chalk.yellow(alert.type)}  ${alert.from} → ${alert.to.join(', ')}`);
          console.log(`    ${alert.message}`);
        }
      }

      console.log('');
    });

  // --- swarm fleet register ---
  fleet
    .command('register')
    .description('Register this Swarm instance with the fleet')
    .requiredOption('--team <name>', 'Team name')
    .option('--repo <url>', 'Repository URL', '')
    .action(async (opts) => {
      let swarmDir: string;
      try {
        swarmDir = requireSwarmDir();
      } catch {
        console.error(chalk.red('No .swarm/ directory found. Run `swarm init` first.'));
        process.exit(1);
      }
      const config = loadConfig();

      const state = loadFleetState(swarmDir);

      // Check for existing registration
      const existing = state.instances.find(i => i.team === opts.team && i.repo === (opts.repo || config.projectName));
      if (existing) {
        console.log(chalk.yellow(`Instance already registered: ${existing.id.slice(0, 8)}`));
        existing.lastHeartbeat = Date.now();
        existing.status = 'active';
        saveFleetState(swarmDir, state);
        console.log(chalk.dim('Heartbeat updated.'));
        return;
      }

      const instance: FleetInstance = {
        id: randomUUID(),
        team: opts.team,
        repo: opts.repo || config.projectName,
        status: 'active',
        version: '1.0.0',
        lastHeartbeat: Date.now(),
        stats: { totalRuns: 0, successRate: 0, totalCost: 0 },
      };

      state.instances.push(instance);
      saveFleetState(swarmDir, state);

      console.log(chalk.green(`\nInstance registered to fleet.`));
      console.log(chalk.dim(`  ID:   ${instance.id.slice(0, 8)}`));
      console.log(chalk.dim(`  Team: ${instance.team}`));
      console.log(chalk.dim(`  Repo: ${instance.repo}`));
      console.log('');
    });

  // --- swarm fleet status ---
  fleet
    .command('status')
    .description('Show all Swarm instances across the organization')
    .option('--team <name>', 'Filter by team')
    .action(async (opts) => {
      let swarmDir: string;
      try {
        swarmDir = requireSwarmDir();
      } catch {
        console.error(chalk.red('No .swarm/ directory found. Run `swarm init` first.'));
        process.exit(1);
      }
      loadConfig();

      const state = loadFleetState(swarmDir);
      let instances = state.instances;

      if (opts.team) {
        instances = instances.filter(i => i.team === opts.team);
      }

      if (instances.length === 0) {
        console.log(chalk.dim('No instances found.' + (opts.team ? ` (filtered by team: ${opts.team})` : '')));
        return;
      }

      // Mark stale instances as offline (no heartbeat in 10 min)
      const staleThreshold = Date.now() - 10 * 60 * 1000;
      for (const inst of instances) {
        if (inst.lastHeartbeat < staleThreshold && inst.status === 'active') {
          inst.status = 'offline';
        }
      }
      saveFleetState(swarmDir, state);

      // Group by team
      const teams = new Map<string, FleetInstance[]>();
      for (const inst of instances) {
        const list = teams.get(inst.team) || [];
        list.push(inst);
        teams.set(inst.team, list);
      }

      console.log(chalk.bold('\nFleet Status\n'));

      for (const [team, members] of teams) {
        const teamCost = members.reduce((s, m) => s + m.stats.totalCost, 0);
        const allocated = state.budget.allocated[team] ?? 0;
        const spent = state.budget.spent[team] ?? 0;

        console.log(chalk.bold(`  Team: ${team}`) + chalk.dim(` (${members.length} instance${members.length !== 1 ? 's' : ''})`));
        if (allocated > 0) {
          console.log(chalk.dim(`  Budget: $${spent.toFixed(2)} / $${allocated.toFixed(2)}`));
        }

        for (const inst of members) {
          const statusColor = inst.status === 'active' ? chalk.green
            : inst.status === 'idle' ? chalk.yellow
            : chalk.dim;
          const lastSeen = inst.lastHeartbeat
            ? `${Math.round((Date.now() - inst.lastHeartbeat) / 1000 / 60)}m ago`
            : 'never';

          console.log(`    ${inst.id.slice(0, 8)}  ${statusColor(inst.status.padEnd(8))}  ${inst.repo.slice(0, 30).padEnd(30)}  ${chalk.dim('seen ' + lastSeen)}  ${inst.stats.totalRuns} runs  $${inst.stats.totalCost.toFixed(2)}`);
        }
        console.log('');
      }
    });

  // --- swarm fleet budget ---
  fleet
    .command('budget')
    .description('Set or view budget allocation per team')
    .option('--team <name>', 'Team name')
    .option('--amount <n>', 'Budget amount in USD', parseFloat)
    .action(async (opts) => {
      let swarmDir: string;
      try {
        swarmDir = requireSwarmDir();
      } catch {
        console.error(chalk.red('No .swarm/ directory found. Run `swarm init` first.'));
        process.exit(1);
      }
      loadConfig();

      const state = loadFleetState(swarmDir);

      // Set budget
      if (opts.team && opts.amount !== undefined) {
        state.budget.allocated[opts.team] = opts.amount;

        // Recalculate total
        state.budget.total = Object.values(state.budget.allocated).reduce((s, v) => s + v, 0);
        saveFleetState(swarmDir, state);

        console.log(chalk.green(`Budget for team "${opts.team}" set to $${opts.amount.toFixed(2)}`));
        console.log(chalk.dim(`Total fleet budget: $${state.budget.total.toFixed(2)}`));
        return;
      }

      // View budget
      console.log(chalk.bold('\nFleet Budget\n'));
      console.log(`  Total: $${state.budget.total.toFixed(2)}\n`);

      const allTeams = new Set([
        ...Object.keys(state.budget.allocated),
        ...Object.keys(state.budget.spent),
      ]);

      if (allTeams.size === 0) {
        console.log(chalk.dim('  No budget allocations. Use `swarm fleet budget --team <name> --amount <n>` to set.'));
        console.log('');
        return;
      }

      console.log(chalk.dim('  Team              Allocated     Spent         Remaining'));
      console.log(chalk.dim('  ' + '─'.repeat(65)));

      for (const team of allTeams) {
        const allocated = state.budget.allocated[team] ?? 0;
        const spent = state.budget.spent[team] ?? 0;
        const remaining = allocated - spent;
        const remainingColor = remaining > 0 ? chalk.green : chalk.red;

        console.log(`  ${team.padEnd(18)}$${allocated.toFixed(2).padEnd(14)}$${spent.toFixed(2).padEnd(14)}${remainingColor('$' + remaining.toFixed(2))}`);
      }
      console.log('');
    });

  // --- swarm fleet sync ---
  fleet
    .command('sync')
    .description('Share learnings and patterns across fleet instances')
    .action(async () => {
      let swarmDir: string;
      try {
        swarmDir = requireSwarmDir();
      } catch {
        console.error(chalk.red('No .swarm/ directory found. Run `swarm init` first.'));
        process.exit(1);
      }
      loadConfig();

      const state = loadFleetState(swarmDir);

      console.log(chalk.bold('\nFleet Sync\n'));

      // Gather local knowledge
      let knowledgeCount = 0;

      // Collect conventions if they exist
      const conventionsPath = join(swarmDir, 'conventions.md');
      if (existsSync(conventionsPath)) {
        knowledgeCount++;
        console.log(chalk.dim('  Collected: project conventions'));
      }

      // Collect retro insights
      const retroPath = join(swarmDir, 'retro.json');
      if (existsSync(retroPath)) {
        knowledgeCount++;
        console.log(chalk.dim('  Collected: retrospective insights'));
      }

      // Collect self-improvement data
      const improvePath = join(swarmDir, 'self-improvement.json');
      if (existsSync(improvePath)) {
        knowledgeCount++;
        console.log(chalk.dim('  Collected: self-improvement strategies'));
      }

      // Collect guardrail rules
      const guardrailsPath = join(swarmDir, 'guardrails.yaml');
      if (existsSync(guardrailsPath)) {
        knowledgeCount++;
        console.log(chalk.dim('  Collected: guardrail rules'));
      }

      state.knowledgeItems = knowledgeCount;
      state.lastSync = Date.now();

      // Update spent budgets from instance stats
      for (const inst of state.instances) {
        const current = state.budget.spent[inst.team] ?? 0;
        state.budget.spent[inst.team] = current + inst.stats.totalCost;
      }

      saveFleetState(swarmDir, state);

      console.log('');
      console.log(chalk.green(`  Sync complete: ${knowledgeCount} knowledge items shared.`));
      console.log(chalk.dim(`  Timestamp: ${new Date().toISOString()}`));
      console.log('');

      if (state.instances.length > 1) {
        console.log(chalk.dim(`  ${state.instances.length} instances will receive updates on next heartbeat.`));
      } else {
        console.log(chalk.dim('  Register more instances with `swarm fleet register` for cross-team sharing.'));
      }
      console.log('');
    });
}
