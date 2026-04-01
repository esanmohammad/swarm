import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import type { SwarmClient } from './swarm-client';
import type { OutputPanelManager } from './output-panel';
import type { SwarmPipelineTreeProvider, SwarmTreeItem } from './tree-view';
import { ARTIFACT_FILES } from './types';
import type { Persona, TechStack } from './types';

type StagePick = 'analyze' | 'architect' | 'plan' | 'build' | 'test';

export function registerCommands(
  context: vscode.ExtensionContext,
  client: SwarmClient,
  outputPanels: OutputPanelManager,
  treeProvider: SwarmPipelineTreeProvider,
): void {

  // swarm.connect — prompt for port, connect to WS server
  context.subscriptions.push(
    vscode.commands.registerCommand('swarm.connect', async () => {
      const config = vscode.workspace.getConfiguration('swarm');
      const defaultHost = config.get<string>('wsHost', 'localhost');
      const defaultPort = config.get<number>('wsPort', 3847);

      const portStr = await vscode.window.showInputBox({
        prompt: 'Swarm WebSocket port',
        value: String(defaultPort),
        validateInput: (v) => {
          const n = parseInt(v, 10);
          return (n > 0 && n < 65536) ? null : 'Enter a valid port (1-65535)';
        },
      });

      if (!portStr) { return; }

      const port = parseInt(portStr, 10);
      client.connect(defaultHost, port);
      vscode.window.showInformationMessage(`Swarm: Connecting to ${defaultHost}:${port}...`);
    }),
  );

  // swarm.runStage — pick a pipeline stage and send run-stage command
  context.subscriptions.push(
    vscode.commands.registerCommand('swarm.runStage', async () => {
      if (!client.connected) {
        vscode.window.showWarningMessage('Swarm: Not connected. Run "Swarm: Connect to Server" first.');
        return;
      }

      const stages: Array<{ label: string; value: StagePick; description: string }> = [
        { label: 'Analyze', value: 'analyze', description: 'Run analyst — produces REQUIREMENTS.md' },
        { label: 'Architect', value: 'architect', description: 'Run architect — produces SPEC.md' },
        { label: 'Plan', value: 'plan', description: 'Run lead — produces TASKS.md' },
        { label: 'Build', value: 'build', description: 'Run engineers — implements code' },
        { label: 'Test', value: 'test', description: 'Run tester — produces TESTPLAN.md' },
      ];

      const pick = await vscode.window.showQuickPick(stages, {
        placeHolder: 'Select pipeline stage to run',
      });

      if (!pick) { return; }

      let prompt: string | undefined;
      if (pick.value === 'analyze') {
        prompt = await vscode.window.showInputBox({
          prompt: 'Feature request / description for analysis',
          placeHolder: 'Describe the feature to analyze...',
        });
        if (!prompt) { return; }
      }

      client.sendCommand({ action: 'run-stage', stage: pick.value, prompt });
      vscode.window.showInformationMessage(`Swarm: Started "${pick.label}" stage`);
    }),
  );

  // swarm.runMayday — input feature request, send run-mayday command
  context.subscriptions.push(
    vscode.commands.registerCommand('swarm.runMayday', async () => {
      if (!client.connected) {
        vscode.window.showWarningMessage('Swarm: Not connected. Run "Swarm: Connect to Server" first.');
        return;
      }

      const prompt = await vscode.window.showInputBox({
        prompt: 'MayDay feature request',
        placeHolder: 'Describe the feature for end-to-end autonomous pipeline...',
      });

      if (!prompt) { return; }

      client.sendCommand({ action: 'run-mayday', prompt });
      vscode.window.showInformationMessage('Swarm: MayDay pipeline started');
    }),
  );

  // swarm.run — simplified alias for runMayday
  context.subscriptions.push(
    vscode.commands.registerCommand('swarm.run', async () => {
      if (!client.connected) {
        vscode.window.showWarningMessage('Swarm: Not connected. Run "Swarm: Connect to Server" first.');
        return;
      }

      const prompt = await vscode.window.showInputBox({
        prompt: 'What do you want to build?',
        placeHolder: 'Describe the feature...',
      });

      if (!prompt) { return; }

      client.sendCommand({ action: 'run-mayday', prompt });
      vscode.window.showInformationMessage('Swarm: Pipeline started');
    }),
  );

  // swarm.spawnAgent — spawn an individual agent with persona and prompt
  context.subscriptions.push(
    vscode.commands.registerCommand('swarm.spawnAgent', async () => {
      if (!client.connected) {
        vscode.window.showWarningMessage('Swarm: Not connected. Run "Swarm: Connect to Server" first.');
        return;
      }

      const personas: Array<{ label: string; value: Persona; description: string }> = [
        { label: 'Analyst', value: 'analyst', description: 'Analyze requirements → REQUIREMENTS.md' },
        { label: 'Architect', value: 'architect', description: 'Design architecture → SPEC.md' },
        { label: 'Lead', value: 'lead', description: 'Break down tasks → TASKS.md' },
        { label: 'Engineer', value: 'engineer', description: 'Implement code' },
        { label: 'Tester', value: 'tester', description: 'Create test plan → TESTPLAN.md' },
      ];

      const personaPick = await vscode.window.showQuickPick(personas, {
        placeHolder: 'Select agent persona',
      });
      if (!personaPick) { return; }

      const name = await vscode.window.showInputBox({
        prompt: 'Agent name',
        value: personaPick.value,
        placeHolder: 'e.g. my-analyst',
      });
      if (!name) { return; }

      const prompt = await vscode.window.showInputBox({
        prompt: 'Task prompt for the agent',
        placeHolder: 'Describe what this agent should do...',
      });
      if (!prompt) { return; }

      const stacks: Array<{ label: string; value: TechStack }> = [
        { label: 'React', value: 'react' },
        { label: 'Node', value: 'node' },
        { label: 'Go', value: 'go' },
        { label: 'Python', value: 'python' },
        { label: 'Rust', value: 'rust' },
        { label: 'Swift', value: 'swift' },
      ];

      const stackPick = await vscode.window.showQuickPick(stacks, {
        placeHolder: 'Select tech stack',
      });
      if (!stackPick) { return; }

      client.sendCommand({
        action: 'spawn',
        name,
        persona: personaPick.value,
        stack: stackPick.value,
        prompt,
        permissionMode: 'auto',
      });
      vscode.window.showInformationMessage(`Swarm: Spawning agent "${name}" (${personaPick.label})`);
    }),
  );

  // swarm.showOutput — pick an agent, show its output channel
  context.subscriptions.push(
    vscode.commands.registerCommand('swarm.showOutput', async () => {
      const state = client.state;
      if (!state || state.agents.length === 0) {
        vscode.window.showInformationMessage('Swarm: No agents available');
        return;
      }

      const items = state.agents.map(a => ({
        label: a.name,
        description: `${a.persona} — ${a.status}`,
        agentId: a.id,
      }));

      const pick = await vscode.window.showQuickPick(items, {
        placeHolder: 'Select agent to view output',
      });

      if (!pick) { return; }

      if (outputPanels.has(pick.agentId)) {
        outputPanels.show(pick.agentId);
      } else {
        // Find agent and show whatever output exists
        const agent = state.agents.find(a => a.id === pick.agentId);
        if (agent && agent.output) {
          outputPanels.append(agent.id, agent.name, agent.output);
        } else {
          vscode.window.showInformationMessage(`Swarm: No output yet for "${pick.label}"`);
        }
      }
    }),
  );

  // swarm.showAgentOutput — show output for a specific agent (called from tree view click)
  context.subscriptions.push(
    vscode.commands.registerCommand('swarm.showAgentOutput', (agentId: string) => {
      const state = client.state;
      if (!state) { return; }

      const agent = state.agents.find(a => a.id === agentId);
      if (!agent) { return; }

      if (outputPanels.has(agentId)) {
        outputPanels.show(agentId);
      } else if (agent.output) {
        outputPanels.append(agent.id, agent.name, agent.output);
      } else {
        // Request logs from server
        client.sendCommand({ action: 'get-state' });
        vscode.window.showInformationMessage(`Swarm: No output yet for "${agent.name}"`);
      }
    }),
  );

  // swarm.killAgent — kill a running agent (from tree view context menu or command palette)
  context.subscriptions.push(
    vscode.commands.registerCommand('swarm.killAgent', async (treeItem?: SwarmTreeItem) => {
      if (!client.connected) {
        vscode.window.showWarningMessage('Swarm: Not connected.');
        return;
      }

      // If called from tree view context menu with an agent item
      if (treeItem?.data?.type === 'agent' && treeItem.data.agent) {
        const agent = treeItem.data.agent;
        client.sendCommand({ action: 'kill', agentId: agent.id });
        vscode.window.showInformationMessage(`Swarm: Killing agent "${agent.name}"`);
        return;
      }

      // Otherwise show quick pick of running agents
      const runningAgents = client.getRunningAgents();
      if (runningAgents.length === 0) {
        vscode.window.showInformationMessage('Swarm: No running agents to kill');
        return;
      }

      const items = runningAgents.map(a => ({
        label: a.name,
        description: `${a.persona} — ${a.model}`,
        agentId: a.id,
      }));

      const pick = await vscode.window.showQuickPick(items, {
        placeHolder: 'Select agent to kill',
      });

      if (!pick) { return; }

      client.sendCommand({ action: 'kill', agentId: pick.agentId });
      vscode.window.showInformationMessage(`Swarm: Killing agent "${pick.label}"`);
    }),
  );

  // swarm.refreshTree — refresh the tree view
  context.subscriptions.push(
    vscode.commands.registerCommand('swarm.refreshTree', () => {
      treeProvider.refresh();
      if (client.connected) {
        client.sendCommand({ action: 'get-state' });
      }
    }),
  );

  // swarm.showDiff — show diff for a generated artifact
  context.subscriptions.push(
    vscode.commands.registerCommand('swarm.showDiff', async () => {
      const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
      if (!workspaceFolder) {
        vscode.window.showWarningMessage('Swarm: No workspace folder open');
        return;
      }

      const rootPath = workspaceFolder.uri.fsPath;

      // Find which artifact files exist
      const available: Array<{ label: string; file: string; description: string }> = [];
      for (const [fileName, stageName] of Object.entries(ARTIFACT_FILES)) {
        const filePath = path.join(rootPath, fileName);
        if (fs.existsSync(filePath)) {
          available.push({
            label: fileName,
            file: filePath,
            description: `${stageName} stage artifact`,
          });
        }
      }

      // Also check TESTPLAN.md
      const testPlanPath = path.join(rootPath, 'TESTPLAN.md');
      if (fs.existsSync(testPlanPath)) {
        available.push({
          label: 'TESTPLAN.md',
          file: testPlanPath,
          description: 'test stage artifact',
        });
      }

      if (available.length === 0) {
        vscode.window.showInformationMessage('Swarm: No artifact files found (REQUIREMENTS.md, SPEC.md, TASKS.md, TESTPLAN.md)');
        return;
      }

      const pick = await vscode.window.showQuickPick(available, {
        placeHolder: 'Select artifact to diff',
      });

      if (!pick) { return; }

      // Try to find git version for comparison
      const fileUri = vscode.Uri.file(pick.file);

      try {
        // Use git SCM to get the HEAD version
        const gitUri = vscode.Uri.parse(`git:${pick.file}?HEAD`);
        await vscode.commands.executeCommand(
          'vscode.diff',
          gitUri,
          fileUri,
          `${pick.label}: HEAD vs Working Copy`,
        );
      } catch {
        // If git diff fails, show empty vs current as new file
        const emptyUri = vscode.Uri.parse('untitled:empty');
        try {
          await vscode.commands.executeCommand(
            'vscode.diff',
            emptyUri,
            fileUri,
            `${pick.label}: New Artifact`,
          );
        } catch {
          // Fall back to just opening the file
          await vscode.commands.executeCommand('vscode.open', fileUri);
        }
      }
    }),
  );
}
