import { EventEmitter } from 'node:events';
import type { CostInfo } from '../types.js';
import { emptyCost, addCosts } from '../types.js';

export class CostTracker extends EventEmitter {
  private costs = new Map<string, CostInfo>();

  record(agentId: string, cost: CostInfo): void {
    this.costs.set(agentId, cost);
    this.emit('cost-update', this.getTotal());
  }

  getAgentCost(agentId: string): CostInfo {
    return this.costs.get(agentId) ?? emptyCost();
  }

  getTotal(): CostInfo {
    let total = emptyCost();
    for (const cost of this.costs.values()) {
      total = addCosts(total, cost);
    }
    return total;
  }

  formatCost(cost: CostInfo): string {
    return [
      `$${cost.totalUsd.toFixed(4)}`,
      `${cost.inputTokens.toLocaleString()} in`,
      `${cost.outputTokens.toLocaleString()} out`,
      `${(cost.durationMs / 1000).toFixed(1)}s`,
    ].join(' | ');
  }

  formatTotal(): string {
    const total = this.getTotal();
    return `Total: ${this.formatCost(total)} across ${this.costs.size} agent(s)`;
  }
}
