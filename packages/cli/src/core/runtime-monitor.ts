import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';

export interface RuntimeEvent {
  type: 'filesystem' | 'network' | 'env-access' | 'subprocess' | 'install-script';
  detail: string;
  timestamp: number;
  severity: 'info' | 'warning' | 'critical';
  source: string;
}

export interface RuntimeBaseline {
  expectedFilesystem: string[];
  expectedNetwork: string[];
  expectedSubprocesses: string[];
  createdAt: number;
}

export class RuntimeMonitor {
  private events: RuntimeEvent[] = [];
  private baseline: RuntimeBaseline | null = null;
  private eventsFile: string;
  private baselineFile: string;

  constructor(private swarmDir: string) {
    this.eventsFile = join(swarmDir, 'runtime-events.jsonl');
    this.baselineFile = join(swarmDir, 'runtime-baseline.json');
    if (!existsSync(swarmDir)) {
      mkdirSync(swarmDir, { recursive: true });
    }
    this.loadBaseline();
    this.loadEvents();
  }

  /** Record a runtime event */
  recordEvent(event: Omit<RuntimeEvent, 'timestamp'>): void {
    const fullEvent: RuntimeEvent = { ...event, timestamp: Date.now() };
    this.events.push(fullEvent);
    // Append to JSONL log
    try {
      appendFileSync(this.eventsFile, JSON.stringify(fullEvent) + '\n', 'utf-8');
    } catch {
      // If we can't write, just keep in-memory
    }
  }

  /** Check event against baseline — returns true if anomalous */
  checkAnomaly(event: RuntimeEvent): boolean {
    if (!this.baseline) return false;

    switch (event.type) {
      case 'filesystem':
        return !this.baseline.expectedFilesystem.some(
          (pattern) => event.detail.includes(pattern) || this.matchGlob(event.detail, pattern)
        );
      case 'network':
        return !this.baseline.expectedNetwork.some(
          (host) => event.detail.includes(host)
        );
      case 'subprocess':
        return !this.baseline.expectedSubprocesses.some(
          (cmd) => event.detail.includes(cmd)
        );
      case 'install-script':
        // Install scripts are always flagged as anomalous unless in baseline
        return !this.baseline.expectedSubprocesses.some(
          (cmd) => event.detail.includes(cmd)
        );
      case 'env-access':
        // Environment access is always potentially anomalous
        return true;
      default:
        return false;
    }
  }

  /** Save current events as baseline */
  saveBaseline(): void {
    const filesystem = new Set<string>();
    const network = new Set<string>();
    const subprocesses = new Set<string>();

    for (const event of this.events) {
      switch (event.type) {
        case 'filesystem':
          filesystem.add(event.detail);
          break;
        case 'network':
          network.add(event.detail);
          break;
        case 'subprocess':
        case 'install-script':
          subprocesses.add(event.detail);
          break;
      }
    }

    this.baseline = {
      expectedFilesystem: [...filesystem],
      expectedNetwork: [...network],
      expectedSubprocesses: [...subprocesses],
      createdAt: Date.now(),
    };

    writeFileSync(this.baselineFile, JSON.stringify(this.baseline, null, 2), 'utf-8');
  }

  /** Load baseline from disk */
  private loadBaseline(): void {
    try {
      if (existsSync(this.baselineFile)) {
        const raw = readFileSync(this.baselineFile, 'utf-8');
        this.baseline = JSON.parse(raw) as RuntimeBaseline;
      }
    } catch {
      this.baseline = null;
    }
  }

  /** Load existing events from disk */
  private loadEvents(): void {
    try {
      if (existsSync(this.eventsFile)) {
        const raw = readFileSync(this.eventsFile, 'utf-8').trim();
        if (raw) {
          this.events = raw.split('\n').map((line) => JSON.parse(line) as RuntimeEvent);
        }
      }
    } catch {
      this.events = [];
    }
  }

  /** Get all events, optionally filtered by time */
  getEvents(since?: number): RuntimeEvent[] {
    if (since !== undefined) {
      return this.events.filter((e) => e.timestamp >= since);
    }
    return [...this.events];
  }

  /** Get anomalies (events not in baseline) */
  getAnomalies(): RuntimeEvent[] {
    if (!this.baseline) return [];
    return this.events.filter((e) => this.checkAnomaly(e));
  }

  /** Monitor npm install for suspicious behavior */
  monitorInstall(packageName: string): RuntimeEvent[] {
    const installEvents: RuntimeEvent[] = [];

    try {
      // Run npm install --dry-run --json to inspect what would happen
      const result = execSync(`npm install ${packageName} --dry-run --json 2>&1`, {
        encoding: 'utf-8',
        timeout: 30000,
        cwd: process.cwd(),
      });

      let parsed: Record<string, unknown> | null = null;
      try {
        parsed = JSON.parse(result);
      } catch {
        // Non-JSON output, still record
      }

      if (parsed) {
        // Check for install scripts
        const added = (parsed.added as Array<Record<string, unknown>>) || [];
        for (const pkg of added) {
          const scripts = pkg.scripts as Record<string, string> | undefined;
          if (scripts) {
            for (const [hook, cmd] of Object.entries(scripts)) {
              if (['preinstall', 'postinstall', 'install', 'prepare'].includes(hook)) {
                const event: Omit<RuntimeEvent, 'timestamp'> = {
                  type: 'install-script',
                  detail: `${pkg.name}@${pkg.version}: ${hook} → ${cmd}`,
                  severity: 'warning',
                  source: `npm-install:${packageName}`,
                };
                this.recordEvent(event);
                installEvents.push({ ...event, timestamp: Date.now() });
              }
            }
          }
        }
      }

      // Also check for known suspicious patterns
      const suspiciousPatterns = [
        /curl\s+/i,
        /wget\s+/i,
        /eval\s*\(/,
        /child_process/,
        /exec\s*\(/,
        /\.env/,
        /process\.env/,
        /base64/i,
      ];

      for (const pattern of suspiciousPatterns) {
        if (pattern.test(result)) {
          const event: Omit<RuntimeEvent, 'timestamp'> = {
            type: 'install-script',
            detail: `Suspicious pattern detected in ${packageName}: ${pattern.source}`,
            severity: 'critical',
            source: `npm-install:${packageName}`,
          };
          this.recordEvent(event);
          installEvents.push({ ...event, timestamp: Date.now() });
        }
      }

      // Record successful dry-run as info
      if (installEvents.length === 0) {
        const event: Omit<RuntimeEvent, 'timestamp'> = {
          type: 'subprocess',
          detail: `npm install ${packageName} --dry-run completed (clean)`,
          severity: 'info',
          source: `npm-install:${packageName}`,
        };
        this.recordEvent(event);
        installEvents.push({ ...event, timestamp: Date.now() });
      }
    } catch (err) {
      const event: Omit<RuntimeEvent, 'timestamp'> = {
        type: 'subprocess',
        detail: `npm install ${packageName} --dry-run failed: ${err instanceof Error ? err.message : String(err)}`,
        severity: 'warning',
        source: `npm-install:${packageName}`,
      };
      this.recordEvent(event);
      installEvents.push({ ...event, timestamp: Date.now() });
    }

    return installEvents;
  }

  /** Clear events */
  clearEvents(): void {
    this.events = [];
    try {
      writeFileSync(this.eventsFile, '', 'utf-8');
    } catch {
      // Ignore write errors
    }
  }

  /** Generate summary report */
  getSummary(): {
    totalEvents: number;
    anomalies: number;
    byType: Record<string, number>;
    bySeverity: Record<string, number>;
  } {
    const byType: Record<string, number> = {};
    const bySeverity: Record<string, number> = {};

    for (const event of this.events) {
      byType[event.type] = (byType[event.type] || 0) + 1;
      bySeverity[event.severity] = (bySeverity[event.severity] || 0) + 1;
    }

    return {
      totalEvents: this.events.length,
      anomalies: this.getAnomalies().length,
      byType,
      bySeverity,
    };
  }

  /** Simple glob-like matching (supports * wildcards) */
  private matchGlob(value: string, pattern: string): boolean {
    const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
    return new RegExp(`^${escaped}$`).test(value);
  }
}
