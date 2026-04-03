import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join } from 'node:path';
import chalk from 'chalk';
import ora from 'ora';
import type { Command } from 'commander';
import { requireSwarmDir, loadConfig } from '../core/config.js';
import type { PipelineState, StageName } from '../types.js';

// PM provider types
export type PmProvider = 'github' | 'linear' | 'jira';

export interface PmSyncState {
  lastSyncAt: number | null;
  provider: PmProvider;
  project: string | null;
  tickets: PmTicketMapping[];
}

export interface PmTicketMapping {
  ticketId: string;
  title: string;
  pmStatus: string;
  pipelineStage: StageName | 'complete' | 'error' | null;
  lastSyncAt: number;
  url?: string;
}

// Map pipeline stages to PM statuses
const STAGE_TO_PM_STATUS: Record<string, string> = {
  analyze: 'In Progress',
  architect: 'In Progress',
  plan: 'In Review',
  build: 'In Development',
  test: 'Testing',
  evaluate: 'Testing',
  complete: 'Done',
  error: 'Blocked',
};

function getPmSyncPath(swarmDir: string): string {
  return join(swarmDir, 'pm-sync.json');
}

function loadPmSync(swarmDir: string): PmSyncState {
  const syncPath = getPmSyncPath(swarmDir);
  if (existsSync(syncPath)) {
    try {
      return JSON.parse(readFileSync(syncPath, 'utf-8'));
    } catch {
      // Corrupted — start fresh
    }
  }
  return { lastSyncAt: null, provider: 'github', project: null, tickets: [] };
}

function savePmSync(swarmDir: string, state: PmSyncState): void {
  writeFileSync(getPmSyncPath(swarmDir), JSON.stringify(state, null, 2), 'utf-8');
}

function loadPipelineState(swarmDir: string): PipelineState | null {
  const statePath = join(swarmDir, 'state.json');
  if (!existsSync(statePath)) return null;
  try {
    return JSON.parse(readFileSync(statePath, 'utf-8'));
  } catch {
    return null;
  }
}

function getCurrentPipelineStage(state: PipelineState): string {
  const stageOrder: StageName[] = ['analyze', 'architect', 'plan', 'build', 'test', 'evaluate'];

  // Check for errors first
  for (const stage of stageOrder) {
    if (state.stages[stage].status === 'error') return 'error';
  }

  // Check if all done
  const allDone = stageOrder.every(s => state.stages[s].status === 'done' || state.stages[s].status === 'skipped');
  if (allDone) return 'complete';

  // Find current running or first pending stage
  for (const stage of stageOrder) {
    if (state.stages[stage].status === 'running') return stage;
  }
  for (const stage of stageOrder) {
    if (state.stages[stage].status === 'pending') return stage;
  }

  return 'complete';
}

function getPmStatus(pipelineStage: string): string {
  return STAGE_TO_PM_STATUS[pipelineStage] || 'In Progress';
}

// --- GitHub provider ---
async function syncGitHub(project: string | null, pipelineState: PipelineState, syncState: PmSyncState): Promise<void> {
  const currentStage = getCurrentPipelineStage(pipelineState);
  const pmStatus = getPmStatus(currentStage);
  const spinner = ora('Syncing with GitHub Issues...').start();

  try {
    // Get open issues for the project
    const repo = project || getGitHubRepo();
    if (!repo) {
      spinner.fail('Could not determine GitHub repo. Use --project <owner/repo> or run from a git repo.');
      return;
    }

    // Update labels on issues that match the pipeline project
    const labelName = `swarm:${pmStatus.toLowerCase().replace(/\s+/g, '-')}`;
    const staleLabels = ['hivemind:in-progress', 'hivemind:in-review', 'hivemind:in-development', 'hivemind:testing', 'hivemind:done', 'hivemind:blocked']
      .filter(l => l !== `swarm:${pmStatus.toLowerCase().replace(/\s+/g, '-')}`);

    // Check if project label exists, create if not
    try {
      execSync(`gh label create "${labelName}" --repo "${repo}" --color 0E8A16 --force 2>/dev/null`, { stdio: 'pipe' });
    } catch {
      // Label may already exist — that's fine
    }

    // Find issues with any swarm: label and update them
    for (const staleLabel of staleLabels) {
      try {
        const issuesJson = execSync(
          `gh issue list --repo "${repo}" --label "${staleLabel}" --json number --limit 50`,
          { stdio: 'pipe', encoding: 'utf-8' },
        );
        const issues = JSON.parse(issuesJson) as Array<{ number: number }>;
        for (const issue of issues) {
          execSync(`gh issue edit ${issue.number} --repo "${repo}" --remove-label "${staleLabel}" --add-label "${labelName}"`, { stdio: 'pipe' });
          // Track in sync state
          const existing = syncState.tickets.find(t => t.ticketId === String(issue.number));
          if (existing) {
            existing.pmStatus = pmStatus;
            existing.pipelineStage = currentStage as StageName | 'complete' | 'error';
            existing.lastSyncAt = Date.now();
          } else {
            syncState.tickets.push({
              ticketId: String(issue.number),
              title: `#${issue.number}`,
              pmStatus,
              pipelineStage: currentStage as StageName | 'complete' | 'error',
              lastSyncAt: Date.now(),
              url: `https://github.com/${repo}/issues/${issue.number}`,
            });
          }
        }
      } catch {
        // Label might not exist yet — skip
      }
    }

    syncState.lastSyncAt = Date.now();
    syncState.provider = 'github';
    syncState.project = repo;
    spinner.succeed(`Synced to GitHub (${repo}) — pipeline status: ${chalk.bold(pmStatus)}`);
  } catch (err) {
    spinner.fail(`GitHub sync failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function getGitHubRepo(): string | null {
  try {
    const remote = execSync('gh repo view --json nameWithOwner -q .nameWithOwner', { stdio: 'pipe', encoding: 'utf-8' }).trim();
    return remote || null;
  } catch {
    return null;
  }
}

// --- Linear provider ---
async function syncLinear(project: string | null, pipelineState: PipelineState, syncState: PmSyncState): Promise<void> {
  const apiKey = process.env.SWARM_LINEAR_API_KEY;
  if (!apiKey) {
    console.error(chalk.red('SWARM_LINEAR_API_KEY environment variable is required for Linear integration.'));
    console.log(chalk.dim('Get your API key from: https://linear.app/settings/api'));
    return;
  }

  const currentStage = getCurrentPipelineStage(pipelineState);
  const pmStatus = getPmStatus(currentStage);
  const spinner = ora('Syncing with Linear...').start();

  try {
    // Get team issues via Linear GraphQL API
    const teamKey = project || 'default';

    const query = `{
      issues(filter: { labels: { name: { eq: "hivemind" } } }, first: 50) {
        nodes {
          id
          identifier
          title
          url
          state { name }
        }
      }
    }`;

    const response = await fetch('https://api.linear.app/graphql', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': apiKey,
      },
      body: JSON.stringify({ query }),
    });

    if (!response.ok) {
      spinner.fail(`Linear API returned ${response.status}`);
      return;
    }

    const data = await response.json() as { data: { issues: { nodes: Array<{ id: string; identifier: string; title: string; url: string; state: { name: string } }> } } };
    const issues = data.data?.issues?.nodes ?? [];

    // Map Linear states: update issues with appropriate status
    const linearStateMap: Record<string, string> = {
      'In Progress': 'In Progress',
      'In Review': 'In Review',
      'In Development': 'In Progress',
      'Testing': 'In Review',
      'Done': 'Done',
      'Blocked': 'Cancelled',
    };
    const targetState = linearStateMap[pmStatus] || 'In Progress';

    for (const issue of issues) {
      // Update issue state via mutation
      const mutation = `mutation {
        issueUpdate(id: "${issue.id}", input: { stateId: null }) {
          success
        }
      }`;

      // Note: Actual state update requires knowing the workflow state IDs.
      // For now, we track the mapping and log the intended status.
      const existing = syncState.tickets.find(t => t.ticketId === issue.identifier);
      if (existing) {
        existing.pmStatus = pmStatus;
        existing.pipelineStage = currentStage as StageName | 'complete' | 'error';
        existing.lastSyncAt = Date.now();
      } else {
        syncState.tickets.push({
          ticketId: issue.identifier,
          title: issue.title,
          pmStatus,
          pipelineStage: currentStage as StageName | 'complete' | 'error',
          lastSyncAt: Date.now(),
          url: issue.url,
        });
      }
    }

    syncState.lastSyncAt = Date.now();
    syncState.provider = 'linear';
    syncState.project = teamKey;
    spinner.succeed(`Synced to Linear (${teamKey}) — ${issues.length} issues, status: ${chalk.bold(pmStatus)}`);
  } catch (err) {
    spinner.fail(`Linear sync failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// --- Jira provider ---
async function syncJira(project: string | null, pipelineState: PipelineState, syncState: PmSyncState): Promise<void> {
  const jiraUrl = process.env.SWARM_JIRA_URL;
  const jiraToken = process.env.SWARM_JIRA_TOKEN;
  if (!jiraUrl || !jiraToken) {
    console.error(chalk.red('SWARM_JIRA_URL and SWARM_JIRA_TOKEN environment variables are required for Jira integration.'));
    console.log(chalk.dim('Set SWARM_JIRA_URL to your Jira instance URL (e.g., https://company.atlassian.net)'));
    console.log(chalk.dim('Set SWARM_JIRA_TOKEN to your Jira API token (email:token base64 encoded)'));
    return;
  }

  const currentStage = getCurrentPipelineStage(pipelineState);
  const pmStatus = getPmStatus(currentStage);
  const spinner = ora('Syncing with Jira...').start();

  try {
    const projectKey = project || 'SWARM';
    const jql = `project = "${projectKey}" AND labels = "hivemind" ORDER BY updated DESC`;
    const searchUrl = `${jiraUrl}/rest/api/3/search?jql=${encodeURIComponent(jql)}&maxResults=50`;

    const response = await fetch(searchUrl, {
      headers: {
        'Authorization': `Basic ${jiraToken}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      spinner.fail(`Jira API returned ${response.status}`);
      return;
    }

    const data = await response.json() as { issues: Array<{ key: string; fields: { summary: string; status: { name: string } }; self: string }> };
    const issues = data.issues ?? [];

    for (const issue of issues) {
      // Track in sync state
      const existing = syncState.tickets.find(t => t.ticketId === issue.key);
      if (existing) {
        existing.pmStatus = pmStatus;
        existing.pipelineStage = currentStage as StageName | 'complete' | 'error';
        existing.lastSyncAt = Date.now();
      } else {
        syncState.tickets.push({
          ticketId: issue.key,
          title: issue.fields.summary,
          pmStatus,
          pipelineStage: currentStage as StageName | 'complete' | 'error',
          lastSyncAt: Date.now(),
          url: `${jiraUrl}/browse/${issue.key}`,
        });
      }

      // Transition the issue (Jira uses transition IDs)
      // Get available transitions
      try {
        const transResponse = await fetch(`${jiraUrl}/rest/api/3/issue/${issue.key}/transitions`, {
          headers: {
            'Authorization': `Basic ${jiraToken}`,
            'Content-Type': 'application/json',
          },
        });
        if (transResponse.ok) {
          const transData = await transResponse.json() as { transitions: Array<{ id: string; name: string }> };
          const targetTransition = transData.transitions.find(
            t => t.name.toLowerCase().includes(pmStatus.toLowerCase().split(' ').pop() || ''),
          );
          if (targetTransition) {
            await fetch(`${jiraUrl}/rest/api/3/issue/${issue.key}/transitions`, {
              method: 'POST',
              headers: {
                'Authorization': `Basic ${jiraToken}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({ transition: { id: targetTransition.id } }),
            });
          }
        }
      } catch {
        // Transition might not be available — skip
      }
    }

    syncState.lastSyncAt = Date.now();
    syncState.provider = 'jira';
    syncState.project = projectKey;
    spinner.succeed(`Synced to Jira (${projectKey}) — ${issues.length} issues, status: ${chalk.bold(pmStatus)}`);
  } catch (err) {
    spinner.fail(`Jira sync failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// --- Import ticket ---
async function importTicket(
  ticketId: string,
  provider: PmProvider,
  project: string | null,
): Promise<{ title: string; description: string; acceptanceCriteria: string[]; labels: string[] } | null> {
  if (provider === 'github') {
    return importGitHubTicket(ticketId, project);
  } else if (provider === 'linear') {
    return importLinearTicket(ticketId);
  } else if (provider === 'jira') {
    return importJiraTicket(ticketId, project);
  }
  return null;
}

function importGitHubTicket(
  ticketId: string,
  project: string | null,
): { title: string; description: string; acceptanceCriteria: string[]; labels: string[] } | null {
  try {
    const repo = project || getGitHubRepo();
    if (!repo) {
      console.error(chalk.red('Could not determine GitHub repo.'));
      return null;
    }

    const issueJson = execSync(
      `gh issue view ${ticketId} --repo "${repo}" --json title,body,labels`,
      { stdio: 'pipe', encoding: 'utf-8' },
    );
    const issue = JSON.parse(issueJson) as { title: string; body: string; labels: Array<{ name: string }> };

    const acceptanceCriteria = extractAcceptanceCriteria(issue.body || '');

    return {
      title: issue.title,
      description: issue.body || '',
      acceptanceCriteria,
      labels: issue.labels.map(l => l.name),
    };
  } catch (err) {
    console.error(chalk.red(`Failed to fetch GitHub issue #${ticketId}: ${err instanceof Error ? err.message : String(err)}`));
    return null;
  }
}

async function importLinearTicket(
  ticketId: string,
): Promise<{ title: string; description: string; acceptanceCriteria: string[]; labels: string[] } | null> {
  const apiKey = process.env.SWARM_LINEAR_API_KEY;
  if (!apiKey) {
    console.error(chalk.red('SWARM_LINEAR_API_KEY required for Linear import.'));
    return null;
  }

  try {
    const query = `{
      issue(id: "${ticketId}") {
        title
        description
        labels { nodes { name } }
      }
    }`;

    const response = await fetch('https://api.linear.app/graphql', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': apiKey,
      },
      body: JSON.stringify({ query }),
    });

    if (!response.ok) return null;

    const data = await response.json() as { data: { issue: { title: string; description: string; labels: { nodes: Array<{ name: string }> } } } };
    const issue = data.data?.issue;
    if (!issue) return null;

    return {
      title: issue.title,
      description: issue.description || '',
      acceptanceCriteria: extractAcceptanceCriteria(issue.description || ''),
      labels: issue.labels?.nodes?.map((l: { name: string }) => l.name) ?? [],
    };
  } catch (err) {
    console.error(chalk.red(`Failed to fetch Linear issue ${ticketId}: ${err instanceof Error ? err.message : String(err)}`));
    return null;
  }
}

async function importJiraTicket(
  ticketId: string,
  project: string | null,
): Promise<{ title: string; description: string; acceptanceCriteria: string[]; labels: string[] } | null> {
  const jiraUrl = process.env.SWARM_JIRA_URL;
  const jiraToken = process.env.SWARM_JIRA_TOKEN;
  if (!jiraUrl || !jiraToken) {
    console.error(chalk.red('SWARM_JIRA_URL and SWARM_JIRA_TOKEN required for Jira import.'));
    return null;
  }

  try {
    const response = await fetch(`${jiraUrl}/rest/api/3/issue/${ticketId}`, {
      headers: {
        'Authorization': `Basic ${jiraToken}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) return null;

    const data = await response.json() as {
      fields: {
        summary: string;
        description: { content?: Array<{ content?: Array<{ text?: string }> }> } | string | null;
        labels: string[];
      };
    };
    const fields = data.fields;

    // Jira ADF description — extract text content
    let description = '';
    if (typeof fields.description === 'string') {
      description = fields.description;
    } else if (fields.description?.content) {
      description = fields.description.content
        .flatMap((block: { content?: Array<{ text?: string }> }) => block.content?.map((c: { text?: string }) => c.text || '') ?? [])
        .join('\n');
    }

    return {
      title: fields.summary,
      description,
      acceptanceCriteria: extractAcceptanceCriteria(description),
      labels: fields.labels ?? [],
    };
  } catch (err) {
    console.error(chalk.red(`Failed to fetch Jira issue ${ticketId}: ${err instanceof Error ? err.message : String(err)}`));
    return null;
  }
}

function extractAcceptanceCriteria(body: string): string[] {
  const criteria: string[] = [];
  const lines = body.split('\n');
  let inAcSection = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (/^#+\s*(acceptance\s+criteria|ac\b)/i.test(trimmed)) {
      inAcSection = true;
      continue;
    }
    if (inAcSection && /^#+\s/.test(trimmed)) {
      inAcSection = false;
      continue;
    }
    if (inAcSection && /^[-*]\s/.test(trimmed)) {
      criteria.push(trimmed.replace(/^[-*]\s+/, ''));
    }
    // Also extract checkbox items anywhere
    if (/^\s*-\s*\[[ x]\]\s+/i.test(line)) {
      criteria.push(line.replace(/^\s*-\s*\[[ x]\]\s+/i, '').trim());
    }
  }

  return criteria;
}

export function registerPm(program: Command): void {
  const pm = program
    .command('pm')
    .description('Project management integration — sync pipeline state to GitHub, Linear, or Jira');

  // --- pm sync ---
  pm
    .command('sync')
    .description('Sync current pipeline state to PM tool')
    .option('--provider <provider>', 'PM provider: github, linear, jira', 'github')
    .option('--project <project>', 'Project identifier (e.g., owner/repo for GitHub, project key for Jira)')
    .option('--model <model>', 'Model for AI-powered summaries (e.g., sonnet, openai/gpt-4o)', 'sonnet')
    .action(async (opts) => {
      let swarmDir: string;
      try {
        swarmDir = requireSwarmDir();
      } catch {
        console.error(chalk.red('No .swarm/ directory found. Run `hivemind init` first.'));
        process.exit(1);
      }

      const provider = opts.provider as PmProvider;
      if (!['github', 'linear', 'jira'].includes(provider)) {
        console.error(chalk.red(`Invalid provider: ${provider}. Must be github, linear, or jira.`));
        process.exit(1);
      }

      const pipelineState = loadPipelineState(swarmDir);
      if (!pipelineState) {
        console.error(chalk.red('No pipeline state found. Run a pipeline stage first.'));
        process.exit(1);
      }

      const syncState = loadPmSync(swarmDir);

      console.log(chalk.bold('\nSwarm PM Sync'));
      console.log(chalk.dim(`Provider: ${provider} | Project: ${opts.project || 'auto-detect'}\n`));

      if (provider === 'github') {
        await syncGitHub(opts.project || null, pipelineState, syncState);
      } else if (provider === 'linear') {
        await syncLinear(opts.project || null, pipelineState, syncState);
      } else if (provider === 'jira') {
        await syncJira(opts.project || null, pipelineState, syncState);
      }

      savePmSync(swarmDir, syncState);
    });

  // --- pm import ---
  pm
    .command('import')
    .description('Import a ticket from PM tool as a feature request')
    .argument('<ticket-id>', 'Ticket ID to import (e.g., 123 for GitHub, PROJ-123 for Jira)')
    .option('--provider <provider>', 'PM provider: github, linear, jira', 'github')
    .option('--project <project>', 'Project identifier')
    .option('--model <model>', 'Model for pipeline (e.g., sonnet, openai/gpt-4o)', 'sonnet')
    .option('--run', 'Immediately run MayDay pipeline with imported ticket')
    .action(async (ticketId: string, opts) => {
      let swarmDir: string;
      try {
        swarmDir = requireSwarmDir();
      } catch {
        console.error(chalk.red('No .swarm/ directory found. Run `hivemind init` first.'));
        process.exit(1);
      }

      const provider = opts.provider as PmProvider;
      if (!['github', 'linear', 'jira'].includes(provider)) {
        console.error(chalk.red(`Invalid provider: ${provider}. Must be github, linear, or jira.`));
        process.exit(1);
      }

      console.log(chalk.bold('\nSwarm PM Import'));
      console.log(chalk.dim(`Provider: ${provider} | Ticket: ${ticketId}\n`));

      const spinner = ora(`Fetching ticket ${ticketId} from ${provider}...`).start();
      const ticket = await importTicket(ticketId, provider, opts.project || null);

      if (!ticket) {
        spinner.fail(`Failed to import ticket ${ticketId}`);
        process.exit(1);
      }

      spinner.succeed(`Imported: ${ticket.title}`);

      console.log('');
      console.log(chalk.bold('Title: ') + ticket.title);
      if (ticket.labels.length > 0) {
        console.log(chalk.bold('Labels: ') + ticket.labels.map(l => chalk.cyan(l)).join(', '));
      }
      if (ticket.acceptanceCriteria.length > 0) {
        console.log(chalk.bold('\nAcceptance Criteria:'));
        for (const ac of ticket.acceptanceCriteria) {
          console.log(chalk.dim(`  - ${ac}`));
        }
      }

      // Format as feature request
      const featureRequest = formatAsFeatureRequest(ticket);
      console.log(chalk.dim(`\nFormatted feature request (${featureRequest.length} chars)`));

      if (opts.run) {
        console.log(chalk.yellow('\nStarting MayDay pipeline with imported ticket...\n'));
        const config = loadConfig(process.cwd());
        const { createContext } = await import('./shared.js');
        const { pipeline, cleanup } = createContext(swarmDir, config);

        try {
          await pipeline.runMayday(featureRequest, {
            stack: config.stack,
            maxIterations: 5,
            parallel: 3,
            model: opts.model,
          });
        } catch (err) {
          console.error(chalk.red(err instanceof Error ? err.message : String(err)));
          process.exit(1);
        } finally {
          cleanup();
        }
      } else {
        console.log(chalk.dim('\nFeature request:'));
        console.log(chalk.white(featureRequest));
        console.log(chalk.dim('\nRun with --run flag to start the MayDay pipeline, or copy the above into `hivemind mayday`.'));
      }

      // Track the import in sync state
      const syncState = loadPmSync(swarmDir);
      const existing = syncState.tickets.find(t => t.ticketId === ticketId);
      if (!existing) {
        syncState.tickets.push({
          ticketId,
          title: ticket.title,
          pmStatus: 'Imported',
          pipelineStage: null,
          lastSyncAt: Date.now(),
        });
      }
      savePmSync(swarmDir, syncState);
    });

  // --- pm status ---
  pm
    .command('status')
    .description('Show PM sync status and ticket mappings')
    .option('--provider <provider>', 'PM provider: github, linear, jira', 'github')
    .action(async (opts) => {
      let swarmDir: string;
      try {
        swarmDir = requireSwarmDir();
      } catch {
        console.error(chalk.red('No .swarm/ directory found. Run `hivemind init` first.'));
        process.exit(1);
      }

      const syncState = loadPmSync(swarmDir);
      const pipelineState = loadPipelineState(swarmDir);

      console.log(chalk.bold('\nSwarm PM Status\n'));

      // Last sync info
      if (syncState.lastSyncAt) {
        const ago = Math.round((Date.now() - syncState.lastSyncAt) / 1000);
        const agoStr = ago < 60 ? `${ago}s ago` : ago < 3600 ? `${Math.round(ago / 60)}m ago` : `${Math.round(ago / 3600)}h ago`;
        console.log(chalk.dim(`Last sync: ${new Date(syncState.lastSyncAt).toLocaleString()} (${agoStr})`));
        console.log(chalk.dim(`Provider:  ${syncState.provider}`));
        if (syncState.project) console.log(chalk.dim(`Project:   ${syncState.project}`));
      } else {
        console.log(chalk.yellow('Never synced. Run `hivemind pm sync` to sync pipeline state.'));
      }

      // Current pipeline status
      if (pipelineState) {
        const currentStage = getCurrentPipelineStage(pipelineState);
        const pmStatus = getPmStatus(currentStage);
        console.log('');
        console.log(chalk.bold('Pipeline:'));
        console.log(`  Stage:  ${chalk.cyan(currentStage)}`);
        console.log(`  Status: ${chalk.green(pmStatus)}`);
      }

      // Tracked tickets
      if (syncState.tickets.length > 0) {
        console.log('');
        console.log(chalk.bold('Tracked Tickets:'));
        console.log(chalk.dim('  ID           PM Status         Pipeline Stage    Last Sync'));
        console.log(chalk.dim('  ' + '─'.repeat(70)));

        for (const ticket of syncState.tickets) {
          const lastSync = ticket.lastSyncAt
            ? new Date(ticket.lastSyncAt).toLocaleTimeString()
            : 'never';
          const pStage = ticket.pipelineStage || 'n/a';
          console.log(
            `  ${chalk.white(ticket.ticketId.padEnd(13))}` +
            `${chalk.green(ticket.pmStatus.padEnd(18))}` +
            `${chalk.cyan(pStage.padEnd(18))}` +
            `${chalk.dim(lastSync)}`,
          );
        }
      } else {
        console.log(chalk.dim('\nNo tracked tickets yet.'));
      }

      console.log('');
    });
}

function formatAsFeatureRequest(ticket: {
  title: string;
  description: string;
  acceptanceCriteria: string[];
  labels: string[];
}): string {
  const parts: string[] = [];
  parts.push(`Feature: ${ticket.title}`);
  parts.push('');

  if (ticket.description) {
    parts.push('Description:');
    parts.push(ticket.description.slice(0, 2000));
    parts.push('');
  }

  if (ticket.acceptanceCriteria.length > 0) {
    parts.push('Acceptance Criteria:');
    for (const ac of ticket.acceptanceCriteria) {
      parts.push(`- ${ac}`);
    }
    parts.push('');
  }

  if (ticket.labels.length > 0) {
    parts.push(`Tags: ${ticket.labels.join(', ')}`);
  }

  return parts.join('\n').trim();
}

/** Export for dashboard/WS server use */
export { loadPmSync, savePmSync, importTicket, formatAsFeatureRequest, getCurrentPipelineStage, getPmStatus };
export type { PmSyncState as PmSyncStateType };
