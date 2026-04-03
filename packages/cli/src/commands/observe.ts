import { Command } from 'commander';
import chalk from 'chalk';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { stringify as toYaml } from 'yaml';
import { requireSwarmDir, loadConfig } from '../core/config.js';
import { ObservabilityManager } from '../core/observability.js';
import { AnomalyDetector } from '../core/anomaly-detector.js';
import type { ObservabilityConfig, ObservabilitySource, AnomalyAlert, PredictiveAlert, DeployMarker, MetricDataPoint } from '../types.js';

function timeSince(ts: number): string {
  if (ts === 0) return 'never';
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function severityColor(severity: 'info' | 'warning' | 'critical'): (s: string) => string {
  switch (severity) {
    case 'critical': return chalk.red;
    case 'warning': return chalk.yellow;
    case 'info': return chalk.dim;
  }
}

function sourceStatusColor(status: 'connected' | 'error' | 'pending'): string {
  switch (status) {
    case 'connected': return chalk.green('connected');
    case 'error': return chalk.red('error');
    case 'pending': return chalk.yellow('pending');
  }
}

function printOverview(mgr: ObservabilityManager, detector: AnomalyDetector): void {
  const state = mgr.getStatus();

  console.log(chalk.bold('\n  Observability Overview\n'));

  // Sources summary
  if (state.sources.length === 0) {
    console.log(chalk.dim('  No data sources configured. Run `hivemind observe setup` to add one.\n'));
  } else {
    console.log(chalk.bold('  Data Sources'));
    for (const src of state.sources) {
      console.log(`    ${chalk.cyan(src.name.padEnd(20))} ${src.type.padEnd(14)} ${sourceStatusColor(src.status).padEnd(20)}  ${src.metricCount} metrics  ${chalk.dim(timeSince(src.lastSync))}`);
    }
    console.log('');
  }

  // Metric count
  console.log(`  ${chalk.bold('Metrics:')} ${state.metricCount} data points stored`);

  // Deploy markers
  console.log(`  ${chalk.bold('Deploy markers:')} ${state.deployMarkers.length} tracked`);

  // Recent anomalies
  const metrics = mgr.getMetrics();
  const anomalies = detector.detect(metrics);
  const recentAnomalies = anomalies.filter(a => Date.now() - a.timestamp < 86400000);

  if (recentAnomalies.length > 0) {
    console.log(chalk.bold(`\n  Anomalies (24h): ${chalk.red(String(recentAnomalies.length))}`));
    for (const a of recentAnomalies.slice(0, 5)) {
      const sev = severityColor(a.severity);
      console.log(`    ${sev(`[${a.severity.toUpperCase()}]`)} ${a.metric}: ${a.type} — value ${a.value.toFixed(2)} (baseline ${a.baseline.toFixed(2)}, ${a.deviation.toFixed(1)}σ)`);
    }
    if (recentAnomalies.length > 5) {
      console.log(chalk.dim(`    ... and ${recentAnomalies.length - 5} more`));
    }
  } else {
    console.log(chalk.green('\n  No anomalies detected in the last 24h'));
  }

  // Predictions
  const predictions = detector.predict(metrics);
  if (predictions.length > 0) {
    console.log(chalk.bold(`\n  Predictions: ${predictions.length}`));
    for (const p of predictions.slice(0, 3)) {
      console.log(`    ${chalk.magenta('→')} ${p.message} (${(p.confidence * 100).toFixed(0)}% confidence)`);
    }
  }

  console.log('');
}

export function registerObserve(program: Command): void {
  const observeCmd = program
    .command('observe')
    .description('Full-stack observability intelligence — metrics, anomalies, and deploy correlation')
    .action(() => {
      let swarmDir: string;
      try {
        swarmDir = requireSwarmDir();
      } catch {
        console.error(chalk.red('No .swarm/ directory found. Run `hivemind init` first.'));
        process.exit(1);
      }

      loadConfig();
      const mgr = new ObservabilityManager(swarmDir);
      const config = mgr.getConfig();
      const detector = new AnomalyDetector(config.alerting.sigma);
      printOverview(mgr, detector);
    });

  // ─── setup ─────────────────────────────────────────────────────────
  observeCmd
    .command('setup')
    .description('Configure observability data sources')
    .option('--name <name>', 'Source name')
    .option('--type <type>', 'Source type (grafana, datadog, cloudwatch, prometheus, opentelemetry, custom)')
    .option('--url <url>', 'Source URL / endpoint')
    .option('--api-key-env <env>', 'Environment variable holding API key')
    .option('--metrics <metrics>', 'Comma-separated list of metric names to track')
    .action((opts: { name?: string; type?: string; url?: string; apiKeyEnv?: string; metrics?: string }) => {
      let swarmDir: string;
      try {
        swarmDir = requireSwarmDir();
      } catch {
        console.error(chalk.red('No .swarm/ directory found. Run `hivemind init` first.'));
        process.exit(1);
      }

      loadConfig();
      const mgr = new ObservabilityManager(swarmDir);
      const config = mgr.getConfig();

      if (!opts.name || !opts.type || !opts.url) {
        // Show current config
        if (Object.keys(config.sources).length === 0) {
          console.log(chalk.dim('\n  No data sources configured.\n'));
          console.log('  To add a source:');
          console.log(chalk.cyan('    swarm observe setup --name grafana-prod --type grafana --url https://grafana.example.com --metrics cpu,memory,latency\n'));
        } else {
          console.log(chalk.bold('\n  Current Data Sources\n'));
          for (const [name, src] of Object.entries(config.sources)) {
            console.log(`  ${chalk.cyan(name)}`);
            console.log(`    Type:    ${src.type}`);
            console.log(`    URL:     ${src.url}`);
            if (src.apiKeyEnv) console.log(`    API Key: $${src.apiKeyEnv}`);
            console.log(`    Metrics: ${src.metrics.join(', ')}`);
            console.log('');
          }
        }
        return;
      }

      const sourceType = opts.type as ObservabilitySource['type'];
      const validTypes = ['grafana', 'datadog', 'cloudwatch', 'prometheus', 'opentelemetry', 'custom'];
      if (!validTypes.includes(sourceType)) {
        console.error(chalk.red(`Invalid source type "${opts.type}". Must be one of: ${validTypes.join(', ')}`));
        process.exit(1);
      }

      const metricsList = opts.metrics ? opts.metrics.split(',').map(m => m.trim()) : ['*'];

      const source: ObservabilitySource = {
        type: sourceType,
        url: opts.url,
        apiKeyEnv: opts.apiKeyEnv,
        metrics: metricsList,
      };

      config.sources[opts.name] = source;
      mgr.saveConfig(config);

      console.log(chalk.green(`\n  ✓ Added data source "${opts.name}" (${sourceType})`));
      console.log(chalk.dim(`    URL: ${opts.url}`));
      console.log(chalk.dim(`    Metrics: ${metricsList.join(', ')}`));
      console.log(chalk.dim(`    Config saved to .swarm/observability.yaml\n`));
    });

  // ─── status ────────────────────────────────────────────────────────
  observeCmd
    .command('status')
    .description('Show data source health and metric counts')
    .action(() => {
      let swarmDir: string;
      try {
        swarmDir = requireSwarmDir();
      } catch {
        console.error(chalk.red('No .swarm/ directory found. Run `hivemind init` first.'));
        process.exit(1);
      }

      loadConfig();
      const mgr = new ObservabilityManager(swarmDir);
      const state = mgr.getStatus();

      console.log(chalk.bold('\n  Data Source Status\n'));

      if (state.sources.length === 0) {
        console.log(chalk.dim('  No data sources configured. Run `hivemind observe setup` to add one.\n'));
        return;
      }

      // Header
      const hdr = `  ${'Name'.padEnd(20)} ${'Type'.padEnd(14)} ${'Status'.padEnd(14)} ${'Metrics'.padEnd(10)} Last Sync`;
      console.log(chalk.dim(hdr));
      console.log(chalk.dim('  ' + '─'.repeat(80)));

      for (const src of state.sources) {
        const name = src.name.padEnd(20);
        const type = src.type.padEnd(14);
        const status = sourceStatusColor(src.status).padEnd(14 + 10); // extra for ANSI
        const metricCount = String(src.metricCount).padEnd(10);
        const lastSync = chalk.dim(timeSince(src.lastSync));
        console.log(`  ${name} ${type} ${status} ${metricCount} ${lastSync}`);
      }

      console.log(`\n  ${chalk.bold('Total:')} ${state.metricCount} data points across ${state.sources.length} source(s)`);
      console.log(`  ${chalk.bold('Deploy markers:')} ${state.deployMarkers.length} tracked\n`);
    });

  // ─── query ─────────────────────────────────────────────────────────
  observeCmd
    .command('query <query>')
    .description('Query metrics with natural language (e.g., "cpu last 24h")')
    .option('-n, --limit <count>', 'Max results to show', '20')
    .action((query: string, opts: { limit: string }) => {
      let swarmDir: string;
      try {
        swarmDir = requireSwarmDir();
      } catch {
        console.error(chalk.red('No .swarm/ directory found. Run `hivemind init` first.'));
        process.exit(1);
      }

      loadConfig();
      const mgr = new ObservabilityManager(swarmDir);
      const results = mgr.queryMetrics(query);
      const limit = parseInt(opts.limit) || 20;

      console.log(chalk.bold(`\n  Query: "${query}"\n`));

      if (results.length === 0) {
        console.log(chalk.dim('  No matching metrics found.\n'));
        return;
      }

      console.log(chalk.dim(`  Found ${results.length} data point(s). Showing ${Math.min(limit, results.length)}:\n`));

      // Header
      const hdr = `  ${'Metric'.padEnd(28)} ${'Value'.padEnd(14)} ${'Source'.padEnd(16)} ${'Tags'.padEnd(20)} Time`;
      console.log(chalk.dim(hdr));
      console.log(chalk.dim('  ' + '─'.repeat(100)));

      const display = results.slice(-limit).reverse();
      for (const m of display) {
        const name = m.name.padEnd(28);
        const value = String(m.value.toFixed(2)).padEnd(14);
        const source = m.source.padEnd(16);
        const tags = Object.entries(m.tags ?? {}).map(([k, v]) => `${k}=${v}`).join(', ').padEnd(20);
        const time = chalk.dim(timeSince(m.timestamp));
        console.log(`  ${chalk.cyan(name)} ${value} ${source} ${chalk.dim(tags)} ${time}`);
      }

      console.log('');
    });

  // ─── correlate ─────────────────────────────────────────────────────
  observeCmd
    .command('correlate <sha>')
    .description('Show metric changes after a deploy commit')
    .option('--window <minutes>', 'Time window in minutes around deploy', '60')
    .action((sha: string, opts: { window: string }) => {
      let swarmDir: string;
      try {
        swarmDir = requireSwarmDir();
      } catch {
        console.error(chalk.red('No .swarm/ directory found. Run `hivemind init` first.'));
        process.exit(1);
      }

      loadConfig();
      const mgr = new ObservabilityManager(swarmDir);
      const windowMs = (parseInt(opts.window) || 60) * 60000;
      const { before, after } = mgr.getMetricsAroundDeploy(sha, windowMs);

      console.log(chalk.bold(`\n  Deploy Correlation: ${chalk.cyan(sha.slice(0, 8))}\n`));

      const deploys = mgr.getDeployMarkers();
      const deploy = deploys.find(d => d.sha.startsWith(sha));

      if (deploy) {
        console.log(`  ${chalk.bold('Author:')} ${deploy.author}`);
        console.log(`  ${chalk.bold('Message:')} ${deploy.message}`);
        console.log(`  ${chalk.bold('Files changed:')} ${deploy.filesChanged.length}`);
        for (const f of deploy.filesChanged.slice(0, 10)) {
          console.log(`    ${chalk.dim(f)}`);
        }
        if (deploy.filesChanged.length > 10) {
          console.log(chalk.dim(`    ... and ${deploy.filesChanged.length - 10} more`));
        }
        console.log('');
      }

      if (before.length === 0 && after.length === 0) {
        console.log(chalk.dim(`  No metrics found within ${opts.window}m window around this deploy.\n`));
        return;
      }

      // Group by metric name and compare before/after averages
      const metricNames = new Set([...before.map(m => m.name), ...after.map(m => m.name)]);

      console.log(chalk.bold('  Metric Changes\n'));
      const hdr = `  ${'Metric'.padEnd(28)} ${'Before (avg)'.padEnd(16)} ${'After (avg)'.padEnd(16)} Change`;
      console.log(chalk.dim(hdr));
      console.log(chalk.dim('  ' + '─'.repeat(80)));

      for (const name of metricNames) {
        const beforeVals = before.filter(m => m.name === name).map(m => m.value);
        const afterVals = after.filter(m => m.name === name).map(m => m.value);

        const beforeAvg = beforeVals.length > 0 ? beforeVals.reduce((s, v) => s + v, 0) / beforeVals.length : 0;
        const afterAvg = afterVals.length > 0 ? afterVals.reduce((s, v) => s + v, 0) / afterVals.length : 0;

        const change = beforeAvg > 0 ? ((afterAvg - beforeAvg) / beforeAvg * 100) : 0;
        const changeStr = change > 0 ? chalk.red(`+${change.toFixed(1)}%`) : change < 0 ? chalk.green(`${change.toFixed(1)}%`) : chalk.dim('0%');

        console.log(`  ${name.padEnd(28)} ${beforeAvg.toFixed(2).padEnd(16)} ${afterAvg.toFixed(2).padEnd(16)} ${changeStr}`);
      }

      console.log('');
    });

  // ─── anomalies ─────────────────────────────────────────────────────
  observeCmd
    .command('anomalies')
    .description('Show current and recent anomalies')
    .option('--hours <hours>', 'Lookback window in hours', '24')
    .action((opts: { hours: string }) => {
      let swarmDir: string;
      try {
        swarmDir = requireSwarmDir();
      } catch {
        console.error(chalk.red('No .swarm/ directory found. Run `hivemind init` first.'));
        process.exit(1);
      }

      loadConfig();
      const mgr = new ObservabilityManager(swarmDir);
      const config = mgr.getConfig();
      const detector = new AnomalyDetector(config.alerting.sigma);
      const metrics = mgr.getMetrics();
      const deploys = mgr.getDeployMarkers();
      const hours = parseInt(opts.hours) || 24;

      let anomalies = detector.detect(metrics);

      // Correlate with deploys
      anomalies = anomalies.map(a => detector.correlateWithDeploys(a, deploys));

      // Filter by time window
      const cutoff = Date.now() - hours * 3600000;
      anomalies = anomalies.filter(a => a.timestamp >= cutoff);

      console.log(chalk.bold(`\n  Anomaly Detection (last ${hours}h)\n`));

      if (anomalies.length === 0) {
        console.log(chalk.green('  No anomalies detected.\n'));
        return;
      }

      console.log(chalk.dim(`  Found ${anomalies.length} anomal${anomalies.length === 1 ? 'y' : 'ies'}:\n`));

      for (const a of anomalies) {
        const sev = severityColor(a.severity);
        const sevLabel = sev(`[${a.severity.toUpperCase()}]`);
        const typeLabel = chalk.dim(`(${a.type})`);

        console.log(`  ${sevLabel} ${chalk.bold(a.metric)} ${typeLabel}`);
        console.log(`    Value: ${a.value.toFixed(2)}  Baseline: ${a.baseline.toFixed(2)}  Deviation: ${a.deviation.toFixed(1)}σ`);
        console.log(`    Time: ${new Date(a.timestamp).toISOString()}`);

        if (a.deployCorrelation) {
          const dc = a.deployCorrelation;
          console.log(`    ${chalk.yellow('→ Correlated with deploy')} ${chalk.cyan(dc.sha.slice(0, 8))} (${(dc.confidence * 100).toFixed(0)}% confidence)`);
          if (dc.filesChanged.length > 0) {
            console.log(`      Files: ${dc.filesChanged.slice(0, 5).join(', ')}${dc.filesChanged.length > 5 ? ` (+${dc.filesChanged.length - 5})` : ''}`);
          }
        }

        console.log('');
      }
    });

  // ─── predict ───────────────────────────────────────────────────────
  observeCmd
    .command('predict')
    .description('Show predictive alerts based on metric trends')
    .action(() => {
      let swarmDir: string;
      try {
        swarmDir = requireSwarmDir();
      } catch {
        console.error(chalk.red('No .swarm/ directory found. Run `hivemind init` first.'));
        process.exit(1);
      }

      loadConfig();
      const mgr = new ObservabilityManager(swarmDir);
      const config = mgr.getConfig();
      const detector = new AnomalyDetector(config.alerting.sigma);
      const metrics = mgr.getMetrics();

      const predictions = detector.predict(metrics);

      console.log(chalk.bold('\n  Predictive Alerts\n'));

      if (predictions.length === 0) {
        console.log(chalk.dim('  No predictive alerts. Need at least 10 data points per metric.\n'));
        return;
      }

      for (const p of predictions) {
        const confidence = p.confidence >= 0.8 ? chalk.green : p.confidence >= 0.5 ? chalk.yellow : chalk.dim;
        const typeIcon = p.type === 'capacity' ? chalk.red('⬆') : p.type === 'trend' ? chalk.yellow('↗') : chalk.magenta('~');

        console.log(`  ${typeIcon} ${chalk.bold(p.metric)} ${chalk.dim(`[${p.type}]`)}`);
        console.log(`    ${p.message}`);
        console.log(`    Confidence: ${confidence(`${(p.confidence * 100).toFixed(0)}%`)}  ETA: ${chalk.cyan(p.timeToImpact)}`);
        console.log('');
      }
    });

  // ─── watch ─────────────────────────────────────────────────────────
  observeCmd
    .command('watch')
    .description('Start continuous monitoring (polls every interval)')
    .option('--interval <seconds>', 'Poll interval in seconds', '30')
    .action((opts: { interval: string }) => {
      let swarmDir: string;
      try {
        swarmDir = requireSwarmDir();
      } catch {
        console.error(chalk.red('No .swarm/ directory found. Run `hivemind init` first.'));
        process.exit(1);
      }

      loadConfig();
      const mgr = new ObservabilityManager(swarmDir);
      const config = mgr.getConfig();
      const detector = new AnomalyDetector(config.alerting.sigma);
      const intervalMs = (parseInt(opts.interval) || 30) * 1000;

      console.log(chalk.bold(`\n  Observability Watch Mode`));
      console.log(chalk.dim(`  Polling every ${opts.interval}s. Press Ctrl+C to stop.\n`));

      let previousAnomalyCount = 0;

      const tick = () => {
        const now = new Date().toLocaleTimeString();
        const metrics = mgr.getMetrics();
        const anomalies = detector.detect(metrics);
        const predictions = detector.predict(metrics);
        const state = mgr.getStatus();

        // Summary line
        const srcConnected = state.sources.filter(s => s.status === 'connected').length;
        const srcTotal = state.sources.length;
        const newAnomalies = anomalies.length - previousAnomalyCount;

        let statusLine = `  [${chalk.dim(now)}] Sources: ${srcConnected}/${srcTotal}  Metrics: ${state.metricCount}  Anomalies: `;

        if (anomalies.length === 0) {
          statusLine += chalk.green('0');
        } else {
          statusLine += chalk.red(String(anomalies.length));
        }

        if (newAnomalies > 0) {
          statusLine += chalk.red(` (+${newAnomalies} new)`);
        }

        if (predictions.length > 0) {
          statusLine += `  Predictions: ${chalk.yellow(String(predictions.length))}`;
        }

        console.log(statusLine);

        // Print new anomalies in detail
        if (newAnomalies > 0) {
          const deploys = mgr.getDeployMarkers();
          const newAlerts = anomalies.slice(0, newAnomalies);
          for (const a of newAlerts) {
            const correlated = detector.correlateWithDeploys(a, deploys);
            const sev = severityColor(correlated.severity);
            console.log(`    ${sev(`[${correlated.severity.toUpperCase()}]`)} ${correlated.metric}: ${correlated.type} — ${correlated.value.toFixed(2)} (${correlated.deviation.toFixed(1)}σ)`);
            if (correlated.deployCorrelation) {
              console.log(`      ${chalk.yellow('→ deploy')} ${chalk.cyan(correlated.deployCorrelation.sha.slice(0, 8))} (${(correlated.deployCorrelation.confidence * 100).toFixed(0)}%)`);
            }
          }
        }

        previousAnomalyCount = anomalies.length;
      };

      // Initial tick
      tick();

      // Start polling
      const timer = setInterval(tick, intervalMs);

      // Graceful shutdown
      const shutdown = () => {
        clearInterval(timer);
        console.log(chalk.dim('\n  Watch mode stopped.\n'));
        process.exit(0);
      };

      process.on('SIGINT', shutdown);
      process.on('SIGTERM', shutdown);
    });
}
