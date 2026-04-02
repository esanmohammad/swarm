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

  private warnedAt80 = false;
  private warnedAt90 = false;

  record(agentId: string, cost: CostInfo): void {
    this.costs.set(agentId, cost);
    const total = this.getTotal();
    this.emit('cost-update', total);

    if (this.budgetUsd !== null) {
      const ratio = total.totalUsd / this.budgetUsd;
      if (ratio >= 1.0) {
        this.emit('budget-exceeded', total);
      } else if (ratio >= 0.9 && !this.warnedAt90) {
        this.warnedAt90 = true;
        this.emit('budget-warning', { level: 90, total, remaining: this.budgetUsd - total.totalUsd });
      } else if (ratio >= 0.8 && !this.warnedAt80) {
        this.warnedAt80 = true;
        this.emit('budget-warning', { level: 80, total, remaining: this.budgetUsd - total.totalUsd });
      }
    }
  }

  /** Get remaining budget in USD, or null if no budget set */
  getRemaining(): number | null {
    if (this.budgetUsd === null) return null;
    return Math.max(0, this.budgetUsd - this.getTotal().totalUsd);
  }

  /** Get budget usage ratio (0-1), or null if no budget */
  getUsageRatio(): number | null {
    if (this.budgetUsd === null) return null;
    return this.getTotal().totalUsd / this.budgetUsd;
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
