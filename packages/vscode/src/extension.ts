import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { SwarmClient } from './swarm-client';
import { OutputPanelManager } from './output-panel';
import { SwarmPipelineTreeProvider } from './tree-view';
import { registerCommands } from './commands';
import type { PipelineState, Agent } from './types';

let client: SwarmClient;
let outputPanels: OutputPanelManager;
let statusBarItem: vscode.StatusBarItem;
let treeProvider: SwarmPipelineTreeProvider;

export function activate(context: vscode.ExtensionContext): void {
  client = new SwarmClient();
  outputPanels = new OutputPanelManager();

  // Tree view provider
  treeProvider = new SwarmPipelineTreeProvider(client);
  const treeView = vscode.window.createTreeView('swarmPipeline', {
    treeDataProvider: treeProvider,
    showCollapseAll: true,
  });
  context.subscriptions.push(treeView);

  // Status bar item
  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);
  statusBarItem.command = 'swarm.connect';
  updateStatusBar('offline');
  statusBarItem.show();
  context.subscriptions.push(statusBarItem);

  // Register commands (including new ones)
  registerCommands(context, client, outputPanels, treeProvider);

  // Wire up client events
  client.on('connected', () => {
    updateStatusBar('idle');
    vscode.window.showInformationMessage('Swarm: Connected');
    vscode.commands.executeCommand('setContext', 'swarm.connected', true);
  });

  client.on('disconnected', () => {
    updateStatusBar('offline');
    vscode.commands.executeCommand('setContext', 'swarm.connected', false);
  });

  client.on('state', (state: PipelineState) => {
    const running = state.agents.filter(a => a.status === 'running').length;
    updateStatusBar(running > 0 ? `${running} running` : 'idle');
    vscode.commands.executeCommand('setContext', 'swarm.hasRunningAgents', running > 0);
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
      vscode.commands.executeCommand('setContext', 'swarm.hasRunningAgents', running > 0);
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

  // Auto-detect .swarm/ directory and read config
  const detectedPort = autoDetectSwarmConfig();
  const config = vscode.workspace.getConfiguration('swarm');
  const autoHost = config.get<string>('wsHost', 'localhost');
  const autoPort = detectedPort ?? config.get<number>('wsPort', 3847);

  // Auto-connect
  client.connect(autoHost, autoPort);

  // Watch for .swarm/ directory creation in workspace
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  if (workspaceFolder) {
    const swarmDirPattern = new vscode.RelativePattern(workspaceFolder, '.swarm/config.yaml');
    const watcher = vscode.workspace.createFileSystemWatcher(swarmDirPattern);
    watcher.onDidCreate(() => {
      const newPort = autoDetectSwarmConfig();
      if (newPort && newPort !== autoPort) {
        vscode.window.showInformationMessage(`Swarm: Detected .swarm/config.yaml — port ${newPort}`);
        client.connect(autoHost, newPort);
      }
    });
    watcher.onDidChange(() => {
      const newPort = autoDetectSwarmConfig();
      if (newPort) {
        client.connect(autoHost, newPort);
      }
    });
    context.subscriptions.push(watcher);
  }

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

/**
 * Auto-detect .swarm/config.yaml and extract wsPort.
 * Returns the port number or undefined if not found.
 */
function autoDetectSwarmConfig(): number | undefined {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  if (!workspaceFolder) { return undefined; }

  const configPath = path.join(workspaceFolder.uri.fsPath, '.swarm', 'config.yaml');

  try {
    if (!fs.existsSync(configPath)) { return undefined; }

    const content = fs.readFileSync(configPath, 'utf-8');

    // Simple YAML parsing for wsPort / port fields
    // Look for patterns like "wsPort: 3847" or "port: 3847"
    const wsPortMatch = content.match(/^\s*wsPort\s*:\s*(\d+)/m);
    if (wsPortMatch) {
      return parseInt(wsPortMatch[1], 10);
    }

    const portMatch = content.match(/^\s*port\s*:\s*(\d+)/m);
    if (portMatch) {
      return parseInt(portMatch[1], 10);
    }

    return undefined;
  } catch {
    return undefined;
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
