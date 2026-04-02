import { randomUUID } from 'node:crypto';
import type {
  MetricDataPoint,
  DeployMarker,
  AnomalyAlert,
  PredictiveAlert,
} from '../types.js';

interface BaselineStats {
  mean: number;
  stddev: number;
  count: number;
  min: number;
  max: number;
}

export class AnomalyDetector {
  private sigma: number;

  constructor(sigma: number = 3) {
    this.sigma = sigma;
  }

  /** Detect anomalies in a set of metric data points using Z-score */
  detect(metrics: MetricDataPoint[]): AnomalyAlert[] {
    if (metrics.length < 5) return [];

    const alerts: AnomalyAlert[] = [];

    // Group metrics by name
    const grouped = this.groupByName(metrics);

    for (const [name, points] of Object.entries(grouped)) {
      if (points.length < 5) continue;

      // Sort by timestamp
      const sorted = [...points].sort((a, b) => a.timestamp - b.timestamp);

      // Use the first 80% as baseline, check the last 20%
      const splitIdx = Math.floor(sorted.length * 0.8);
      const baseline = sorted.slice(0, splitIdx);
      const recent = sorted.slice(splitIdx);

      const stats = this.computeBaseline(baseline.map(p => p.value));
      if (stats.stddev === 0) continue;

      for (const point of recent) {
        const zScore = Math.abs((point.value - stats.mean) / stats.stddev);

        if (zScore >= this.sigma) {
          const isSpike = point.value > stats.mean;
          alerts.push({
            id: randomUUID(),
            metric: name,
            type: isSpike ? 'spike' : 'drop',
            severity: this.classifySeverity(zScore),
            value: point.value,
            baseline: stats.mean,
            deviation: zScore,
            timestamp: point.timestamp,
            resolved: false,
          });
        }
      }

      // Check for trend anomalies (consistent drift)
      const trendAlert = this.detectTrend(name, sorted, stats);
      if (trendAlert) {
        alerts.push(trendAlert);
      }
    }

    // Deduplicate: keep only the most severe alert per metric per hour
    return this.deduplicateAlerts(alerts);
  }

  /** Correlate an anomaly with nearby deploys */
  correlateWithDeploys(
    anomaly: AnomalyAlert,
    deploys: DeployMarker[],
    windowMs: number = 3600000
  ): AnomalyAlert {
    const nearbyDeploys = deploys.filter(
      d => Math.abs(d.timestamp - anomaly.timestamp) <= windowMs
    );

    if (nearbyDeploys.length === 0) return anomaly;

    // Find the closest deploy
    const closest = nearbyDeploys.reduce((best, d) => {
      const dist = Math.abs(d.timestamp - anomaly.timestamp);
      const bestDist = Math.abs(best.timestamp - anomaly.timestamp);
      return dist < bestDist ? d : best;
    });

    // Confidence is higher when deploy is closer in time
    const timeDiff = Math.abs(closest.timestamp - anomaly.timestamp);
    const confidence = Math.max(0.1, 1 - timeDiff / windowMs);

    return {
      ...anomaly,
      type: 'correlation',
      deployCorrelation: {
        sha: closest.sha,
        confidence: Math.round(confidence * 100) / 100,
        filesChanged: closest.filesChanged,
      },
    };
  }

  /** Predict future issues based on metric trends */
  predict(metrics: MetricDataPoint[]): PredictiveAlert[] {
    if (metrics.length < 10) return [];

    const alerts: PredictiveAlert[] = [];
    const grouped = this.groupByName(metrics);

    for (const [name, points] of Object.entries(grouped)) {
      if (points.length < 10) continue;

      const sorted = [...points].sort((a, b) => a.timestamp - b.timestamp);
      const values = sorted.map(p => p.value);
      const timestamps = sorted.map(p => p.timestamp);

      // Linear regression for trend extrapolation
      const regression = this.linearRegression(timestamps, values);

      if (Math.abs(regression.slope) < 0.0001) continue;

      const stats = this.computeBaseline(values);

      // Capacity alert: predict when metric will exceed 2 sigma
      const upperThreshold = stats.mean + this.sigma * stats.stddev;
      const lowerThreshold = stats.mean - this.sigma * stats.stddev;

      if (regression.slope > 0) {
        // Growing trend — predict when it crosses upper threshold
        const currentValue = regression.slope * timestamps[timestamps.length - 1] + regression.intercept;
        if (currentValue < upperThreshold) {
          const timeToThreshold = (upperThreshold - currentValue) / regression.slope;
          if (timeToThreshold > 0 && timeToThreshold < 7 * 86400000) {
            alerts.push({
              metric: name,
              type: 'capacity',
              message: `${name} is trending up — predicted to breach threshold in ${this.formatDuration(timeToThreshold)}`,
              predictedAt: Date.now() + timeToThreshold,
              confidence: Math.min(0.95, regression.r2),
              timeToImpact: this.formatDuration(timeToThreshold),
            });
          }
        }
      } else {
        // Decreasing trend — predict when it crosses lower threshold
        const currentValue = regression.slope * timestamps[timestamps.length - 1] + regression.intercept;
        if (currentValue > lowerThreshold) {
          const timeToThreshold = (lowerThreshold - currentValue) / regression.slope;
          if (timeToThreshold > 0 && timeToThreshold < 7 * 86400000) {
            alerts.push({
              metric: name,
              type: 'trend',
              message: `${name} is trending down — predicted to breach threshold in ${this.formatDuration(timeToThreshold)}`,
              predictedAt: Date.now() + timeToThreshold,
              confidence: Math.min(0.95, regression.r2),
              timeToImpact: this.formatDuration(timeToThreshold),
            });
          }
        }
      }

      // Pattern detection: check for periodic spikes
      const patternAlert = this.detectPattern(name, sorted);
      if (patternAlert) {
        alerts.push(patternAlert);
      }
    }

    return alerts;
  }

  /** Compute baseline statistics for a set of values */
  private computeBaseline(values: number[]): BaselineStats {
    if (values.length === 0) {
      return { mean: 0, stddev: 0, count: 0, min: 0, max: 0 };
    }

    const count = values.length;
    const mean = values.reduce((sum, v) => sum + v, 0) / count;
    const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / count;
    const stddev = Math.sqrt(variance);

    return {
      mean,
      stddev,
      count,
      min: Math.min(...values),
      max: Math.max(...values),
    };
  }

  /** Classify severity based on Z-score magnitude */
  private classifySeverity(zScore: number): 'info' | 'warning' | 'critical' {
    if (zScore >= this.sigma * 2) return 'critical';
    if (zScore >= this.sigma * 1.5) return 'warning';
    return 'info';
  }

  /** Detect sustained trend drift */
  private detectTrend(name: string, sorted: MetricDataPoint[], stats: BaselineStats): AnomalyAlert | null {
    if (sorted.length < 10) return null;

    // Check if the last 5 points are all above or below the mean
    const lastN = sorted.slice(-5);
    const allAbove = lastN.every(p => p.value > stats.mean + stats.stddev);
    const allBelow = lastN.every(p => p.value < stats.mean - stats.stddev);

    if (!allAbove && !allBelow) return null;

    const avgRecent = lastN.reduce((s, p) => s + p.value, 0) / lastN.length;
    const deviation = Math.abs((avgRecent - stats.mean) / (stats.stddev || 1));

    return {
      id: randomUUID(),
      metric: name,
      type: 'trend',
      severity: deviation >= this.sigma * 1.5 ? 'warning' : 'info',
      value: avgRecent,
      baseline: stats.mean,
      deviation,
      timestamp: lastN[lastN.length - 1].timestamp,
      resolved: false,
    };
  }

  /** Detect periodic patterns (e.g., daily spikes) */
  private detectPattern(name: string, sorted: MetricDataPoint[]): PredictiveAlert | null {
    if (sorted.length < 24) return null;

    // Simple approach: check if there's a clear hourly periodicity
    const hourBuckets: Record<number, number[]> = {};
    for (const p of sorted) {
      const hour = new Date(p.timestamp).getHours();
      if (!hourBuckets[hour]) hourBuckets[hour] = [];
      hourBuckets[hour].push(p.value);
    }

    // Find the hour with the highest average
    let peakHour = -1;
    let peakAvg = -Infinity;
    let overallAvg = 0;
    let totalPoints = 0;

    for (const [hour, values] of Object.entries(hourBuckets)) {
      const avg = values.reduce((s, v) => s + v, 0) / values.length;
      overallAvg += values.reduce((s, v) => s + v, 0);
      totalPoints += values.length;
      if (avg > peakAvg) {
        peakAvg = avg;
        peakHour = parseInt(hour);
      }
    }

    overallAvg /= totalPoints;

    // If peak hour is >50% above overall average, report pattern
    if (peakAvg > overallAvg * 1.5 && peakHour >= 0) {
      return {
        metric: name,
        type: 'pattern',
        message: `${name} shows recurring peak at hour ${peakHour}:00 (${((peakAvg / overallAvg - 1) * 100).toFixed(0)}% above avg)`,
        predictedAt: this.nextOccurrence(peakHour),
        confidence: 0.6,
        timeToImpact: this.formatDuration(this.nextOccurrence(peakHour) - Date.now()),
      };
    }

    return null;
  }

  /** Get the next occurrence of a given hour */
  private nextOccurrence(hour: number): number {
    const now = new Date();
    const next = new Date(now);
    next.setHours(hour, 0, 0, 0);
    if (next.getTime() <= now.getTime()) {
      next.setDate(next.getDate() + 1);
    }
    return next.getTime();
  }

  /** Simple linear regression */
  private linearRegression(x: number[], y: number[]): { slope: number; intercept: number; r2: number } {
    const n = x.length;
    if (n < 2) return { slope: 0, intercept: 0, r2: 0 };

    // Normalize x values to avoid numerical overflow
    const xMin = x[0];
    const xNorm = x.map(v => v - xMin);

    const sumX = xNorm.reduce((s, v) => s + v, 0);
    const sumY = y.reduce((s, v) => s + v, 0);
    const sumXY = xNorm.reduce((s, v, i) => s + v * y[i], 0);
    const sumX2 = xNorm.reduce((s, v) => s + v * v, 0);

    const denom = n * sumX2 - sumX * sumX;
    if (Math.abs(denom) < 1e-10) return { slope: 0, intercept: sumY / n, r2: 0 };

    const slope = (n * sumXY - sumX * sumY) / denom;
    const intercept = (sumY - slope * sumX) / n;

    // R-squared
    const meanY = sumY / n;
    const ssRes = y.reduce((s, v, i) => s + (v - (slope * xNorm[i] + intercept)) ** 2, 0);
    const ssTot = y.reduce((s, v) => s + (v - meanY) ** 2, 0);
    const r2 = ssTot > 0 ? 1 - ssRes / ssTot : 0;

    return { slope, intercept, r2: Math.max(0, r2) };
  }

  /** Deduplicate alerts: keep most severe per metric per hour */
  private deduplicateAlerts(alerts: AnomalyAlert[]): AnomalyAlert[] {
    const byKey = new Map<string, AnomalyAlert>();
    const severityRank = { critical: 3, warning: 2, info: 1 };

    for (const alert of alerts) {
      const hourBucket = Math.floor(alert.timestamp / 3600000);
      const key = `${alert.metric}:${hourBucket}`;
      const existing = byKey.get(key);

      if (!existing || severityRank[alert.severity] > severityRank[existing.severity]) {
        byKey.set(key, alert);
      }
    }

    return [...byKey.values()].sort((a, b) => b.timestamp - a.timestamp);
  }

  /** Format a duration in milliseconds to human-readable */
  private formatDuration(ms: number): string {
    if (ms < 0) return 'now';
    const hours = Math.floor(ms / 3600000);
    if (hours < 1) {
      const mins = Math.floor(ms / 60000);
      return `${mins}m`;
    }
    if (hours < 24) return `${hours}h`;
    const days = Math.floor(hours / 24);
    return `${days}d`;
  }

  /** Group metric data points by name */
  private groupByName(metrics: MetricDataPoint[]): Record<string, MetricDataPoint[]> {
    const grouped: Record<string, MetricDataPoint[]> = {};
    for (const m of metrics) {
      if (!grouped[m.name]) grouped[m.name] = [];
      grouped[m.name].push(m);
    }
    return grouped;
  }
}
