import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { SimulationScenario, SimulationResult, SimulationReport } from '../types.js';

/** Parsed metric line from observability JSONL */
interface MetricEntry {
  timestamp: number;
  name: string;
  value: number;
  tags?: Record<string, string>;
}

/** Resource usage prediction at a given scale factor */
interface ResourcePrediction {
  cpu: number;       // estimated vCPU cores
  memoryMb: number;  // estimated RSS in MB
  diskIoMbps: number;
  networkMbps: number;
  estimatedCost: number; // USD/hour estimate
}

/** Chaos failure model for a dependency */
interface DependencyFailure {
  dependency: string;
  failureMode: 'latency' | 'timeout' | 'error-rate' | 'full-outage';
  impact: 'none' | 'degraded' | 'partial-outage' | 'full-outage';
  recoveryTimeSec: number;
}

const METRICS_PATH = '.swarm/observability/metrics.jsonl';
const REPORT_PATH = '.swarm/simulation-reports.json';

export class Simulator {
  private cwd: string;
  private metrics: MetricEntry[] = [];
  private results: SimulationResult[] = [];
  private report: SimulationReport | null = null;

  constructor(cwd: string) {
    this.cwd = cwd;
    this.loadMetrics();
  }

  // ── Public API ──────────────────────────────────────────────

  /** Run a full simulation suite or a specific scenario */
  simulate(cwd?: string, scenario?: SimulationScenario): SimulationReport {
    const workDir = cwd ?? this.cwd;
    this.results = [];

    if (scenario) {
      this.results.push(this.runScenario(scenario, workDir));
    } else {
      // Default suite: traffic replay, 2x scale, and basic chaos
      this.results.push(this.runScenario(
        { name: 'traffic-replay-baseline', type: 'traffic-replay', config: {} }, workDir
      ));
      this.results.push(this.runScenario(
        { name: 'scale-2x', type: 'scale', config: { factor: 2 } }, workDir
      ));
      this.results.push(this.runScenario(
        { name: 'chaos-dependency-failure', type: 'chaos', config: { target: 'primary-db', mode: 'latency' } }, workDir
      ));
    }

    this.report = this.buildReport();
    this.persist();
    return this.report;
  }

  /** Estimate resource usage at Nx traffic */
  scaleTest(factor: number): SimulationResult {
    const scenario: SimulationScenario = {
      name: `scale-${factor}x`,
      type: 'scale',
      config: { factor },
    };
    const result = this.runScenario(scenario, this.cwd);
    this.results.push(result);
    this.report = this.buildReport();
    this.persist();
    return result;
  }

  /** Model dependency failures */
  chaosTest(scenario: string): SimulationResult {
    const sim: SimulationScenario = {
      name: `chaos-${scenario}`,
      type: 'chaos',
      config: { target: scenario, mode: 'full-outage' },
    };
    const result = this.runScenario(sim, this.cwd);
    this.results.push(result);
    this.report = this.buildReport();
    this.persist();
    return result;
  }

  /** Return the latest report */
  getReport(): SimulationReport | null {
    if (this.report) return this.report;
    return this.loadReport();
  }

  // ── Scenario execution ─────────────────────────────────────

  private runScenario(scenario: SimulationScenario, workDir: string): SimulationResult {
    const start = Date.now();

    switch (scenario.type) {
      case 'traffic-replay':
        return this.runTrafficReplay(scenario, workDir, start);
      case 'scale':
        return this.runScaleScenario(scenario, workDir, start);
      case 'chaos':
        return this.runChaosScenario(scenario, workDir, start);
      default:
        return {
          scenario: scenario.name,
          passed: false,
          metrics: [],
          issues: [{ severity: 'error', description: `Unknown scenario type: ${scenario.type}` }],
          duration: Date.now() - start,
        };
    }
  }

  // ── Traffic replay ──────────────────────────────────────────

  private runTrafficReplay(scenario: SimulationScenario, _workDir: string, start: number): SimulationResult {
    const pattern = this.analyzeTrafficPattern();
    const metrics: SimulationResult['metrics'] = [];
    const issues: SimulationResult['issues'] = [];

    // Analyze request rate from metrics
    const rps = pattern.avgRequestsPerSec;
    metrics.push({
      name: 'avg-rps',
      value: rps,
      threshold: 100,
      status: rps > 100 ? 'fail' : rps > 50 ? 'warn' : 'pass',
    });

    // Analyze p99 latency
    const p99 = pattern.p99LatencyMs;
    metrics.push({
      name: 'p99-latency-ms',
      value: p99,
      threshold: 500,
      status: p99 > 500 ? 'fail' : p99 > 200 ? 'warn' : 'pass',
    });

    // Analyze error rate
    const errorRate = pattern.errorRate;
    metrics.push({
      name: 'error-rate',
      value: errorRate,
      threshold: 0.01,
      status: errorRate > 0.01 ? 'fail' : errorRate > 0.005 ? 'warn' : 'pass',
    });

    if (p99 > 500) {
      issues.push({ severity: 'high', description: `P99 latency ${p99}ms exceeds 500ms threshold` });
    }
    if (errorRate > 0.01) {
      issues.push({ severity: 'high', description: `Error rate ${(errorRate * 100).toFixed(2)}% exceeds 1% threshold` });
    }

    const passed = metrics.every(m => m.status !== 'fail');
    return { scenario: scenario.name, passed, metrics, issues, duration: Date.now() - start };
  }

  // ── Scale simulation ────────────────────────────────────────

  private runScaleScenario(scenario: SimulationScenario, _workDir: string, start: number): SimulationResult {
    const factor = (scenario.config.factor as number) || 2;
    const prediction = this.predictResources(factor);
    const metrics: SimulationResult['metrics'] = [];
    const issues: SimulationResult['issues'] = [];

    metrics.push({
      name: 'estimated-cpu-cores',
      value: prediction.cpu,
      threshold: 16,
      status: prediction.cpu > 16 ? 'fail' : prediction.cpu > 8 ? 'warn' : 'pass',
    });

    metrics.push({
      name: 'estimated-memory-mb',
      value: prediction.memoryMb,
      threshold: 8192,
      status: prediction.memoryMb > 8192 ? 'fail' : prediction.memoryMb > 4096 ? 'warn' : 'pass',
    });

    metrics.push({
      name: 'estimated-disk-io-mbps',
      value: prediction.diskIoMbps,
      threshold: 500,
      status: prediction.diskIoMbps > 500 ? 'fail' : prediction.diskIoMbps > 250 ? 'warn' : 'pass',
    });

    metrics.push({
      name: 'estimated-network-mbps',
      value: prediction.networkMbps,
      threshold: 1000,
      status: prediction.networkMbps > 1000 ? 'fail' : prediction.networkMbps > 500 ? 'warn' : 'pass',
    });

    metrics.push({
      name: 'estimated-cost-usd-hr',
      value: prediction.estimatedCost,
      threshold: 50,
      status: prediction.estimatedCost > 50 ? 'fail' : prediction.estimatedCost > 25 ? 'warn' : 'pass',
    });

    if (prediction.cpu > 16) {
      issues.push({ severity: 'high', description: `At ${factor}x scale, estimated CPU (${prediction.cpu} cores) exceeds capacity` });
    }
    if (prediction.memoryMb > 8192) {
      issues.push({ severity: 'high', description: `At ${factor}x scale, estimated memory (${prediction.memoryMb}MB) exceeds capacity` });
    }

    const passed = metrics.every(m => m.status !== 'fail');
    return { scenario: scenario.name, passed, metrics, issues, duration: Date.now() - start };
  }

  // ── Chaos simulation ────────────────────────────────────────

  private runChaosScenario(scenario: SimulationScenario, _workDir: string, start: number): SimulationResult {
    const target = (scenario.config.target as string) || 'unknown';
    const mode = (scenario.config.mode as string) || 'latency';
    const failure = this.modelDependencyFailure(target, mode);
    const metrics: SimulationResult['metrics'] = [];
    const issues: SimulationResult['issues'] = [];

    const impactSeverity = { none: 0, degraded: 1, 'partial-outage': 2, 'full-outage': 3 };
    const impactScore = impactSeverity[failure.impact] ?? 0;

    metrics.push({
      name: 'impact-level',
      value: impactScore,
      threshold: 2,
      status: impactScore >= 3 ? 'fail' : impactScore >= 2 ? 'warn' : 'pass',
    });

    metrics.push({
      name: 'recovery-time-sec',
      value: failure.recoveryTimeSec,
      threshold: 60,
      status: failure.recoveryTimeSec > 60 ? 'fail' : failure.recoveryTimeSec > 30 ? 'warn' : 'pass',
    });

    if (failure.impact === 'full-outage') {
      issues.push({
        severity: 'critical',
        description: `${failure.dependency} ${failure.failureMode} causes full outage (recovery: ${failure.recoveryTimeSec}s)`,
      });
    } else if (failure.impact === 'partial-outage') {
      issues.push({
        severity: 'high',
        description: `${failure.dependency} ${failure.failureMode} causes partial outage`,
      });
    }

    const passed = metrics.every(m => m.status !== 'fail');
    return { scenario: scenario.name, passed, metrics, issues, duration: Date.now() - start };
  }

  // ── Traffic analysis ────────────────────────────────────────

  private analyzeTrafficPattern(): { avgRequestsPerSec: number; p99LatencyMs: number; errorRate: number; peakRps: number } {
    if (this.metrics.length === 0) {
      // No metrics available — return conservative defaults
      return { avgRequestsPerSec: 10, p99LatencyMs: 150, errorRate: 0.002, peakRps: 25 };
    }

    const rpsMetrics = this.metrics.filter(m => m.name === 'http.requests' || m.name === 'rps');
    const latencyMetrics = this.metrics.filter(m => m.name === 'http.latency_ms' || m.name === 'latency');
    const errorMetrics = this.metrics.filter(m => m.name === 'http.errors' || m.name === 'error_count');

    const avgRps = rpsMetrics.length > 0
      ? rpsMetrics.reduce((sum, m) => sum + m.value, 0) / rpsMetrics.length
      : 10;

    const peakRps = rpsMetrics.length > 0
      ? Math.max(...rpsMetrics.map(m => m.value))
      : 25;

    // Approximate p99 from sorted latency values
    const sortedLatency = latencyMetrics.map(m => m.value).sort((a, b) => a - b);
    const p99Index = Math.floor(sortedLatency.length * 0.99);
    const p99 = sortedLatency.length > 0 ? sortedLatency[Math.min(p99Index, sortedLatency.length - 1)] : 150;

    const totalErrors = errorMetrics.reduce((sum, m) => sum + m.value, 0);
    const totalRequests = rpsMetrics.reduce((sum, m) => sum + m.value, 0);
    const errorRate = totalRequests > 0 ? totalErrors / totalRequests : 0.002;

    return { avgRequestsPerSec: Math.round(avgRps * 100) / 100, p99LatencyMs: Math.round(p99), errorRate, peakRps };
  }

  // ── Resource prediction ─────────────────────────────────────

  private predictResources(factor: number): ResourcePrediction {
    const pattern = this.analyzeTrafficPattern();
    const baseRps = pattern.avgRequestsPerSec;
    const targetRps = baseRps * factor;

    // Heuristic: linear scaling with sub-linear memory growth
    const cpu = Math.round((targetRps / 50) * 100) / 100;    // ~50 rps per core
    const memoryMb = Math.round(512 + (targetRps * 8) * Math.pow(factor, 0.7));
    const diskIoMbps = Math.round(targetRps * 0.5 * 100) / 100;
    const networkMbps = Math.round(targetRps * 0.2 * 100) / 100;

    // Rough cost model: $0.05/core/hr + $0.005/GB/hr
    const estimatedCost = Math.round((cpu * 0.05 + (memoryMb / 1024) * 0.005) * 100) / 100;

    return { cpu, memoryMb, diskIoMbps, networkMbps, estimatedCost };
  }

  // ── Chaos modeling ──────────────────────────────────────────

  private modelDependencyFailure(target: string, mode: string): DependencyFailure {
    // Common dependency failure models
    const failureMode = mode as DependencyFailure['failureMode'] || 'latency';

    const impactMap: Record<string, Record<string, DependencyFailure['impact']>> = {
      'primary-db':    { latency: 'degraded', timeout: 'partial-outage', 'error-rate': 'partial-outage', 'full-outage': 'full-outage' },
      'cache':         { latency: 'degraded', timeout: 'degraded',       'error-rate': 'degraded',       'full-outage': 'degraded' },
      'queue':         { latency: 'degraded', timeout: 'partial-outage', 'error-rate': 'partial-outage', 'full-outage': 'partial-outage' },
      'auth-service':  { latency: 'degraded', timeout: 'partial-outage', 'error-rate': 'degraded',       'full-outage': 'full-outage' },
      'cdn':           { latency: 'degraded', timeout: 'degraded',       'error-rate': 'none',           'full-outage': 'degraded' },
    };

    const recoveryMap: Record<string, number> = {
      latency: 15,
      timeout: 30,
      'error-rate': 20,
      'full-outage': 120,
    };

    const targetImpact = impactMap[target];
    const impact: DependencyFailure['impact'] = targetImpact
      ? (targetImpact[failureMode] ?? 'partial-outage')
      : 'partial-outage'; // Unknown dependency — assume moderate impact

    const recoveryTimeSec = recoveryMap[failureMode] ?? 60;

    return { dependency: target, failureMode, impact, recoveryTimeSec };
  }

  // ── Report building ─────────────────────────────────────────

  private buildReport(): SimulationReport {
    const overallPass = this.results.every(r => r.passed);
    const allIssues = this.results.flatMap(r => r.issues);
    const hasCritical = allIssues.some(i => i.severity === 'critical');
    const hasHigh = allIssues.some(i => i.severity === 'high');

    const riskLevel: SimulationReport['riskLevel'] = hasCritical
      ? 'critical'
      : hasHigh
        ? 'high'
        : overallPass
          ? 'low'
          : 'medium';

    const recommendations: string[] = [];

    for (const result of this.results) {
      for (const metric of result.metrics) {
        if (metric.status === 'fail') {
          recommendations.push(`[${result.scenario}] ${metric.name} (${metric.value}) exceeds threshold (${metric.threshold}) — investigate and remediate`);
        } else if (metric.status === 'warn') {
          recommendations.push(`[${result.scenario}] ${metric.name} (${metric.value}) approaching threshold (${metric.threshold}) — monitor closely`);
        }
      }
    }

    if (recommendations.length === 0 && overallPass) {
      recommendations.push('All scenarios passed within acceptable thresholds');
    }

    return {
      scenarios: [...this.results],
      overallPass,
      riskLevel,
      recommendations,
      timestamp: Date.now(),
    };
  }

  // ── Persistence ─────────────────────────────────────────────

  private loadMetrics(): void {
    const metricsPath = join(this.cwd, METRICS_PATH);
    if (!existsSync(metricsPath)) {
      this.metrics = [];
      return;
    }
    try {
      const lines = readFileSync(metricsPath, 'utf-8').trim().split('\n').filter(Boolean);
      this.metrics = lines.map(line => JSON.parse(line) as MetricEntry);
    } catch {
      this.metrics = [];
    }
  }

  private loadReport(): SimulationReport | null {
    const reportPath = join(this.cwd, REPORT_PATH);
    if (!existsSync(reportPath)) return null;
    try {
      return JSON.parse(readFileSync(reportPath, 'utf-8')) as SimulationReport;
    } catch {
      return null;
    }
  }

  private persist(): void {
    const swarmDir = join(this.cwd, '.swarm');
    if (!existsSync(swarmDir)) mkdirSync(swarmDir, { recursive: true });

    const reportPath = join(this.cwd, REPORT_PATH);
    writeFileSync(reportPath, JSON.stringify(this.report, null, 2), 'utf-8');
  }
}
