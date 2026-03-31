import * as vscode from 'vscode';

/**
 * Manages VS Code OutputChannels for Swarm agents.
 * One channel per agent, identified by agent ID.
 */
export class OutputPanelManager {
  private channels = new Map<string, vscode.OutputChannel>();

  /**
   * Append a chunk of output to the agent's OutputChannel.
   * Creates the channel if it doesn't exist, and reveals it.
   */
  append(agentId: string, agentName: string, chunk: string): void {
    let channel = this.channels.get(agentId);
    if (!channel) {
      channel = vscode.window.createOutputChannel(`Swarm: ${agentName}`);
      this.channels.set(agentId, channel);
    }
    channel.append(chunk);
    channel.show(true); // preserveFocus = true
  }

  /**
   * Show an existing agent's output channel.
   */
  show(agentId: string): void {
    const channel = this.channels.get(agentId);
    if (channel) {
      channel.show(false);
    }
  }

  /**
   * Get all tracked agent IDs.
   */
  getAgentIds(): string[] {
    return Array.from(this.channels.keys());
  }

  /**
   * Check if an agent has an output channel.
   */
  has(agentId: string): boolean {
    return this.channels.has(agentId);
  }

  /**
   * Dispose all output channels.
   */
  dispose(): void {
    for (const channel of this.channels.values()) {
      channel.dispose();
    }
    this.channels.clear();
  }
}
