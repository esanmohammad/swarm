import { readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import { parse as parseYaml, stringify as toYaml } from 'yaml';
import type {
  ObservabilityConfig,
  ObservabilitySource,
  MetricDataPoint,
  DeployMarker,
  ObserveState,
} from '../types.js';

const DEFAULT_CONFIG: ObservabilityConfig = {
  sources: {},
  alerting: {
    sigma: 3,
    cooldown: 300,
    channels: [],
  },
};

export class ObservabilityManager {
  private configPath: string;
  private metricsDir: string;
  private metricsPath: string;
  private deploysPath: string;
  private config: ObservabilityConfig;

  constructor(swarmDir: string) {
    this.configPath = join(swarmDir, 'observability.yaml');
    this.metricsDir = join(swarmDir, 'observability');
    this.metricsPath = join(this.metricsDir, 'metrics.jsonl');
    this.deploysPath = join(this.metricsDir, 'deploys.json');
    this.config = this.loadConfig();
  }

  /** Load observability config from .swarm/observability.yaml */
  loadConfig(): ObservabilityConfig {
    if (!existsSync(this.configPath)) {
      return { ...DEFAULT_CONFIG, alerting: { ...DEFAULT_CONFIG.alerting, channels: [] } };
    }
    try {
      const raw = readFileSync(this.configPath, 'utf-8');
      const parsed = parseYaml(raw) as Partial<ObservabilityConfig>;
      return {
        sources: parsed.sources ?? {},
        alerting: {
          sigma: parsed.alerting?.sigma ?? DEFAULT_CONFIG.alerting.sigma,
          cooldown: parsed.alerting?.cooldown ?? DEFAULT_CONFIG.alerting.cooldown,
          channels: parsed.alerting?.channels ?? [],
        },
      };
    } catch {
      return { ...DEFAULT_CONFIG, alerting: { ...DEFAULT_CONFIG.alerting, channels: [] } };
    }
  }

  /** Save config to .swarm/observability.yaml */
  saveConfig(config: ObservabilityConfig): void {
    writeFileSync(this.configPath, toYaml(config));
    this.config = config;
  }

  /** Get the current config */
  getConfig(): ObservabilityConfig {
    return this.config;
  }

  /** Ensure the metrics directory exists */
  private ensureMetricsDir(): void {
    if (!existsSync(this.metricsDir)) {
      mkdirSync(this.metricsDir, { recursive: true });
    }
  }

  /** Get overall status for all configured sources */
  getStatus(): ObserveState {
    const sources = Object.entries(this.config.sources).map(([name, src]) => ({
      name,
      type: src.type,
      status: this.checkSourceStatus(name, src),
      metricCount: this.countMetricsForSource(name),
      lastSync: this.getLastSyncForSource(name),
    }));

    const metrics = this.getMetrics();
    const deploys = this.getDeployMarkers();

    return {
      sources,
      anomalies: [],
      predictions: [],
      deployMarkers: deploys,
      metricCount: metrics.length,
      lastUpdated: Date.now(),
    };
  }

  /** Check connectivity / status of a data source */
  private checkSourceStatus(name: string, source: ObservabilitySource): 'connected' | 'error' | 'pending' {
    // Check if API key env is set (if required)
    if (source.apiKeyEnv && !process.env[source.apiKeyEnv]) {
      return 'error';
    }

    // Check if we have any metrics from this source
    const count = this.countMetricsForSource(name);
    if (count > 0) {
      return 'connected';
    }

    // Source configured but no metrics yet
    return 'pending';
  }

  /** Count metrics from a given source */
  private countMetricsForSource(source: string): number {
    const metrics = this.getMetrics();
    return metrics.filter(m => m.source === source).length;
  }

  /** Get last sync timestamp for a source */
  private getLastSyncForSource(source: string): number {
    const metrics = this.getMetrics();
    const fromSource = metrics.filter(m => m.source === source);
    if (fromSource.length === 0) return 0;
    return Math.max(...fromSource.map(m => m.timestamp));
  }

  /** Ingest metric data points (append to JSONL file) */
  ingestMetrics(points: MetricDataPoint[]): number {
    this.ensureMetricsDir();
    const lines = points.map(p => JSON.stringify(p)).join('\n');
    if (lines.length > 0) {
      appendFileSync(this.metricsPath, lines + '\n');
    }
    return points.length;
  }

  /** Read all metrics from the JSONL store */
  getMetrics(filter?: { name?: string; source?: string; since?: number; until?: number }): MetricDataPoint[] {
    if (!existsSync(this.metricsPath)) return [];

    try {
      const raw = readFileSync(this.metricsPath, 'utf-8').trim();
      if (!raw) return [];

      const metrics: MetricDataPoint[] = raw
        .split('\n')
        .filter(line => line.trim())
        .map(line => {
          try {
            return JSON.parse(line) as MetricDataPoint;
          } catch {
            return null;
          }
        })
        .filter((m): m is MetricDataPoint => m !== null);

      // Apply filters
      return metrics.filter(m => {
        if (filter?.name && m.name !== filter.name) return false;
        if (filter?.source && m.source !== filter.source) return false;
        if (filter?.since && m.timestamp < filter.since) return false;
        if (filter?.until && m.timestamp > filter.until) return false;
        return true;
      });
    } catch {
      return [];
    }
  }

  /** Query metrics by natural language-style query string */
  queryMetrics(query: string): MetricDataPoint[] {
    const allMetrics = this.getMetrics();
    if (allMetrics.length === 0) return [];

    const q = query.toLowerCase();
    const tokens = q.split(/\s+/);

    // Time range parsing
    let since: number | undefined;
    if (q.includes('last hour') || q.includes('1h')) {
      since = Date.now() - 3600000;
    } else if (q.includes('last day') || q.includes('24h')) {
      since = Date.now() - 86400000;
    } else if (q.includes('last week') || q.includes('7d')) {
      since = Date.now() - 7 * 86400000;
    } else if (q.includes('last 30d') || q.includes('last month')) {
      since = Date.now() - 30 * 86400000;
    }

    // Filter by metric name keywords
    const metricKeywords = tokens.filter(t =>
      !['last', 'hour', 'day', 'week', 'month', '1h', '24h', '7d', '30d',
        'show', 'get', 'find', 'the', 'from', 'for', 'in', 'with', 'where',
        'metrics', 'metric', 'data'].includes(t)
    );

    return allMetrics.filter(m => {
      if (since && m.timestamp < since) return false;

      if (metricKeywords.length > 0) {
        const nameAndSource = `${m.name} ${m.source} ${Object.values(m.tags ?? {}).join(' ')}`.toLowerCase();
        return metricKeywords.some(kw => nameAndSource.includes(kw));
      }

      return true;
    });
  }

  /** Add a deploy marker from git info */
  addDeployMarker(sha?: string): DeployMarker {
    this.ensureMetricsDir();

    const resolvedSha = sha ?? this.getCurrentSha();
    const marker = this.parseGitCommit(resolvedSha);
    const markers = this.getDeployMarkers();
    markers.push(marker);

    // Keep last 100 deploy markers
    const trimmed = markers.slice(-100);
    writeFileSync(this.deploysPath, JSON.stringify(trimmed, null, 2));

    return marker;
  }

  /** Get all deploy markers */
  getDeployMarkers(): DeployMarker[] {
    if (!existsSync(this.deploysPath)) return [];
    try {
      return JSON.parse(readFileSync(this.deploysPath, 'utf-8')) as DeployMarker[];
    } catch {
      return [];
    }
  }

  /** Get deploy markers near a timestamp */
  getDeploysNear(timestamp: number, windowMs: number = 3600000): DeployMarker[] {
    return this.getDeployMarkers().filter(
      d => Math.abs(d.timestamp - timestamp) <= windowMs
    );
  }

  /** Get metrics around a deploy SHA */
  getMetricsAroundDeploy(sha: string, windowMs: number = 3600000): { before: MetricDataPoint[]; after: MetricDataPoint[] } {
    const deploys = this.getDeployMarkers();
    const deploy = deploys.find(d => d.sha.startsWith(sha));
    if (!deploy) return { before: [], after: [] };

    const allMetrics = this.getMetrics();
    const before = allMetrics.filter(
      m => m.timestamp >= deploy.timestamp - windowMs && m.timestamp < deploy.timestamp
    );
    const after = allMetrics.filter(
      m => m.timestamp >= deploy.timestamp && m.timestamp <= deploy.timestamp + windowMs
    );

    return { before, after };
  }

  /** Parse git log for recent deploys (tagged or conventional commit) */
  parseGitDeployHistory(count: number = 20): DeployMarker[] {
    try {
      // Look for deploy tags or "deploy" in commit messages
      const log = execSync(
        `git log --oneline --format="%H|%at|%an|%s" -n ${count * 3}`,
        { encoding: 'utf-8', timeout: 5000 }
      ).trim();

      if (!log) return [];

      const markers: DeployMarker[] = [];
      for (const line of log.split('\n')) {
        const [sha, timestampStr, author, message] = line.split('|');
        if (!sha) continue;

        // Match deploy-related commits
        const isDeployRelated = /deploy|release|v\d+\.\d+|bump version|production|hotfix/i.test(message);
        if (isDeployRelated) {
          const filesChanged = this.getChangedFiles(sha);
          markers.push({
            sha,
            timestamp: parseInt(timestampStr) * 1000,
            author,
            message,
            filesChanged,
          });
        }

        if (markers.length >= count) break;
      }

      return markers;
    } catch {
      return [];
    }
  }

  /** Get current HEAD SHA */
  private getCurrentSha(): string {
    try {
      return execSync('git rev-parse HEAD', { encoding: 'utf-8', timeout: 5000 }).trim();
    } catch {
      return 'unknown';
    }
  }

  /** Parse git commit info into a DeployMarker */
  private parseGitCommit(sha: string): DeployMarker {
    try {
      const info = execSync(
        `git log --format="%at|%an|%s" -n 1 ${sha}`,
        { encoding: 'utf-8', timeout: 5000 }
      ).trim();

      const [timestampStr, author, message] = info.split('|');
      const filesChanged = this.getChangedFiles(sha);

      return {
        sha,
        timestamp: parseInt(timestampStr) * 1000,
        author: author ?? 'unknown',
        message: message ?? '',
        filesChanged,
      };
    } catch {
      return {
        sha,
        timestamp: Date.now(),
        author: 'unknown',
        message: '',
        filesChanged: [],
      };
    }
  }

  /** Get files changed in a commit */
  private getChangedFiles(sha: string): string[] {
    try {
      const result = execSync(
        `git diff-tree --no-commit-id --name-only -r ${sha}`,
        { encoding: 'utf-8', timeout: 5000 }
      ).trim();
      return result ? result.split('\n') : [];
    } catch {
      return [];
    }
  }
}
