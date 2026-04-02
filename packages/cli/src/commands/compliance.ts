import { Command } from 'commander';
import chalk from 'chalk';
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { execSync } from 'node:child_process';
import { requireSwarmDir, loadConfig } from '../core/config.js';
import type { ComplianceData } from '../types.js';

// ── Types ──────────────────────────────────────────────────────────────────────

type ComplianceStatus = 'pass' | 'fail' | 'partial' | 'not-applicable';
type Framework = 'soc2' | 'hipaa' | 'gdpr' | 'pci';

interface ComplianceCheck {
  id: string;
  requirement: string;
  category: string;
  status: ComplianceStatus;
  evidence?: string;
  remediation?: string;
}

interface CustomCheck {
  id: string;
  requirement: string;
  category: string;
  framework: string;
  command?: string;
  pattern?: string;
  path?: string;
  description?: string;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function statusColor(status: ComplianceStatus): (s: string) => string {
  switch (status) {
    case 'pass': return chalk.green;
    case 'fail': return chalk.red;
    case 'partial': return chalk.yellow;
    case 'not-applicable': return chalk.dim;
  }
}

function statusIcon(status: ComplianceStatus): string {
  switch (status) {
    case 'pass': return 'PASS';
    case 'fail': return 'FAIL';
    case 'partial': return 'PART';
    case 'not-applicable': return 'N/A';
  }
}

function calculateScore(checks: ComplianceCheck[]): number {
  const applicable = checks.filter(c => c.status !== 'not-applicable');
  if (applicable.length === 0) return 0;
  const score = applicable.reduce((sum, c) => {
    if (c.status === 'pass') return sum + 1;
    if (c.status === 'partial') return sum + 0.5;
    return sum;
  }, 0);
  return Math.round((score / applicable.length) * 100);
}

function shellCheck(cmd: string): boolean {
  try {
    execSync(cmd, { encoding: 'utf-8', timeout: 15000, stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

function shellOutput(cmd: string): string | null {
  try {
    return execSync(cmd, { encoding: 'utf-8', timeout: 15000, stdio: 'pipe' }).trim();
  } catch {
    return null;
  }
}

function fileContainsPattern(filePath: string, pattern: RegExp): boolean {
  try {
    const content = readFileSync(filePath, 'utf-8');
    return pattern.test(content);
  } catch {
    return false;
  }
}

function searchFilesForPattern(dir: string, pattern: RegExp, extensions: string[]): string[] {
  const matches: string[] = [];
  try {
    const entries = readdirSync(dir, { withFileTypes: true, recursive: true });
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const ext = entry.name.split('.').pop() ?? '';
      if (!extensions.includes(ext)) continue;
      const fullPath = join(entry.parentPath ?? dir, entry.name);
      if (fileContainsPattern(fullPath, pattern)) {
        matches.push(fullPath);
      }
    }
  } catch {
    // directory may not exist
  }
  return matches;
}

// ── Framework Check Runners ────────────────────────────────────────────────────

function runSoc2Checks(swarmDir: string, cwd: string): ComplianceCheck[] {
  const checks: ComplianceCheck[] = [];

  // SOC2-001: Audit trail exists
  const auditPath = join(swarmDir, 'audit.jsonl');
  const auditExists = existsSync(auditPath);
  let auditEntryCount = 0;
  if (auditExists) {
    try {
      const content = readFileSync(auditPath, 'utf-8').trim();
      auditEntryCount = content ? content.split('\n').length : 0;
    } catch { /* ignore */ }
  }
  checks.push({
    id: 'SOC2-001',
    requirement: 'Audit trail for all system activities',
    category: 'Monitoring',
    status: auditExists && auditEntryCount > 0 ? 'pass' : auditExists ? 'partial' : 'fail',
    evidence: auditExists ? `${auditEntryCount} audit entries in ${auditPath}` : 'No audit log found',
    remediation: auditExists ? undefined : 'Run pipeline operations to generate audit trail in .swarm/audit.jsonl',
  });

  // SOC2-002: Change management via git
  const hasGit = existsSync(join(cwd, '.git'));
  const commitCount = shellOutput('git rev-list --count HEAD 2>/dev/null');
  checks.push({
    id: 'SOC2-002',
    requirement: 'Change management with version control',
    category: 'Change Management',
    status: hasGit && commitCount && parseInt(commitCount, 10) > 0 ? 'pass' : hasGit ? 'partial' : 'fail',
    evidence: hasGit ? `Git repository with ${commitCount ?? '0'} commits` : 'No git repository found',
    remediation: hasGit ? undefined : 'Initialize git repository: git init',
  });

  // SOC2-003: Access controls (permission modes)
  const configPath = join(swarmDir, 'config.yaml');
  let hasPermissionConfig = false;
  if (existsSync(configPath)) {
    hasPermissionConfig = fileContainsPattern(configPath, /permission/i);
  }
  const statePath = join(swarmDir, 'state.json');
  let stateHasPerms = false;
  if (existsSync(statePath)) {
    stateHasPerms = fileContainsPattern(statePath, /permissionMode/);
  }
  checks.push({
    id: 'SOC2-003',
    requirement: 'Access controls and permission management',
    category: 'Access Control',
    status: hasPermissionConfig || stateHasPerms ? 'pass' : 'partial',
    evidence: hasPermissionConfig ? 'Permission configuration found in config.yaml' :
      stateHasPerms ? 'Permission modes tracked in state' : 'Default permission modes in use',
    remediation: hasPermissionConfig ? undefined : 'Configure explicit permission modes in .swarm/config.yaml',
  });

  // SOC2-004: Backup and recovery
  const backupPath = join(swarmDir, 'state.json.bak');
  checks.push({
    id: 'SOC2-004',
    requirement: 'Backup and disaster recovery procedures',
    category: 'Availability',
    status: existsSync(backupPath) ? 'pass' : 'partial',
    evidence: existsSync(backupPath) ? 'State backup file exists (state.json.bak)' : 'No state backup found',
    remediation: 'State backups are created automatically during pipeline runs',
  });

  // SOC2-005: Incident response
  const hasIncidentCmd = shellCheck('command -v swarm 2>/dev/null');
  checks.push({
    id: 'SOC2-005',
    requirement: 'Incident response procedures',
    category: 'Incident Response',
    status: existsSync(auditPath) && hasIncidentCmd ? 'pass' : 'partial',
    evidence: 'Swarm CLI provides mayday pipeline and audit trail for incident tracking',
    remediation: 'Use `swarm mayday` for automated incident response',
  });

  // SOC2-006: Monitoring and alerting
  const hasWebhooks = existsSync(configPath) && fileContainsPattern(configPath, /webhook/i);
  checks.push({
    id: 'SOC2-006',
    requirement: 'Continuous monitoring and alerting',
    category: 'Monitoring',
    status: hasWebhooks ? 'pass' : 'partial',
    evidence: hasWebhooks ? 'Webhook notifications configured' : 'No webhook alerting configured',
    remediation: 'Configure webhooks in .swarm/config.yaml for real-time alerts',
  });

  return checks;
}

function runHipaaChecks(swarmDir: string, cwd: string): ComplianceCheck[] {
  const checks: ComplianceCheck[] = [];

  // HIPAA-001: Data encryption at rest
  const encryptionFiles = searchFilesForPattern(cwd, /encrypt|cipher|aes|crypto/i, ['ts', 'js', 'py', 'go', 'rs']);
  checks.push({
    id: 'HIPAA-001',
    requirement: 'Data encryption at rest',
    category: 'Data Protection',
    status: encryptionFiles.length > 0 ? 'pass' : 'fail',
    evidence: encryptionFiles.length > 0
      ? `${encryptionFiles.length} file(s) reference encryption patterns`
      : 'No encryption patterns found in codebase',
    remediation: 'Implement data encryption at rest for sensitive data stores',
  });

  // HIPAA-002: Data encryption in transit
  const tlsFiles = searchFilesForPattern(cwd, /https|tls|ssl|wss:/i, ['ts', 'js', 'py', 'go', 'rs', 'yaml', 'yml']);
  checks.push({
    id: 'HIPAA-002',
    requirement: 'Data encryption in transit',
    category: 'Data Protection',
    status: tlsFiles.length > 0 ? 'pass' : 'partial',
    evidence: tlsFiles.length > 0
      ? `${tlsFiles.length} file(s) reference TLS/HTTPS`
      : 'No explicit TLS configuration found',
    remediation: 'Ensure all network communication uses TLS/HTTPS',
  });

  // HIPAA-003: Audit logging
  const auditPath = join(swarmDir, 'audit.jsonl');
  checks.push({
    id: 'HIPAA-003',
    requirement: 'Comprehensive audit logging of data access',
    category: 'Audit Controls',
    status: existsSync(auditPath) ? 'pass' : 'fail',
    evidence: existsSync(auditPath) ? 'Structured audit log at .swarm/audit.jsonl' : 'No audit logging found',
    remediation: 'Enable audit logging via swarm pipeline operations',
  });

  // HIPAA-004: Access controls
  const authFiles = searchFilesForPattern(cwd, /auth|rbac|acl|permission|role/i, ['ts', 'js', 'py', 'go']);
  checks.push({
    id: 'HIPAA-004',
    requirement: 'Role-based access controls',
    category: 'Access Control',
    status: authFiles.length > 0 ? 'pass' : 'partial',
    evidence: authFiles.length > 0
      ? `${authFiles.length} file(s) implement access control patterns`
      : 'Basic permission modes via CLI only',
    remediation: 'Implement role-based access controls for data handling',
  });

  // HIPAA-005: Data integrity controls
  const checksumFiles = searchFilesForPattern(cwd, /checksum|hash|integrity|sha256|md5/i, ['ts', 'js', 'py', 'go', 'rs']);
  checks.push({
    id: 'HIPAA-005',
    requirement: 'Data integrity verification',
    category: 'Data Integrity',
    status: checksumFiles.length > 0 ? 'pass' : 'partial',
    evidence: checksumFiles.length > 0
      ? `${checksumFiles.length} file(s) implement integrity checks`
      : 'No explicit integrity verification found',
    remediation: 'Implement checksums or hashes for critical data stores',
  });

  // HIPAA-006: Breach notification procedures
  const hasWebhooks = existsSync(join(swarmDir, 'config.yaml')) &&
    fileContainsPattern(join(swarmDir, 'config.yaml'), /webhook/i);
  checks.push({
    id: 'HIPAA-006',
    requirement: 'Breach notification capability',
    category: 'Breach Notification',
    status: hasWebhooks ? 'partial' : 'fail',
    evidence: hasWebhooks ? 'Webhook notifications available for alerting' : 'No notification system configured',
    remediation: 'Configure webhooks and establish breach notification procedures',
  });

  return checks;
}

function runGdprChecks(swarmDir: string, cwd: string): ComplianceCheck[] {
  const checks: ComplianceCheck[] = [];

  // GDPR-001: Data handling documentation
  const hasPrivacyDocs = searchFilesForPattern(cwd, /privacy|data.?protection|gdpr/i, ['md', 'txt', 'yaml', 'yml']);
  checks.push({
    id: 'GDPR-001',
    requirement: 'Data processing documentation',
    category: 'Documentation',
    status: hasPrivacyDocs.length > 0 ? 'pass' : 'fail',
    evidence: hasPrivacyDocs.length > 0
      ? `${hasPrivacyDocs.length} file(s) document data processing`
      : 'No data processing documentation found',
    remediation: 'Create data processing documentation (privacy policy, data inventory)',
  });

  // GDPR-002: Consent tracking
  const consentFiles = searchFilesForPattern(cwd, /consent|opt.?in|opt.?out|preference/i, ['ts', 'js', 'py', 'go']);
  checks.push({
    id: 'GDPR-002',
    requirement: 'Consent management and tracking',
    category: 'Consent',
    status: consentFiles.length > 0 ? 'pass' : 'fail',
    evidence: consentFiles.length > 0
      ? `${consentFiles.length} file(s) implement consent patterns`
      : 'No consent management found',
    remediation: 'Implement consent tracking for data collection and processing',
  });

  // GDPR-003: Right to deletion
  const deletionFiles = searchFilesForPattern(cwd, /delete|purge|erasure|forget|remove.?data/i, ['ts', 'js', 'py', 'go']);
  checks.push({
    id: 'GDPR-003',
    requirement: 'Right to erasure (data deletion capabilities)',
    category: 'Data Subject Rights',
    status: deletionFiles.length > 0 ? 'pass' : 'partial',
    evidence: deletionFiles.length > 0
      ? `${deletionFiles.length} file(s) implement deletion patterns`
      : 'No explicit data deletion capabilities found',
    remediation: 'Implement data deletion endpoints and procedures for GDPR compliance',
  });

  // GDPR-004: Data portability
  const exportFiles = searchFilesForPattern(cwd, /export|download|portab/i, ['ts', 'js', 'py', 'go']);
  checks.push({
    id: 'GDPR-004',
    requirement: 'Data portability (export capabilities)',
    category: 'Data Subject Rights',
    status: exportFiles.length > 0 ? 'pass' : 'partial',
    evidence: exportFiles.length > 0
      ? `${exportFiles.length} file(s) implement data export`
      : 'No data export capabilities found',
    remediation: 'Implement data export in machine-readable format',
  });

  // GDPR-005: Data minimization
  const configPath = join(swarmDir, 'config.yaml');
  const hasRetention = existsSync(configPath) && fileContainsPattern(configPath, /retention|ttl|expir/i);
  checks.push({
    id: 'GDPR-005',
    requirement: 'Data minimization and retention policies',
    category: 'Data Minimization',
    status: hasRetention ? 'pass' : 'partial',
    evidence: hasRetention ? 'Data retention configuration found' : 'No explicit retention policies configured',
    remediation: 'Configure data retention policies in .swarm/config.yaml',
  });

  // GDPR-006: Audit trail for data processing
  const auditPath = join(swarmDir, 'audit.jsonl');
  checks.push({
    id: 'GDPR-006',
    requirement: 'Processing activity audit trail',
    category: 'Accountability',
    status: existsSync(auditPath) ? 'pass' : 'fail',
    evidence: existsSync(auditPath) ? 'Audit log tracks processing activities' : 'No audit trail',
    remediation: 'Enable audit logging for data processing accountability',
  });

  return checks;
}

function runPciChecks(swarmDir: string, cwd: string): ComplianceCheck[] {
  const checks: ComplianceCheck[] = [];

  // PCI-001: Secret management
  const envFiles = ['.env', '.env.local', '.env.production'];
  const exposedSecrets = envFiles.filter(f => existsSync(join(cwd, f)));
  const gitignorePath = join(cwd, '.gitignore');
  let secretsIgnored = false;
  if (existsSync(gitignorePath)) {
    const gitignore = readFileSync(gitignorePath, 'utf-8');
    secretsIgnored = /\.env/i.test(gitignore);
  }
  checks.push({
    id: 'PCI-001',
    requirement: 'Secure secret and credential management',
    category: 'Secret Management',
    status: secretsIgnored ? 'pass' : exposedSecrets.length > 0 ? 'fail' : 'pass',
    evidence: secretsIgnored
      ? '.env files excluded from version control via .gitignore'
      : exposedSecrets.length > 0
        ? `Found ${exposedSecrets.length} .env file(s) — verify they are gitignored`
        : 'No .env files found in project root',
    remediation: secretsIgnored ? undefined : 'Add .env to .gitignore and use a secret manager',
  });

  // PCI-002: Encryption patterns
  const encryptionFiles = searchFilesForPattern(cwd, /encrypt|cipher|aes|crypto|bcrypt|argon/i, ['ts', 'js', 'py', 'go', 'rs']);
  checks.push({
    id: 'PCI-002',
    requirement: 'Strong encryption for cardholder data',
    category: 'Encryption',
    status: encryptionFiles.length > 0 ? 'pass' : 'fail',
    evidence: encryptionFiles.length > 0
      ? `${encryptionFiles.length} file(s) implement encryption`
      : 'No encryption patterns found',
    remediation: 'Implement encryption for sensitive data using industry-standard algorithms',
  });

  // PCI-003: Vulnerability scanning
  const hasLockfile = existsSync(join(cwd, 'package-lock.json')) || existsSync(join(cwd, 'yarn.lock')) || existsSync(join(cwd, 'pnpm-lock.yaml'));
  const auditResult = hasLockfile ? shellOutput('npm audit --json 2>/dev/null') : null;
  let vulnCount = 0;
  if (auditResult) {
    try {
      const parsed = JSON.parse(auditResult);
      vulnCount = parsed.metadata?.vulnerabilities?.high ?? 0 + (parsed.metadata?.vulnerabilities?.critical ?? 0);
    } catch { /* ignore parse errors */ }
  }
  checks.push({
    id: 'PCI-003',
    requirement: 'Regular vulnerability scanning',
    category: 'Vulnerability Management',
    status: hasLockfile ? (vulnCount === 0 ? 'pass' : 'partial') : 'not-applicable',
    evidence: hasLockfile
      ? vulnCount === 0 ? 'No high/critical vulnerabilities found' : `${vulnCount} high/critical vulnerabilities detected`
      : 'No package lock file found',
    remediation: vulnCount > 0 ? 'Run `npm audit fix` to resolve vulnerabilities' : undefined,
  });

  // PCI-004: Access logging
  const auditPath = join(swarmDir, 'audit.jsonl');
  checks.push({
    id: 'PCI-004',
    requirement: 'Access logging and monitoring',
    category: 'Logging & Monitoring',
    status: existsSync(auditPath) ? 'pass' : 'fail',
    evidence: existsSync(auditPath) ? 'Audit trail captures access events' : 'No access logging configured',
    remediation: 'Enable audit logging via swarm pipeline operations',
  });

  // PCI-005: Network security
  const firewallFiles = searchFilesForPattern(cwd, /firewall|cors|csp|helmet|rate.?limit/i, ['ts', 'js', 'py', 'go', 'yaml', 'yml']);
  checks.push({
    id: 'PCI-005',
    requirement: 'Network security controls',
    category: 'Network Security',
    status: firewallFiles.length > 0 ? 'pass' : 'partial',
    evidence: firewallFiles.length > 0
      ? `${firewallFiles.length} file(s) implement network security controls`
      : 'No explicit network security controls found',
    remediation: 'Implement CORS, rate limiting, and CSP headers',
  });

  // PCI-006: Secure development practices
  const hasGit = existsSync(join(cwd, '.git'));
  const hasCi = existsSync(join(cwd, '.github')) || existsSync(join(cwd, '.gitlab-ci.yml'));
  checks.push({
    id: 'PCI-006',
    requirement: 'Secure software development lifecycle',
    category: 'Secure Development',
    status: hasGit && hasCi ? 'pass' : hasGit ? 'partial' : 'fail',
    evidence: [
      hasGit ? 'Version control active' : null,
      hasCi ? 'CI/CD pipeline configured' : null,
    ].filter(Boolean).join('; ') || 'No SDLC controls found',
    remediation: hasCi ? undefined : 'Set up CI/CD pipeline for automated security testing',
  });

  return checks;
}

// ── Custom Checks ──────────────────────────────────────────────────────────────

function loadCustomChecks(swarmDir: string): CustomCheck[] {
  const compliancePath = join(swarmDir, 'compliance.yaml');
  if (!existsSync(compliancePath)) return [];
  try {
    const content = readFileSync(compliancePath, 'utf-8');
    const parsed = parseYaml(content);
    return (parsed?.checks ?? []) as CustomCheck[];
  } catch {
    return [];
  }
}

function runCustomChecks(swarmDir: string, cwd: string, framework: string): ComplianceCheck[] {
  const customs = loadCustomChecks(swarmDir);
  const filtered = customs.filter(c => c.framework.toLowerCase() === framework.toLowerCase());
  const results: ComplianceCheck[] = [];

  for (const custom of filtered) {
    let status: ComplianceStatus = 'fail';
    let evidence = '';

    if (custom.command) {
      const ok = shellCheck(custom.command);
      status = ok ? 'pass' : 'fail';
      evidence = ok ? `Command succeeded: ${custom.command}` : `Command failed: ${custom.command}`;
    } else if (custom.pattern && custom.path) {
      const target = join(cwd, custom.path);
      if (existsSync(target)) {
        const matches = fileContainsPattern(target, new RegExp(custom.pattern, 'i'));
        status = matches ? 'pass' : 'fail';
        evidence = matches ? `Pattern "${custom.pattern}" found in ${custom.path}` : `Pattern "${custom.pattern}" not found in ${custom.path}`;
      } else {
        evidence = `File not found: ${custom.path}`;
      }
    }

    results.push({
      id: custom.id,
      requirement: custom.requirement,
      category: custom.category,
      status,
      evidence,
      remediation: custom.description,
    });
  }

  return results;
}

// ── Report Generation ──────────────────────────────────────────────────────────

function generateReport(framework: string, checks: ComplianceCheck[], swarmDir: string): ComplianceData {
  const overallScore = calculateScore(checks);
  const gaps = checks
    .filter(c => c.status === 'fail' || c.status === 'partial')
    .map(c => ({
      requirement: c.requirement,
      severity: c.status === 'fail' ? 'high' : 'medium',
      remediation: c.remediation ?? 'Review and address this requirement',
    }));

  const data: ComplianceData = {
    framework,
    overallScore,
    checks,
    gaps,
    lastAudit: Date.now(),
  };

  // Save JSON report
  const jsonPath = join(swarmDir, 'compliance-report.json');
  writeFileSync(jsonPath, JSON.stringify(data, null, 2), 'utf-8');

  // Save Markdown report
  const mdPath = join(process.cwd(), 'COMPLIANCE-REPORT.md');
  const md = renderMarkdownReport(framework, data);
  writeFileSync(mdPath, md, 'utf-8');

  return data;
}

function renderMarkdownReport(framework: string, data: ComplianceData): string {
  const lines: string[] = [];
  const frameworkLabel = framework.toUpperCase();
  const now = new Date().toISOString();

  lines.push(`# Compliance Report: ${frameworkLabel}`);
  lines.push('');
  lines.push(`**Generated:** ${now}`);
  lines.push(`**Overall Score:** ${data.overallScore}%`);
  lines.push('');

  // Summary
  const passCount = data.checks.filter(c => c.status === 'pass').length;
  const failCount = data.checks.filter(c => c.status === 'fail').length;
  const partialCount = data.checks.filter(c => c.status === 'partial').length;
  const naCount = data.checks.filter(c => c.status === 'not-applicable').length;

  lines.push('## Summary');
  lines.push('');
  lines.push(`| Status | Count |`);
  lines.push(`|--------|-------|`);
  lines.push(`| Pass | ${passCount} |`);
  lines.push(`| Fail | ${failCount} |`);
  lines.push(`| Partial | ${partialCount} |`);
  lines.push(`| N/A | ${naCount} |`);
  lines.push('');

  // Detailed checks
  lines.push('## Detailed Checks');
  lines.push('');
  lines.push('| ID | Requirement | Category | Status | Evidence |');
  lines.push('|----|-------------|----------|--------|----------|');
  for (const c of data.checks) {
    const statusStr = c.status.toUpperCase();
    lines.push(`| ${c.id} | ${c.requirement} | ${c.category} | ${statusStr} | ${c.evidence ?? '-'} |`);
  }
  lines.push('');

  // Gaps and remediation
  if (data.gaps.length > 0) {
    lines.push('## Gaps & Remediation');
    lines.push('');
    for (const gap of data.gaps) {
      lines.push(`### ${gap.requirement}`);
      lines.push('');
      lines.push(`- **Severity:** ${gap.severity}`);
      lines.push(`- **Remediation:** ${gap.remediation}`);
      lines.push('');
    }
  }

  return lines.join('\n');
}

// ── Framework Dispatcher ───────────────────────────────────────────────────────

function runFrameworkChecks(framework: Framework, swarmDir: string, cwd: string): ComplianceCheck[] {
  let checks: ComplianceCheck[];

  switch (framework) {
    case 'soc2':
      checks = runSoc2Checks(swarmDir, cwd);
      break;
    case 'hipaa':
      checks = runHipaaChecks(swarmDir, cwd);
      break;
    case 'gdpr':
      checks = runGdprChecks(swarmDir, cwd);
      break;
    case 'pci':
      checks = runPciChecks(swarmDir, cwd);
      break;
  }

  // Append custom checks
  const customs = runCustomChecks(swarmDir, cwd, framework);
  return [...checks, ...customs];
}

// ── CLI Registration ───────────────────────────────────────────────────────────

export function registerCompliance(program: Command): void {
  const cmd = program
    .command('compliance')
    .description('Regulatory & policy compliance automation (SOC 2, HIPAA, GDPR, PCI DSS)');

  // ── swarm compliance check ──────────────────────────────────────────────────

  cmd
    .command('check')
    .description('Run all configured compliance checks')
    .option('--framework <fw>', 'Run checks for a specific framework (soc2|hipaa|gdpr|pci)')
    .option('--json', 'Output results as JSON')
    .action(async (opts) => {
      const swarmDir = requireSwarmDir();
      loadConfig();
      const cwd = process.cwd();

      const frameworks: Framework[] = opts.framework
        ? [opts.framework as Framework]
        : ['soc2', 'hipaa', 'gdpr', 'pci'];

      const allResults: Record<string, { checks: ComplianceCheck[]; score: number }> = {};

      for (const fw of frameworks) {
        const checks = runFrameworkChecks(fw, swarmDir, cwd);
        const score = calculateScore(checks);
        allResults[fw] = { checks, score };
      }

      if (opts.json) {
        console.log(JSON.stringify(allResults, null, 2));
        return;
      }

      console.log(chalk.bold('\nCompliance Check Results\n'));

      for (const [fw, result] of Object.entries(allResults)) {
        const scoreColor = result.score >= 80 ? chalk.green
          : result.score >= 50 ? chalk.yellow
          : chalk.red;

        console.log(chalk.bold(`  ${fw.toUpperCase()}`) + '  ' + scoreColor(`${result.score}%`));
        console.log(chalk.dim('  ' + '-'.repeat(50)));

        for (const check of result.checks) {
          const color = statusColor(check.status);
          console.log(`    ${color(`[${statusIcon(check.status)}]`)} ${chalk.bold(check.id)} ${check.requirement}`);
          if (check.evidence) {
            console.log(chalk.dim(`           ${check.evidence}`));
          }
          if (check.status === 'fail' && check.remediation) {
            console.log(chalk.yellow(`           Remediation: ${check.remediation}`));
          }
        }
        console.log('');
      }
    });

  // ── swarm compliance report ─────────────────────────────────────────────────

  cmd
    .command('report')
    .description('Generate a compliance report')
    .requiredOption('--framework <fw>', 'Compliance framework (soc2|hipaa|gdpr|pci)')
    .option('--json', 'Output report as JSON only')
    .action(async (opts) => {
      const swarmDir = requireSwarmDir();
      loadConfig();
      const cwd = process.cwd();
      const framework = opts.framework as Framework;

      const validFrameworks: Framework[] = ['soc2', 'hipaa', 'gdpr', 'pci'];
      if (!validFrameworks.includes(framework)) {
        console.error(chalk.red(`Invalid framework: ${framework}. Choose from: ${validFrameworks.join(', ')}`));
        process.exit(1);
      }

      console.log(chalk.dim(`Running ${framework.toUpperCase()} compliance checks...\n`));

      const checks = runFrameworkChecks(framework, swarmDir, cwd);
      const data = generateReport(framework, checks, swarmDir);

      if (opts.json) {
        console.log(JSON.stringify(data, null, 2));
        return;
      }

      const scoreColor = data.overallScore >= 80 ? chalk.green
        : data.overallScore >= 50 ? chalk.yellow
        : chalk.red;

      console.log(chalk.bold(`${framework.toUpperCase()} Compliance Report`));
      console.log(chalk.bold(`Overall Score: `) + scoreColor(`${data.overallScore}%`));
      console.log('');

      const passCount = checks.filter(c => c.status === 'pass').length;
      const failCount = checks.filter(c => c.status === 'fail').length;
      const partialCount = checks.filter(c => c.status === 'partial').length;

      console.log(`  ${chalk.green(`${passCount} passed`)}  ${chalk.red(`${failCount} failed`)}  ${chalk.yellow(`${partialCount} partial`)}`);
      console.log('');

      for (const check of checks) {
        const color = statusColor(check.status);
        console.log(`  ${color(`[${statusIcon(check.status)}]`)} ${chalk.bold(check.id)} ${check.requirement}`);
      }

      console.log('');
      console.log(chalk.dim(`Report saved to:`));
      console.log(chalk.dim(`  JSON: ${join(swarmDir, 'compliance-report.json')}`));
      console.log(chalk.dim(`  Markdown: ${join(cwd, 'COMPLIANCE-REPORT.md')}`));

      if (data.gaps.length > 0) {
        console.log('');
        console.log(chalk.bold(`Gaps requiring attention (${data.gaps.length}):`));
        for (const gap of data.gaps) {
          const sevColor = gap.severity === 'high' ? chalk.red : chalk.yellow;
          console.log(`  ${sevColor(`[${gap.severity.toUpperCase()}]`)} ${gap.requirement}`);
          console.log(chalk.dim(`           ${gap.remediation}`));
        }
      }
    });

  // ── swarm compliance monitor ────────────────────────────────────────────────

  cmd
    .command('monitor')
    .description('Continuous compliance monitoring')
    .option('--interval <minutes>', 'Check interval in minutes', '60')
    .option('--framework <fw>', 'Monitor a specific framework (soc2|hipaa|gdpr|pci)')
    .option('--fail-under <score>', 'Exit with error if score drops below threshold')
    .action(async (opts) => {
      const swarmDir = requireSwarmDir();
      loadConfig();
      const cwd = process.cwd();
      const interval = Math.max(1, parseInt(opts.interval, 10) || 60) * 60 * 1000;
      const failUnder = opts.failUnder ? parseInt(opts.failUnder, 10) : null;

      const frameworks: Framework[] = opts.framework
        ? [opts.framework as Framework]
        : ['soc2', 'hipaa', 'gdpr', 'pci'];

      console.log(chalk.bold('Compliance Monitor'));
      console.log(chalk.dim(`Monitoring: ${frameworks.map(f => f.toUpperCase()).join(', ')}`));
      console.log(chalk.dim(`Interval: ${opts.interval} minutes`));
      if (failUnder !== null) {
        console.log(chalk.dim(`Fail threshold: ${failUnder}%`));
      }
      console.log(chalk.dim('Press Ctrl+C to stop.\n'));

      const runCycle = () => {
        const timestamp = new Date().toLocaleString();
        console.log(chalk.dim(`\n--- Compliance scan at ${timestamp} ---\n`));

        let allPassing = true;

        for (const fw of frameworks) {
          const checks = runFrameworkChecks(fw, swarmDir, cwd);
          const score = calculateScore(checks);
          const failCount = checks.filter(c => c.status === 'fail').length;

          const scoreColor = score >= 80 ? chalk.green
            : score >= 50 ? chalk.yellow
            : chalk.red;

          console.log(`  ${chalk.bold(fw.toUpperCase().padEnd(6))} ${scoreColor(`${score}%`.padStart(5))}  ${chalk.green(`${checks.filter(c => c.status === 'pass').length} pass`)} ${chalk.red(`${failCount} fail`)}`);

          if (failUnder !== null && score < failUnder) {
            allPassing = false;
          }

          // Persist latest results
          const data: ComplianceData = {
            framework: fw,
            overallScore: score,
            checks,
            gaps: checks.filter(c => c.status === 'fail' || c.status === 'partial').map(c => ({
              requirement: c.requirement,
              severity: c.status === 'fail' ? 'high' : 'medium',
              remediation: c.remediation ?? 'Review and address this requirement',
            })),
            lastAudit: Date.now(),
          };
          writeFileSync(
            join(swarmDir, `compliance-${fw}.json`),
            JSON.stringify(data, null, 2),
            'utf-8',
          );
        }

        if (failUnder !== null && !allPassing) {
          console.log(chalk.red(`\nCompliance score dropped below ${failUnder}% threshold.`));
          process.exit(1);
        }
      };

      // Initial run
      runCycle();

      // Schedule recurring checks
      const timer = setInterval(runCycle, interval);

      // Graceful shutdown
      const shutdown = () => {
        clearInterval(timer);
        console.log(chalk.dim('\nCompliance monitor stopped.'));
        process.exit(0);
      };

      process.on('SIGINT', shutdown);
      process.on('SIGTERM', shutdown);
    });
}
