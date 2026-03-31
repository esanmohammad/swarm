import * as vscode from 'vscode';
import type { SwarmClient } from './swarm-client';
import type { OutputPanelManager } from './output-panel';

type StagePick = 'analyze' | 'architect' | 'plan' | 'build' | 'test';

export function registerCommands(
  context: vscode.ExtensionContext,
  client: SwarmClient,
  outputPanels: OutputPanelManager,
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
}
