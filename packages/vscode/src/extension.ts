import * as vscode from 'vscode';
import { SwarmClient } from './swarm-client';
import { OutputPanelManager } from './output-panel';
import { registerCommands } from './commands';
import type { PipelineState, Agent } from './types';

let client: SwarmClient;
let outputPanels: OutputPanelManager;
let statusBarItem: vscode.StatusBarItem;

export function activate(context: vscode.ExtensionContext): void {
  client = new SwarmClient();
  outputPanels = new OutputPanelManager();

  // Status bar item
  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);
  statusBarItem.command = 'swarm.connect';
  updateStatusBar('offline');
  statusBarItem.show();
  context.subscriptions.push(statusBarItem);

  // Register commands
  registerCommands(context, client, outputPanels);

  // Wire up client events
  client.on('connected', () => {
    updateStatusBar('idle');
    vscode.window.showInformationMessage('Swarm: Connected');
  });

  client.on('disconnected', () => {
    updateStatusBar('offline');
  });

  client.on('state', (state: PipelineState) => {
    const running = state.agents.filter(a => a.status === 'running').length;
    updateStatusBar(running > 0 ? `${running} running` : 'idle');
  });

  client.on('agent-update', (agent: Agent) => {
    if (agent.status === 'error' && agent.error) {
      vscode.window.showErrorMessage(`Swarm: Agent "${agent.name}" error — ${agent.error}`);
    }
    if (agent.status === 'done') {
      vscode.window.showInformationMessage(`Swarm: Agent "${agent.name}" finished ($${agent.cost.totalUsd.toFixed(2)})`);
    }

    // Update status bar from latest state
    const state = client.state;
    if (state) {
      const running = state.agents.filter(a => a.status === 'running').length;
      updateStatusBar(running > 0 ? `${running} running` : 'idle');
    }
  });

  client.on('agent-output', (data: { agentId: string; chunk: string }) => {
    const state = client.state;
    const agent = state?.agents.find(a => a.id === data.agentId);
    const name = agent?.name ?? data.agentId.slice(0, 8);
    outputPanels.append(data.agentId, name, data.chunk);
  });

  client.on('agent-logs', (data: { agentId: string; output: string }) => {
    const state = client.state;
    const agent = state?.agents.find(a => a.id === data.agentId);
    const name = agent?.name ?? data.agentId.slice(0, 8);
    if (data.output) {
      outputPanels.append(data.agentId, name, data.output);
    }
  });

  // Auto-connect on activation using settings
  const config = vscode.workspace.getConfiguration('swarm');
  const autoHost = config.get<string>('wsHost', 'localhost');
  const autoPort = config.get<number>('wsPort', 3847);
  client.connect(autoHost, autoPort);

  // Cleanup
  context.subscriptions.push({
    dispose: () => {
      outputPanels.dispose();
    },
  });
}

export function deactivate(): void {
  if (client) {
    client.disconnect();
  }
  if (outputPanels) {
    outputPanels.dispose();
  }
}

function updateStatusBar(status: 'offline' | 'idle' | string): void {
  if (status === 'offline') {
    statusBarItem.text = '$(zap) SWARM: offline';
    statusBarItem.tooltip = 'Click to connect to Swarm server';
    statusBarItem.backgroundColor = undefined;
  } else if (status === 'idle') {
    statusBarItem.text = '$(zap) SWARM: idle';
    statusBarItem.tooltip = 'Connected to Swarm — no agents running';
    statusBarItem.backgroundColor = undefined;
  } else {
    statusBarItem.text = `$(zap) SWARM: ${status}`;
    statusBarItem.tooltip = `Swarm pipeline active`;
    statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
  }
}
