import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { AcquiredCapability, SpawnState } from '../types.js';

const STATE_FILE = 'spawn-state.json';

function emptyState(): SpawnState {
  return {
    capabilities: [],
    gaps: [],
    evaluations: [],
  };
}

export class CapabilitySpawner {
  private swarmDir: string;
  private state: SpawnState;

  constructor(swarmDir: string) {
    this.swarmDir = swarmDir;
    this.state = this.load();
  }

  // ── Persistence ──────────────────────────────────────────────

  private filePath(): string {
    return join(this.swarmDir, STATE_FILE);
  }

  private load(): SpawnState {
    const fp = this.filePath();
    if (!existsSync(fp)) return emptyState();
    try {
      return JSON.parse(readFileSync(fp, 'utf-8')) as SpawnState;
    } catch {
      return emptyState();
    }
  }

  private save(): void {
    if (!existsSync(this.swarmDir)) {
      mkdirSync(this.swarmDir, { recursive: true });
    }
    writeFileSync(this.filePath(), JSON.stringify(this.state, null, 2));
  }

  // ── Gap Detection ────────────────────────────────────────────

  detectGaps(): SpawnState['gaps'] {
    // Analyze recent pipeline failures and task rejections to find
    // domains where the current toolset is insufficient.
    // In production this would scan audit logs and pipeline history.

    const existingDomains = new Set(this.state.gaps.map(g => g.domain));
    const commonGaps = [
      'kubernetes deployment',
      'database migration',
      'infrastructure as code',
      'mobile testing',
      'performance profiling',
      'accessibility auditing',
      'i18n/l10n',
      'GraphQL schema management',
    ];

    // Add gaps for domains not already tracked
    for (const domain of commonGaps) {
      if (!existingDomains.has(domain)) {
        // Only add if we don't have an active capability for it
        const hasCapability = this.state.capabilities.some(
          c => c.name.toLowerCase().includes(domain.toLowerCase()) && c.status === 'active',
        );
        if (!hasCapability) {
          this.state.gaps.push({
            domain,
            failureCount: Math.floor(Math.random() * 5) + 1,
            lastFailed: Date.now() - Math.floor(Math.random() * 7 * 24 * 60 * 60 * 1000),
            attemptedAcquisitions: 0,
          });
        }
      }
    }

    this.save();
    return this.state.gaps;
  }

  // ── Capability Acquisition ───────────────────────────────────

  acquireCapability(domain: string): AcquiredCapability {
    // Check if already acquired
    const existing = this.state.capabilities.find(
      c => c.name.toLowerCase() === domain.toLowerCase() && c.status !== 'discarded',
    );
    if (existing) {
      return existing;
    }

    // Determine the best acquisition type based on domain
    const type = this.inferCapabilityType(domain);
    const source = this.inferSource(domain, type);

    const capability: AcquiredCapability = {
      id: randomUUID(),
      name: domain,
      type,
      source,
      effectiveness: 0,
      tasksUsed: 0,
      status: 'testing',
      acquiredAt: Date.now(),
    };

    this.state.capabilities.push(capability);

    // Update gap tracking
    const gap = this.state.gaps.find(g => g.domain.toLowerCase() === domain.toLowerCase());
    if (gap) {
      gap.attemptedAcquisitions++;
    }

    this.save();
    return capability;
  }

  // ── List Capabilities ────────────────────────────────────────

  listCapabilities(): AcquiredCapability[] {
    return this.state.capabilities;
  }

  // ── Evaluate ─────────────────────────────────────────────────

  evaluate(): SpawnState['evaluations'] {
    // Evaluate all capabilities in "testing" status.
    // In production this would run actual tasks and measure outcomes.
    const testingCapabilities = this.state.capabilities.filter(c => c.status === 'testing');

    for (const capability of testingCapabilities) {
      // Simulate evaluation over N tasks
      const tasksRun = Math.floor(Math.random() * 10) + 5;
      const successRate = Math.round((Math.random() * 0.4 + 0.5) * 100) / 100; // 50-90%

      let verdict: string;
      if (successRate >= 0.75) {
        verdict = 'promote';
        capability.status = 'active';
        capability.effectiveness = Math.round(successRate * 100);
      } else if (successRate >= 0.5) {
        verdict = 'continue-testing';
        capability.effectiveness = Math.round(successRate * 100);
      } else {
        verdict = 'discard';
        capability.status = 'discarded';
        capability.effectiveness = Math.round(successRate * 100);
      }

      capability.tasksUsed += tasksRun;

      // Remove old evaluation for this capability
      this.state.evaluations = this.state.evaluations.filter(
        e => e.capabilityId !== capability.id,
      );

      this.state.evaluations.push({
        capabilityId: capability.id,
        tasksRun,
        successRate,
        verdict,
      });
    }

    this.save();
    return this.state.evaluations;
  }

  // ── State Access ─────────────────────────────────────────────

  getState(): SpawnState {
    return this.state;
  }

  // ── Private Helpers ──────────────────────────────────────────

  private inferCapabilityType(domain: string): AcquiredCapability['type'] {
    const lower = domain.toLowerCase();
    if (lower.includes('deploy') || lower.includes('kubernetes') || lower.includes('docker')) {
      return 'mcp-tool';
    }
    if (lower.includes('testing') || lower.includes('audit') || lower.includes('profil')) {
      return 'plugin';
    }
    return 'custom-persona';
  }

  private inferSource(domain: string, type: AcquiredCapability['type']): string {
    switch (type) {
      case 'mcp-tool':
        return `mcp-registry:${domain.replace(/\s+/g, '-').toLowerCase()}`;
      case 'plugin':
        return `npm:@swarm-plugin/${domain.replace(/\s+/g, '-').toLowerCase()}`;
      case 'custom-persona':
        return `.swarm/personas/${domain.replace(/\s+/g, '-').toLowerCase()}.yaml`;
    }
  }
}
