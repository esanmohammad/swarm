import chalk from 'chalk';
import type { Command } from 'commander';
import { readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import { requireSwarmDir, loadConfig } from '../core/config.js';
import { StateManager } from '../core/state.js';

interface TeamMember {
  github: string;
  slack?: string;
  email?: string;
  areas: string[];
}

interface TeamConfig {
  members: TeamMember[];
  notifyChannel?: string;
}

interface MemberActivity {
  github: string;
  activeBranches: string[];
  recentPrs: Array<{ number: number; title: string; state: string }>;
  activeFiles: string[];
}

interface SwarmTaskActivity {
  task: string;
  status: string;
  startedAt: number;
  cost: number;
}

interface Conflict {
  file: string;
  humanDeveloper: string;
  swarmTask: string;
}

interface TeamActivity {
  members: MemberActivity[];
  swarmActivity: SwarmTaskActivity[];
  conflicts: Conflict[];
}

function loadTeamConfig(swarmDir: string): TeamConfig | null {
  const configPath = join(swarmDir, 'config.yaml');
  if (!existsSync(configPath)) return null;

  const raw = readFileSync(configPath, 'utf-8');

  // Simple YAML parsing for team section
  const teamMatch = raw.match(/^team:\s*\n([\s\S]*?)(?=^\S|\z)/m);
  if (!teamMatch) return null;

  const teamSection = teamMatch[1];
  const members: TeamMember[] = [];
  let notifyChannel: string | undefined;

  // Parse notifyChannel
  const channelMatch = teamSection.match(/notifyChannel:\s*['"]?([^\n'"]+)/);
  if (channelMatch) notifyChannel = channelMatch[1].trim();

  // Parse members
  const memberBlocks = teamSection.split(/\n\s+-\s+github:/).slice(1);
  const firstMemberMatch = teamSection.match(/\n\s+-\s+github:\s*['"]?([^\n'"]+)/);

  if (firstMemberMatch) {
    // Re-split to include first member
    const allBlocks = teamSection.split(/\s+-\s+github:\s*/).filter(Boolean).slice(0);
    for (const block of allBlocks) {
      if (block.includes('members:')) continue;
      const lines = block.split('\n');
      const github = lines[0]?.replace(/['"\s]/g, '') || '';
      if (!github) continue;

      const slackMatch = block.match(/slack:\s*['"]?([^\n'"]+)/);
      const emailMatch = block.match(/email:\s*['"]?([^\n'"]+)/);
      const areasMatch = block.match(/areas:\s*\[([^\]]*)\]/);

      const areas = areasMatch
        ? areasMatch[1].split(',').map(a => a.trim().replace(/['"]/g, '')).filter(Boolean)
        : [];

      members.push({
        github,
        slack: slackMatch?.[1]?.trim(),
        email: emailMatch?.[1]?.trim(),
        areas,
      });
    }
  }

  return { members, notifyChannel };
}

function execGitSafe(cmd: string): string {
  try {
    return execSync(cmd, { encoding: 'utf-8', timeout: 15000, stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  } catch {
    return '';
  }
}

function getRemoteBranches(): string[] {
  const output = execGitSafe('git branch -r --list "origin/*"');
  if (!output) return [];
  return output
    .split('\n')
    .map(b => b.trim().replace('origin/', ''))
    .filter(b => b && !b.includes('HEAD'));
}

function getMemberPrs(github: string): Array<{ number: number; title: string; state: string; headRefName: string }> {
  const output = execGitSafe(`gh pr list --author ${github} --state open --json number,title,state,headRefName --limit 10`);
  if (!output) return [];
  try {
    return JSON.parse(output);
  } catch {
    return [];
  }
}

function getSwarmActivity(swarmDir: string): SwarmTaskActivity[] {
  const statePath = join(swarmDir, 'state.json');
  if (!existsSync(statePath)) return [];

  try {
    const state = JSON.parse(readFileSync(statePath, 'utf-8'));
    const activities: SwarmTaskActivity[] = [];

    if (state.agents) {
      for (const agent of Object.values(state.agents) as Array<Record<string, unknown>>) {
        if (agent.status === 'running' || agent.status === 'done') {
          activities.push({
            task: (agent.name as string) || (agent.persona as string) || 'unknown',
            status: agent.status as string,
            startedAt: (agent.startedAt as number) || Date.now(),
            cost: (agent.cost as { totalUsd?: number })?.totalUsd ?? 0,
          });
        }
      }
    }

    return activities;
  } catch {
    return [];
  }
}

function detectConflicts(teamConfig: TeamConfig, memberActivities: MemberActivity[], swarmActivity: SwarmTaskActivity[]): Conflict[] {
  const conflicts: Conflict[] = [];

  for (const member of memberActivities) {
    const memberAreas = teamConfig.members.find(m => m.github === member.github)?.areas ?? [];

    for (const task of swarmActivity) {
      if (task.status !== 'running') continue;

      // Check if the swarm task name overlaps with member's areas
      for (const area of memberAreas) {
        const areaLower = area.toLowerCase();
        const taskLower = task.task.toLowerCase();
        if (taskLower.includes(areaLower) || areaLower.includes(taskLower)) {
          conflicts.push({
            file: area,
            humanDeveloper: member.github,
            swarmTask: task.task,
          });
        }
      }

      // Check if active branches overlap
      for (const branch of member.activeBranches) {
        const branchLower = branch.toLowerCase();
        const taskLower = task.task.toLowerCase();
        if (branchLower.includes(taskLower) || taskLower.includes(branchLower)) {
          conflicts.push({
            file: `branch: ${branch}`,
            humanDeveloper: member.github,
            swarmTask: task.task,
          });
        }
      }
    }
  }

  // Deduplicate
  const seen = new Set<string>();
  return conflicts.filter(c => {
    const key = `${c.file}:${c.humanDeveloper}:${c.swarmTask}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function buildTeamActivity(swarmDir: string, teamConfig: TeamConfig): TeamActivity {
  const remoteBranches = getRemoteBranches();
  const swarmActivity = getSwarmActivity(swarmDir);
  const memberActivities: MemberActivity[] = [];

  for (const member of teamConfig.members) {
    const prs = getMemberPrs(member.github);
    const activeBranches = prs.map(pr => pr.headRefName).filter(Boolean);

    // Also check remote branches that might belong to this member
    const matchedBranches = remoteBranches.filter(b =>
      b.toLowerCase().includes(member.github.toLowerCase())
    );

    const allBranches = [...new Set([...activeBranches, ...matchedBranches])];

    memberActivities.push({
      github: member.github,
      activeBranches: allBranches,
      recentPrs: prs.map(pr => ({ number: pr.number, title: pr.title, state: pr.state })),
      activeFiles: member.areas,
    });
  }

  const conflicts = detectConflicts(teamConfig, memberActivities, swarmActivity);

  return { members: memberActivities, swarmActivity, conflicts };
}

function printTeamSummary(teamConfig: TeamConfig, activity: TeamActivity): void {
  console.log(chalk.bold('\nTeam Awareness\n'));

  // Members
  console.log(chalk.bold('  Members'));
  for (const member of teamConfig.members) {
    const act = activity.members.find(m => m.github === member.github);
    const prCount = act?.recentPrs.length ?? 0;
    const branchCount = act?.activeBranches.length ?? 0;
    const areas = member.areas.length > 0 ? chalk.dim(` [${member.areas.join(', ')}]`) : '';
    console.log(`    ${chalk.cyan('@' + member.github)}${areas}`);
    console.log(`      ${chalk.green(String(prCount))} open PRs | ${chalk.blue(String(branchCount))} active branches`);
  }
  console.log('');

  // Swarm Activity
  if (activity.swarmActivity.length > 0) {
    console.log(chalk.bold('  Swarm Activity'));
    for (const task of activity.swarmActivity) {
      const statusColor = task.status === 'running' ? chalk.yellow : chalk.green;
      const elapsed = task.startedAt ? `${((Date.now() - task.startedAt) / 60000).toFixed(0)}m ago` : '';
      console.log(`    ${statusColor(task.status.padEnd(8))} ${task.task} ${chalk.dim(elapsed)} ${chalk.yellow('$' + task.cost.toFixed(2))}`);
    }
    console.log('');
  }

  // Conflicts
  if (activity.conflicts.length > 0) {
    console.log(chalk.bold.red('  Potential Conflicts'));
    for (const conflict of activity.conflicts) {
      console.log(`    ${chalk.yellow('⚠')} ${chalk.red(conflict.file)}`);
      console.log(`      Human: ${chalk.cyan('@' + conflict.humanDeveloper)} | Swarm: ${chalk.magenta(conflict.swarmTask)}`);
    }
    console.log('');
  } else {
    console.log(chalk.dim('  No conflicts detected.\n'));
  }

  if (teamConfig.notifyChannel) {
    console.log(chalk.dim(`  Notify channel: ${teamConfig.notifyChannel}\n`));
  }
}

export function registerTeam(program: Command): void {
  const team = program
    .command('team')
    .description('Team awareness — show team activity status and coordinate work')
    .action(() => {
      let swarmDir: string;
      try {
        swarmDir = requireSwarmDir();
      } catch {
        console.error(chalk.red('No .swarm/ directory found. Run `swarm init` first.'));
        process.exit(1);
      }

      const teamConfig = loadTeamConfig(swarmDir);
      if (!teamConfig || teamConfig.members.length === 0) {
        console.log(chalk.yellow('\nNo team configuration found.'));
        console.log(chalk.dim('Add a `team:` section to .swarm/config.yaml with team members.\n'));
        console.log(chalk.dim('Example:'));
        console.log(chalk.dim('  team:'));
        console.log(chalk.dim('    notifyChannel: "#dev-swarm"'));
        console.log(chalk.dim('    members:'));
        console.log(chalk.dim('      - github: octocat'));
        console.log(chalk.dim('        areas: [frontend, auth]'));
        console.log('');
        return;
      }

      const activity = buildTeamActivity(swarmDir, teamConfig);
      printTeamSummary(teamConfig, activity);
    });

  team
    .command('config')
    .description('Show team configuration from .swarm/config.yaml')
    .action(() => {
      let swarmDir: string;
      try {
        swarmDir = requireSwarmDir();
      } catch {
        console.error(chalk.red('No .swarm/ directory found. Run `swarm init` first.'));
        process.exit(1);
      }

      const teamConfig = loadTeamConfig(swarmDir);
      if (!teamConfig || teamConfig.members.length === 0) {
        console.log(chalk.yellow('\nNo team configuration found in .swarm/config.yaml\n'));
        return;
      }

      console.log(chalk.bold('\nTeam Configuration\n'));

      if (teamConfig.notifyChannel) {
        console.log(`  Notify channel: ${chalk.cyan(teamConfig.notifyChannel)}`);
      }

      console.log(chalk.bold('\n  Members'));
      for (const member of teamConfig.members) {
        console.log(`    ${chalk.cyan('@' + member.github)}`);
        if (member.slack) console.log(`      Slack: ${member.slack}`);
        if (member.email) console.log(`      Email: ${member.email}`);
        if (member.areas.length > 0) console.log(`      Areas: ${member.areas.join(', ')}`);
      }
      console.log('');
    });

  team
    .command('activity')
    .description('Show detailed team activity — branches, PRs, and swarm work')
    .action(() => {
      let swarmDir: string;
      try {
        swarmDir = requireSwarmDir();
      } catch {
        console.error(chalk.red('No .swarm/ directory found. Run `swarm init` first.'));
        process.exit(1);
      }

      const teamConfig = loadTeamConfig(swarmDir);
      if (!teamConfig || teamConfig.members.length === 0) {
        console.log(chalk.yellow('\nNo team configured. Add a `team:` section to .swarm/config.yaml\n'));
        return;
      }

      console.log(chalk.bold('\nTeam Activity\n'));
      const activity = buildTeamActivity(swarmDir, teamConfig);

      for (const member of activity.members) {
        const config = teamConfig.members.find(m => m.github === member.github);
        console.log(`  ${chalk.bold.cyan('@' + member.github)} ${chalk.dim(config?.areas?.join(', ') ?? '')}`);

        if (member.recentPrs.length > 0) {
          console.log(chalk.dim('    Open PRs:'));
          for (const pr of member.recentPrs) {
            console.log(`      ${chalk.green('#' + pr.number)} ${pr.title}`);
          }
        } else {
          console.log(chalk.dim('    No open PRs'));
        }

        if (member.activeBranches.length > 0) {
          console.log(chalk.dim('    Active branches:'));
          for (const branch of member.activeBranches) {
            console.log(`      ${chalk.blue(branch)}`);
          }
        }
        console.log('');
      }

      if (activity.swarmActivity.length > 0) {
        console.log(chalk.bold('  Swarm Pipeline Activity'));
        for (const task of activity.swarmActivity) {
          const statusColor = task.status === 'running' ? chalk.yellow : chalk.green;
          const elapsed = task.startedAt ? `${((Date.now() - task.startedAt) / 60000).toFixed(0)}m` : '';
          console.log(`    ${statusColor('●')} ${task.task} — ${task.status} ${chalk.dim(elapsed)} ${chalk.yellow('$' + task.cost.toFixed(2))}`);
        }
        console.log('');
      }

      if (activity.conflicts.length > 0) {
        console.log(chalk.bold.red('  Conflict Warnings'));
        for (const conflict of activity.conflicts) {
          console.log(`    ${chalk.yellow('⚠')}  ${chalk.red(conflict.file)}`);
          console.log(`       ${chalk.cyan('@' + conflict.humanDeveloper)} is working in an area overlapping with swarm task ${chalk.magenta(conflict.swarmTask)}`);
        }
        console.log('');
      }
    });

  team
    .command('notify <message>')
    .description('Send a notification to the team channel')
    .action((message: string) => {
      let swarmDir: string;
      try {
        swarmDir = requireSwarmDir();
      } catch {
        console.error(chalk.red('No .swarm/ directory found. Run `swarm init` first.'));
        process.exit(1);
      }

      const notificationsPath = join(swarmDir, 'notifications.jsonl');
      const entry = {
        timestamp: Date.now(),
        date: new Date().toISOString(),
        message,
        source: 'cli',
      };

      appendFileSync(notificationsPath, JSON.stringify(entry) + '\n', 'utf-8');
      console.log(chalk.green('Notification recorded.'));

      const teamConfig = loadTeamConfig(swarmDir);
      if (teamConfig?.notifyChannel) {
        console.log(chalk.dim(`Channel: ${teamConfig.notifyChannel} (webhook delivery not yet configured)`));
      }

      console.log(chalk.dim(`Logged to ${notificationsPath}`));
    });
}

/** Export for dashboard/WS server use */
export { buildTeamActivity, loadTeamConfig };
export type { TeamConfig, TeamActivity, TeamMember, MemberActivity, SwarmTaskActivity, Conflict };
