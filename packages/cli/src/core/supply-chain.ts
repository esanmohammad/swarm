import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Popular packages to check for typosquatting */
const POPULAR_PACKAGES = [
  'react', 'react-dom', 'express', 'lodash', 'axios', 'moment', 'chalk',
  'commander', 'webpack', 'typescript', 'eslint', 'prettier', 'jest',
  'mocha', 'next', 'vue', 'angular', 'svelte', 'tailwindcss', 'vite',
  'esbuild', 'rollup', 'babel', 'postcss', 'autoprefixer', 'nodemon',
  'dotenv', 'cors', 'helmet', 'mongoose', 'sequelize', 'prisma',
  'socket.io', 'redis', 'pg', 'mysql2', 'sqlite3', 'uuid', 'zod',
  'yup', 'joi', 'ajv', 'fastify', 'koa', 'hapi', 'nest', 'nuxt',
  'remix', 'gatsby', 'storybook', 'cypress', 'playwright', 'puppeteer',
  'underscore', 'ramda', 'rxjs', 'date-fns', 'dayjs', 'luxon',
];

/** Levenshtein distance between two strings */
function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));

  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }

  return dp[m][n];
}

export interface PackageCheck {
  name: string;
  passed: boolean;
  detail: string;
}

export interface PackageVerification {
  name: string;
  version: string;
  status: 'safe' | 'warning' | 'blocked';
  checks: PackageCheck[];
}

interface NpmViewData {
  name?: string;
  version?: string;
  time?: Record<string, string>;
  maintainers?: Array<string | { name: string; email?: string }>;
  scripts?: Record<string, string>;
  dist?: { tarball?: string; shasum?: string; integrity?: string };
  'dist-tags'?: Record<string, string>;
}

interface NpmDownloadsData {
  downloads?: number;
  package?: string;
}

interface AllowDenyLists {
  allowed: Set<string> | null;
  denied: Set<string>;
}

function loadYamlList(filePath: string): string[] {
  if (!existsSync(filePath)) return [];
  const raw = readFileSync(filePath, 'utf-8');
  // Simple YAML list parser — handles lines starting with "- "
  return raw
    .split('\n')
    .map(l => l.trim())
    .filter(l => l.startsWith('- '))
    .map(l => l.slice(2).trim().replace(/^["']|["']$/g, ''));
}

function loadAllowDenyLists(cwd: string): AllowDenyLists {
  const swarmDir = join(cwd, '.swarm');
  const allowedPath = join(swarmDir, 'allowed-packages.yaml');
  const deniedPath = join(swarmDir, 'denied-packages.yaml');

  const allowedList = loadYamlList(allowedPath);
  const deniedList = loadYamlList(deniedPath);

  return {
    allowed: allowedList.length > 0 ? new Set(allowedList) : null,
    denied: new Set(deniedList),
  };
}

function queryNpmView(name: string, version?: string): NpmViewData | null {
  const target = version ? `${name}@${version}` : name;
  try {
    const raw = execSync(`npm view ${target} --json 2>/dev/null`, {
      encoding: 'utf-8',
      timeout: 30000,
    });
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function queryNpmDownloads(name: string): number {
  try {
    const apiRaw = execSync(
      `curl -s "https://api.npmjs.org/downloads/point/last-week/${encodeURIComponent(name)}"`,
      { encoding: 'utf-8', timeout: 15000 },
    );
    const data: NpmDownloadsData = JSON.parse(apiRaw);
    return data.downloads ?? 0;
  } catch {
    return -1; // Unable to determine
  }
}

export class SupplyChainGuard {
  private lists: AllowDenyLists;

  constructor(private cwd: string) {
    this.lists = loadAllowDenyLists(cwd);
  }

  /** Verify a single package before install */
  verifyPackage(name: string, version?: string): PackageVerification {
    const checks: PackageCheck[] = [];
    let hasWarning = false;
    let hasBlock = false;

    // Check 7a: Denylist
    if (this.lists.denied.has(name)) {
      checks.push({ name: 'denylist', passed: false, detail: `Package "${name}" is on the deny list` });
      hasBlock = true;
    } else {
      checks.push({ name: 'denylist', passed: true, detail: 'Not on deny list' });
    }

    // Check 7b: Allowlist (if allowlist exists, package must be on it)
    if (this.lists.allowed !== null) {
      if (this.lists.allowed.has(name)) {
        checks.push({ name: 'allowlist', passed: true, detail: 'Package is on the allow list' });
      } else {
        checks.push({ name: 'allowlist', passed: false, detail: `Package "${name}" is not on the allow list` });
        hasBlock = true;
      }
    }

    // Check 1: Existence — verify package exists on npm registry
    const npmData = queryNpmView(name, version);
    if (!npmData) {
      checks.push({ name: 'existence', passed: false, detail: `Package "${name}" not found on npm registry` });
      return {
        name,
        version: version || 'unknown',
        status: 'blocked',
        checks,
      };
    }
    checks.push({ name: 'existence', passed: true, detail: 'Package exists on npm registry' });

    const resolvedVersion = version || npmData.version || 'latest';

    // Check 2: Age — warn if package created less than 30 days ago
    if (npmData.time) {
      const createdStr = npmData.time.created || npmData.time[resolvedVersion];
      if (createdStr) {
        const createdDate = new Date(createdStr);
        const ageMs = Date.now() - createdDate.getTime();
        const ageDays = Math.floor(ageMs / (1000 * 60 * 60 * 24));
        if (ageDays < 30) {
          checks.push({ name: 'age', passed: false, detail: `Package is only ${ageDays} days old (created ${createdStr})` });
          hasWarning = true;
        } else {
          checks.push({ name: 'age', passed: true, detail: `Package is ${ageDays} days old` });
        }
      } else {
        checks.push({ name: 'age', passed: true, detail: 'Could not determine creation date; skipping age check' });
      }
    } else {
      checks.push({ name: 'age', passed: true, detail: 'No time information available; skipping age check' });
    }

    // Check 3: Popularity — warn if weekly downloads < 100
    const downloads = queryNpmDownloads(name);
    if (downloads >= 0) {
      if (downloads < 100) {
        checks.push({ name: 'popularity', passed: false, detail: `Only ${downloads} weekly downloads` });
        hasWarning = true;
      } else {
        checks.push({ name: 'popularity', passed: true, detail: `${downloads.toLocaleString()} weekly downloads` });
      }
    } else {
      checks.push({ name: 'popularity', passed: true, detail: 'Could not query download stats; skipping popularity check' });
    }

    // Check 4: Maintainer count — warn if only 1 maintainer
    if (npmData.maintainers) {
      const count = npmData.maintainers.length;
      if (count <= 1) {
        checks.push({ name: 'maintainers', passed: false, detail: `Only ${count} maintainer(s)` });
        hasWarning = true;
      } else {
        checks.push({ name: 'maintainers', passed: true, detail: `${count} maintainers` });
      }
    } else {
      checks.push({ name: 'maintainers', passed: true, detail: 'Maintainer info not available; skipping' });
    }

    // Check 5: Typosquatting — check Levenshtein distance against popular packages
    const typoMatches: string[] = [];
    for (const popular of POPULAR_PACKAGES) {
      if (popular === name) continue; // Exact match is fine
      const dist = levenshtein(name, popular);
      // Flag if distance is 1 or 2 (very close to a popular package)
      if (dist > 0 && dist <= 2) {
        typoMatches.push(popular);
      }
    }
    if (typoMatches.length > 0) {
      checks.push({
        name: 'typosquatting',
        passed: false,
        detail: `Name is suspiciously similar to: ${typoMatches.join(', ')}`,
      });
      hasWarning = true;
    } else {
      checks.push({ name: 'typosquatting', passed: true, detail: 'No typosquatting risk detected' });
    }

    // Check 6: Install scripts — warn if preinstall, postinstall, install scripts exist
    if (npmData.scripts) {
      const dangerousScripts = ['preinstall', 'postinstall', 'install'].filter(
        s => npmData.scripts![s],
      );
      if (dangerousScripts.length > 0) {
        checks.push({
          name: 'install-scripts',
          passed: false,
          detail: `Has install scripts: ${dangerousScripts.join(', ')}`,
        });
        hasWarning = true;
      } else {
        checks.push({ name: 'install-scripts', passed: true, detail: 'No install scripts' });
      }
    } else {
      checks.push({ name: 'install-scripts', passed: true, detail: 'No scripts defined' });
    }

    const status = hasBlock ? 'blocked' : hasWarning ? 'warning' : 'safe';

    return {
      name,
      version: resolvedVersion,
      status,
      checks,
    };
  }

  /** Verify all dependencies in package.json */
  verifyAll(): PackageVerification[] {
    const pkgPath = join(this.cwd, 'package.json');
    if (!existsSync(pkgPath)) {
      return [];
    }

    let pkg: { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
    try {
      pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
    } catch {
      return [];
    }

    const allDeps: Array<{ name: string; version: string }> = [];

    if (pkg.dependencies) {
      for (const [name, ver] of Object.entries(pkg.dependencies)) {
        allDeps.push({ name, version: ver.replace(/^[\^~>=<]/, '') });
      }
    }
    if (pkg.devDependencies) {
      for (const [name, ver] of Object.entries(pkg.devDependencies)) {
        allDeps.push({ name, version: ver.replace(/^[\^~>=<]/, '') });
      }
    }

    return allDeps.map(dep => this.verifyPackage(dep.name, dep.version));
  }

  /** Check lockfile integrity */
  checkLockfile(): { valid: boolean; issues: string[] } {
    const issues: string[] = [];

    // Check for package-lock.json
    const lockPath = join(this.cwd, 'package-lock.json');
    const yarnLockPath = join(this.cwd, 'yarn.lock');
    const pnpmLockPath = join(this.cwd, 'pnpm-lock.yaml');

    const hasNpmLock = existsSync(lockPath);
    const hasYarnLock = existsSync(yarnLockPath);
    const hasPnpmLock = existsSync(pnpmLockPath);

    if (!hasNpmLock && !hasYarnLock && !hasPnpmLock) {
      issues.push('No lockfile found (package-lock.json, yarn.lock, or pnpm-lock.yaml)');
      return { valid: false, issues };
    }

    // Check for multiple lockfiles (conflicting)
    const lockCount = [hasNpmLock, hasYarnLock, hasPnpmLock].filter(Boolean).length;
    if (lockCount > 1) {
      issues.push('Multiple lockfiles detected — this can cause inconsistent installs');
    }

    // For npm: verify lockfile is in sync with package.json
    if (hasNpmLock) {
      try {
        // npm ci will fail if lockfile is out of sync — use --dry-run to check
        execSync('npm ls --all --json 2>/dev/null', {
          cwd: this.cwd,
          encoding: 'utf-8',
          timeout: 60000,
        });
      } catch (err: unknown) {
        const execErr = err as { stdout?: string };
        if (execErr.stdout) {
          try {
            const lsData = JSON.parse(execErr.stdout);
            if (lsData.problems && Array.isArray(lsData.problems)) {
              for (const problem of lsData.problems.slice(0, 10)) {
                issues.push(String(problem));
              }
            }
          } catch {
            issues.push('Lockfile may be out of sync with package.json (npm ls failed)');
          }
        } else {
          issues.push('Lockfile may be out of sync with package.json (npm ls failed)');
        }
      }

      // Check lockfile integrity hash
      try {
        const lockContent = readFileSync(lockPath, 'utf-8');
        const lockData = JSON.parse(lockContent);

        // Verify lockfileVersion is modern (2 or 3)
        if (lockData.lockfileVersion && lockData.lockfileVersion < 2) {
          issues.push(`Lockfile version ${lockData.lockfileVersion} is outdated — consider upgrading to v2+`);
        }

        // Check for packages with resolved URLs pointing to non-registry sources
        const packages = lockData.packages || {};
        for (const [pkgPath, pkgInfo] of Object.entries(packages)) {
          const info = pkgInfo as { resolved?: string; integrity?: string };
          if (info.resolved && !info.resolved.startsWith('https://registry.npmjs.org/')) {
            if (pkgPath && !pkgPath.startsWith('node_modules/')) continue; // skip root
            if (info.resolved.startsWith('file:')) continue; // local packages are ok in monorepos
            issues.push(`Non-registry source for ${pkgPath || 'root'}: ${info.resolved}`);
          }
          // Check for missing integrity hash
          if (pkgPath && !pkgPath.startsWith('') && !info.integrity && info.resolved) {
            // Only flag external packages without integrity
            if (!info.resolved.startsWith('file:')) {
              issues.push(`Missing integrity hash for ${pkgPath}`);
            }
          }
        }
      } catch {
        issues.push('Could not parse package-lock.json');
      }
    }

    return {
      valid: issues.length === 0,
      issues,
    };
  }
}
