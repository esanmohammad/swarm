import * as vscode from 'vscode';
import type { SwarmClient } from './swarm-client';
import type { PipelineState, StageName, StageState, Agent, CostInfo } from './types';

type TreeItemType = 'stage' | 'agent' | 'cost' | 'no-connection' | 'no-stages';

interface SwarmTreeItemData {
  type: TreeItemType;
  stageName?: StageName;
  stageState?: StageState;
  agent?: Agent;
  costInfo?: CostInfo;
}

const STAGE_ORDER: StageName[] = ['analyze', 'architect', 'plan', 'build', 'test'];

const STAGE_LABELS: Record<StageName, string> = {
  analyze: 'Analyze',
  architect: 'Architect',
  plan: 'Plan',
  build: 'Build',
  test: 'Test',
  evaluate: 'Evaluate',
};

const PERSONA_FOR_STAGE: Record<string, string> = {
  analyze: 'analyst',
  architect: 'architect',
  plan: 'lead',
  build: 'engineer',
  test: 'tester',
};

function stageStatusIcon(status: string): vscode.ThemeIcon {
  switch (status) {
    case 'running':
      return new vscode.ThemeIcon('sync~spin');
    case 'done':
      return new vscode.ThemeIcon('check');
    case 'error':
      return new vscode.ThemeIcon('error');
    case 'skipped':
      return new vscode.ThemeIcon('dash');
    default:
      return new vscode.ThemeIcon('circle-outline');
  }
}

function agentStatusIcon(status: string): vscode.ThemeIcon {
  switch (status) {
    case 'running':
      return new vscode.ThemeIcon('sync~spin');
    case 'done':
      return new vscode.ThemeIcon('check');
    case 'error':
      return new vscode.ThemeIcon('error');
    case 'killed':
      return new vscode.ThemeIcon('circle-slash');
    default:
      return new vscode.ThemeIcon('circle-outline');
  }
}

function formatCost(cost: CostInfo): string {
  return `$${cost.totalUsd.toFixed(4)}`;
}

function formatDuration(ms: number): string {
  if (ms < 1000) { return `${ms}ms`; }
  const sec = Math.floor(ms / 1000);
  if (sec < 60) { return `${sec}s`; }
  const min = Math.floor(sec / 60);
  const remSec = sec % 60;
  return `${min}m ${remSec}s`;
}

export class SwarmTreeItem extends vscode.TreeItem {
  public data: SwarmTreeItemData;

  constructor(
    label: string,
    collapsibleState: vscode.TreeItemCollapsibleState,
    data: SwarmTreeItemData,
  ) {
    super(label, collapsibleState);
    this.data = data;
  }
}

export class SwarmPipelineTreeProvider implements vscode.TreeDataProvider<SwarmTreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<SwarmTreeItem | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private client: SwarmClient;

  constructor(client: SwarmClient) {
    this.client = client;

    // Refresh tree on state changes
    client.on('state', () => this.refresh());
    client.on('agent-update', () => this.refresh());
    client.on('cost-update', () => this.refresh());
    client.on('connected', () => this.refresh());
    client.on('disconnected', () => this.refresh());
  }

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: SwarmTreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: SwarmTreeItem): SwarmTreeItem[] {
    if (!this.client.connected) {
      if (!element) {
        const item = new SwarmTreeItem(
          'Not connected',
          vscode.TreeItemCollapsibleState.None,
          { type: 'no-connection' },
        );
        item.iconPath = new vscode.ThemeIcon('plug');
        item.command = {
          command: 'swarm.connect',
          title: 'Connect to Swarm',
        };
        item.tooltip = 'Click to connect to the Swarm server';
        return [item];
      }
      return [];
    }

    const state = this.client.state;
    if (!state) {
      if (!element) {
        const item = new SwarmTreeItem(
          'Waiting for state...',
          vscode.TreeItemCollapsibleState.None,
          { type: 'no-stages' },
        );
        item.iconPath = new vscode.ThemeIcon('loading~spin');
        return [item];
      }
      return [];
    }

    // Root level: stages + cost summary
    if (!element) {
      return this.getRootItems(state);
    }

    // Children of a stage: agents for that stage
    if (element.data.type === 'stage' && element.data.stageName) {
      return this.getStageAgents(state, element.data.stageName);
    }

    return [];
  }

  private getRootItems(state: PipelineState): SwarmTreeItem[] {
    const items: SwarmTreeItem[] = [];

    // Pipeline stages
    for (const stageName of STAGE_ORDER) {
      const stageState = state.stages[stageName];
      if (!stageState) { continue; }

      const agentsForStage = this.getAgentsForStage(state, stageName);
      const hasChildren = agentsForStage.length > 0;
      const collapsible = hasChildren
        ? vscode.TreeItemCollapsibleState.Expanded
        : vscode.TreeItemCollapsibleState.None;

      const label = STAGE_LABELS[stageName] || stageName;
      const item = new SwarmTreeItem(label, collapsible, {
        type: 'stage',
        stageName,
        stageState,
      });

      item.iconPath = stageStatusIcon(stageState.status);
      item.description = stageState.status;
      item.tooltip = `${label} stage: ${stageState.status}`;
      item.contextValue = 'stage';

      if (stageState.artifact) {
        item.tooltip += `\nArtifact: ${stageState.artifact}`;
      }

      items.push(item);
    }

    // Cost summary
    const costItem = new SwarmTreeItem(
      `Total Cost: ${formatCost(state.totalCost)}`,
      vscode.TreeItemCollapsibleState.None,
      { type: 'cost', costInfo: state.totalCost },
    );
    costItem.iconPath = new vscode.ThemeIcon('credit-card');
    costItem.description = `${state.totalCost.inputTokens + state.totalCost.outputTokens} tokens`;
    costItem.tooltip = [
      `Total: ${formatCost(state.totalCost)}`,
      `Input tokens: ${state.totalCost.inputTokens.toLocaleString()}`,
      `Output tokens: ${state.totalCost.outputTokens.toLocaleString()}`,
      `Cache read: ${state.totalCost.cacheReadTokens.toLocaleString()}`,
      `Cache write: ${state.totalCost.cacheWriteTokens.toLocaleString()}`,
      `Duration: ${formatDuration(state.totalCost.durationMs)}`,
    ].join('\n');
    items.push(costItem);

    // MayDay status if active
    if (state.mayday?.active) {
      const md = state.mayday;
      const maydayItem = new SwarmTreeItem(
        `MayDay: ${md.currentStage}`,
        vscode.TreeItemCollapsibleState.None,
        { type: 'no-stages' },
      );
      maydayItem.iconPath = new vscode.ThemeIcon('flame');
      maydayItem.description = `fix ${md.fixIteration}/${md.maxFixIterations}`;
      maydayItem.tooltip = `Feature: ${md.featureRequest}\nStage: ${md.currentStage}\nFix iteration: ${md.fixIteration}/${md.maxFixIterations}`;
      items.push(maydayItem);
    }

    return items;
  }

  private getAgentsForStage(state: PipelineState, stageName: StageName): Agent[] {
    const stageState = state.stages[stageName];
    if (!stageState) { return []; }

    // Match agents by their ID being in stage's agentIds
    const agentIds = new Set(stageState.agentIds);
    const matched = state.agents.filter(a => agentIds.has(a.id));

    // Also match by persona if agentIds is empty but agents exist
    if (matched.length === 0) {
      const persona = PERSONA_FOR_STAGE[stageName];
      if (persona) {
        return state.agents.filter(a => a.persona === persona);
      }
    }

    return matched;
  }

  private getStageAgents(state: PipelineState, stageName: StageName): SwarmTreeItem[] {
    const agents = this.getAgentsForStage(state, stageName);

    return agents.map(agent => {
      const item = new SwarmTreeItem(
        agent.name,
        vscode.TreeItemCollapsibleState.None,
        { type: 'agent', agent },
      );

      item.iconPath = agentStatusIcon(agent.status);
      item.description = `${agent.model} — ${formatCost(agent.cost)}`;
      item.tooltip = [
        `Name: ${agent.name}`,
        `Persona: ${agent.persona}`,
        `Model: ${agent.model}`,
        `Status: ${agent.status}`,
        `Cost: ${formatCost(agent.cost)}`,
        `Duration: ${formatDuration(agent.cost.durationMs)}`,
        agent.error ? `Error: ${agent.error}` : '',
      ].filter(Boolean).join('\n');

      // Context value for menus (kill, show output)
      item.contextValue = agent.status === 'running' ? 'runningAgent' : 'agent';

      // Click to show output
      item.command = {
        command: 'swarm.showAgentOutput',
        title: 'Show Agent Output',
        arguments: [agent.id],
      };

      return item;
    });
  }
}
