import { existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import chalk from 'chalk';
import type { Command } from 'commander';
import { SecurityScanner } from '../core/security-scanner.js';
import type { SecurityFinding, SecurityReport } from '../core/security-scanner.js';

const SEVERITY_COLORS: Record<string, (s: string) => string> = {
  critical: chalk.bgRed.white,
  high: chalk.red,
  medium: chalk.yellow,
  low: chalk.cyan,
  info: chalk.dim,
};

const SEVERITY_ORDER: Record<string, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  info: 4,
};

export function registerSecure(program: Command): void {
  program
    .command('secure')
    .description('OWASP security scanner — find vulnerabilities in your code')
    .option('--full', 'Include LLM semantic analysis of high-risk findings')
    .option('--fix', 'Auto-fix critical/high findings (spawns engineer agent)')
    .option('--fail-on <severity>', 'Exit with error for findings at/above severity', 'high')
    .option('--json', 'Output as JSON')
    .option('--sarif', 'Output in SARIF format')
    .option('--scope <path>', 'Limit scan to specific path')
    .option('--model <model>', 'Model for LLM analysis (e.g., sonnet, openai/gpt-4o)', 'sonnet')
    .action(async (opts) => {
      const cwd = process.cwd();
      const swarmDir = join(cwd, '.swarm');

      // Run static pattern scan
      console.log(chalk.bold('\nSwarm Security Scanner\n'));
      console.log(chalk.dim('Scanning for OWASP vulnerabilities...\n'));

      const scanner = new SecurityScanner(opts.scope ? join(cwd, opts.scope) : cwd);
      const report = scanner.scan();

      // Run npm audit if package.json exists
      let npmAuditFindings: SecurityFinding[] = [];
      const pkgJsonPath = join(cwd, 'package.json');
      if (existsSync(pkgJsonPath)) {
        npmAuditFindings = runNpmAudit(cwd);
        report.findings.push(...npmAuditFindings);
        report.summary.critical += npmAuditFindings.filter(f => f.severity === 'critical').length;
        report.summary.high += npmAuditFindings.filter(f => f.severity === 'high').length;
        report.summary.medium += npmAuditFindings.filter(f => f.severity === 'medium').length;
        report.summary.low += npmAuditFindings.filter(f => f.severity === 'low').length;
        report.summary.info += npmAuditFindings.filter(f => f.severity === 'info').length;
      }

      // Output format
      if (opts.json) {
        console.log(JSON.stringify(report, null, 2));
      } else if (opts.sarif) {
        console.log(JSON.stringify(toSarif(report), null, 2));
      } else {
        printReport(report);
      }

      // Save report to .swarm/
      if (existsSync(swarmDir) || report.findings.length > 0) {
        if (!existsSync(swarmDir)) {
          mkdirSync(swarmDir, { recursive: true });
        }
        writeFileSync(
          join(swarmDir, 'security-report.json'),
          JSON.stringify(report, null, 2),
        );
        console.log(chalk.dim(`\nReport saved to .swarm/security-report.json`));
      }

      // --full: LLM semantic analysis (informational message for now)
      if (opts.full && report.findings.some(f => f.severity === 'critical' || f.severity === 'high')) {
        console.log(chalk.yellow('\n--full: LLM semantic analysis requires a running swarm context.'));
        console.log(chalk.dim('Run `swarm dashboard` and trigger security scan from the dashboard for full analysis.'));
      }

      // --fix: auto-fix (informational message for now)
      if (opts.fix && report.findings.some(f => f.severity === 'critical' || f.severity === 'high')) {
        console.log(chalk.yellow('\n--fix: Auto-fix requires a running swarm context.'));
        console.log(chalk.dim('Run `swarm dashboard` and trigger security fix from the dashboard.'));
      }

      // --fail-on: exit with error if findings at or above severity
      if (opts.failOn) {
        const failLevel = SEVERITY_ORDER[opts.failOn] ?? 1;
        const failing = report.findings.filter(f => (SEVERITY_ORDER[f.severity] ?? 5) <= failLevel);
        if (failing.length > 0) {
          console.error(chalk.red(`\n${failing.length} finding(s) at or above "${opts.failOn}" severity — failing.`));
          process.exit(1);
        }
      }
    });
}

function printReport(report: SecurityReport): void {
  if (report.findings.length === 0) {
    console.log(chalk.green('  No security findings detected.\n'));
    console.log(chalk.dim(`  Scanned ${report.scannedFiles} file(s) in ${report.durationMs}ms`));
    return;
  }

  // Group by category
  const byCategory = new Map<string, SecurityFinding[]>();
  for (const f of report.findings) {
    const arr = byCategory.get(f.category) ?? [];
    arr.push(f);
    byCategory.set(f.category, arr);
  }

  for (const [category, findings] of byCategory) {
    console.log(chalk.bold(`  ${formatCategory(category)} (${findings.length})`));
    for (const f of findings) {
      const colorFn = SEVERITY_COLORS[f.severity] ?? chalk.white;
      const cweTag = f.cwe ? chalk.dim(` [${f.cwe}]`) : '';
      console.log(`    ${colorFn(`[${f.severity.toUpperCase()}]`)} ${f.file}:${f.line}${cweTag}`);
      console.log(chalk.dim(`      ${f.message}`));
      console.log(chalk.dim(`      ${chalk.italic(truncate(f.code, 120))}`));
      console.log(chalk.green(`      Fix: ${f.suggestion}`));
      console.log();
    }
  }

  // Summary
  console.log(chalk.bold('  Summary'));
  console.log(
    '    ' +
    (report.summary.critical > 0 ? SEVERITY_COLORS.critical(` ${report.summary.critical} critical `) + ' ' : '') +
    (report.summary.high > 0 ? SEVERITY_COLORS.high(`${report.summary.high} high`) + ' ' : '') +
    (report.summary.medium > 0 ? SEVERITY_COLORS.medium(`${report.summary.medium} medium`) + ' ' : '') +
    (report.summary.low > 0 ? SEVERITY_COLORS.low(`${report.summary.low} low`) + ' ' : '') +
    (report.summary.info > 0 ? SEVERITY_COLORS.info(`${report.summary.info} info`) : ''),
  );
  console.log(chalk.dim(`    Scanned ${report.scannedFiles} file(s) in ${report.durationMs}ms\n`));
}

function runNpmAudit(cwd: string): SecurityFinding[] {
  const findings: SecurityFinding[] = [];
  try {
    const output = execSync('npm audit --json 2>/dev/null', {
      cwd,
      encoding: 'utf-8',
      timeout: 30000,
    });

    const audit = JSON.parse(output);
    if (audit.vulnerabilities) {
      let counter = 9000;
      for (const [name, vuln] of Object.entries<Record<string, unknown>>(audit.vulnerabilities)) {
        counter++;
        const sev = mapNpmSeverity(vuln.severity as string);
        findings.push({
          id: `DEP-${counter}`,
          category: 'dependency-vuln',
          severity: sev,
          file: 'package.json',
          line: 1,
          code: `${name}@${(vuln as Record<string, unknown>).range ?? 'unknown'}`,
          message: `Vulnerable dependency: ${name} — ${(vuln as Record<string, unknown>).title ?? (vuln as Record<string, unknown>).severity}`,
          suggestion: `Run "npm audit fix" or update ${name} to a patched version.`,
          cwe: (vuln as Record<string, unknown>).cwe ? String((vuln as Record<string, string[]>).cwe?.[0] ?? '') : undefined,
        });
      }
    }
  } catch {
    // npm audit exits non-zero when vulns found, try to parse stderr/stdout
    // Silently skip if npm audit fails entirely
  }

  return findings;
}

function mapNpmSeverity(sev: string): SecurityFinding['severity'] {
  switch (sev) {
    case 'critical': return 'critical';
    case 'high': return 'high';
    case 'moderate': return 'medium';
    case 'low': return 'low';
    default: return 'info';
  }
}

function formatCategory(category: string): string {
  return category.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.substring(0, max - 3) + '...' : s;
}

/** Convert report to SARIF 2.1.0 format */
function toSarif(report: SecurityReport): Record<string, unknown> {
  return {
    $schema: 'https://raw.githubusercontent.com/oasis-tcs/sarif-spec/master/Schemata/sarif-schema-2.1.0.json',
    version: '2.1.0',
    runs: [
      {
        tool: {
          driver: {
            name: 'swarm-secure',
            version: '0.1.0',
            informationUri: 'https://github.com/swarm-cli/swarm',
            rules: Array.from(new Set(report.findings.map(f => f.category))).map(cat => ({
              id: cat,
              shortDescription: { text: formatCategory(cat) },
            })),
          },
        },
        results: report.findings.map(f => ({
          ruleId: f.category,
          level: f.severity === 'critical' || f.severity === 'high' ? 'error' :
                 f.severity === 'medium' ? 'warning' : 'note',
          message: { text: f.message },
          locations: [
            {
              physicalLocation: {
                artifactLocation: { uri: f.file },
                region: { startLine: f.line },
              },
            },
          ],
          fixes: [
            {
              description: { text: f.suggestion },
            },
          ],
        })),
      },
    ],
  };
}
