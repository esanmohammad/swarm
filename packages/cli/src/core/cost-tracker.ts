import { EventEmitter } from 'node:events';
import type { CostInfo } from '../types.js';
import { emptyCost, addCosts } from '../types.js';

export class CostTracker extends EventEmitter {
  private costs = new Map<string, CostInfo>();
  private budgetUsd: number | null = null;

  setBudget(usd: number | null): void {
    this.budgetUsd = usd;
  }

  isOverBudget(): boolean {
    if (this.budgetUsd === null) return false;
    return this.getTotal().totalUsd >= this.budgetUsd;
  }

  getBudget(): number | null {
    return this.budgetUsd;
  }

  record(agentId: string, cost: CostInfo): void {
    this.costs.set(agentId, cost);
    const total = this.getTotal();
    this.emit('cost-update', total);
    if (this.budgetUsd !== null && total.totalUsd >= this.budgetUsd) {
      this.emit('budget-exceeded', total);
    }
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
