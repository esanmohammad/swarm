import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { join, extname } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { ApiEndpoint, BreakingChange, ContractData } from '../types.js';

function contractsPath(swarmDir: string): string {
  return join(swarmDir, 'contracts.json');
}

function readContracts(swarmDir: string): ContractData {
  const p = contractsPath(swarmDir);
  if (!existsSync(p)) {
    return { endpoints: [], breakingChanges: [], versions: [], consumers: [], lastGenerated: 0 };
  }
  try {
    return JSON.parse(readFileSync(p, 'utf-8')) as ContractData;
  } catch {
    return { endpoints: [], breakingChanges: [], versions: [], consumers: [], lastGenerated: 0 };
  }
}

function writeContracts(swarmDir: string, data: ContractData): void {
  if (!existsSync(swarmDir)) {
    mkdirSync(swarmDir, { recursive: true });
  }
  writeFileSync(contractsPath(swarmDir), JSON.stringify(data, null, 2));
}

// Route pattern detectors for common frameworks
const ROUTE_PATTERNS = [
  // Express/Koa: app.get('/path', ...) or router.post('/path', ...)
  /(?:app|router)\.(get|post|put|patch|delete)\s*\(\s*['"`]([^'"`]+)['"`]/gi,
  // Fastify: fastify.get('/path', ...)
  /fastify\.(get|post|put|patch|delete)\s*\(\s*['"`]([^'"`]+)['"`]/gi,
  // NestJS: @Get('/path'), @Post('/path')
  /@(Get|Post|Put|Patch|Delete)\s*\(\s*['"`]([^'"`]*)['"`]\s*\)/gi,
  // Go net/http: http.HandleFunc("/path", ...)
  /HandleFunc\s*\(\s*['"`]([^'"`]+)['"`]/gi,
  // Python Flask/FastAPI: @app.route('/path') or @app.get('/path')
  /@(?:app|router)\.(route|get|post|put|patch|delete)\s*\(\s*['"`]([^'"`]+)['"`]/gi,
];

function scanForRoutes(cwd: string, scope?: string): ApiEndpoint[] {
  const endpoints: ApiEndpoint[] = [];
  const scanDir = scope ? join(cwd, scope) : cwd;

  if (!existsSync(scanDir)) return endpoints;

  const sourceExts = new Set(['.ts', '.js', '.tsx', '.jsx', '.py', '.go', '.rs']);

  function walk(dir: string): void {
    // Skip node_modules, dist, .git
    const base = dir.split('/').pop() || '';
    if (['node_modules', 'dist', '.git', '.swarm', 'coverage', '__pycache__'].includes(base)) return;

    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = join(dir, entry);
      try {
        const stat = readFileSync(fullPath);
        // This is hacky — just check if it's a reasonable file
        if (entry.includes('.') && sourceExts.has(extname(entry))) {
          const content = readFileSync(fullPath, 'utf-8');
          for (const pattern of ROUTE_PATTERNS) {
            pattern.lastIndex = 0;
            let match;
            while ((match = pattern.exec(content)) !== null) {
              const method = match[1]?.toUpperCase() || 'GET';
              const path = match[2] || match[1] || '/';
              // Avoid duplicates
              if (!endpoints.some(e => e.path === path && e.method === method)) {
                endpoints.push({
                  path,
                  method: method.toUpperCase(),
                  version: 'v1',
                  consumers: [],
                });
              }
            }
          }
        }
      } catch {
        // Skip files we can't read
        try {
          const items = readdirSync(fullPath);
          if (items) walk(fullPath);
        } catch {
          // Not a directory either, skip
        }
      }
    }
  }

  walk(scanDir);
  return endpoints;
}

export class ApiLifecycleManager {
  private swarmDir: string;

  constructor(swarmDir: string) {
    this.swarmDir = swarmDir;
  }

  generateSchema(cwd: string, scope?: string): ContractData {
    const data = readContracts(this.swarmDir);
    const previousEndpoints = [...data.endpoints];

    // Scan for route definitions
    const scanned = scanForRoutes(cwd, scope);

    // Merge with existing (preserve consumer info)
    for (const ep of scanned) {
      const existing = data.endpoints.find(e => e.path === ep.path && e.method === ep.method);
      if (existing) {
        // Keep existing consumer and schema info
        ep.consumers = existing.consumers;
        ep.requestSchema = existing.requestSchema;
        ep.responseSchema = existing.responseSchema;
        ep.version = existing.version;
      }
    }

    data.endpoints = scanned;
    data.lastGenerated = Date.now();

    // Detect breaking changes vs previous
    const breaking: BreakingChange[] = [];
    for (const prev of previousEndpoints) {
      const stillExists = scanned.find(e => e.path === prev.path && e.method === prev.method);
      if (!stillExists) {
        breaking.push({
          endpoint: `${prev.method} ${prev.path}`,
          type: 'removed',
          description: `Endpoint ${prev.method} ${prev.path} was removed`,
          affectedConsumers: prev.consumers,
          severity: 'breaking',
        });
      }
    }

    data.breakingChanges = breaking;
    writeContracts(this.swarmDir, data);
    return data;
  }

  detectBreakingChanges(): BreakingChange[] {
    const data = readContracts(this.swarmDir);
    return data.breakingChanges;
  }

  publishVersion(version: string): ContractData {
    const data = readContracts(this.swarmDir);
    data.versions.push({
      version,
      endpoints: data.endpoints.length,
      publishedAt: Date.now(),
    });
    // Update all endpoints to this version
    for (const ep of data.endpoints) {
      ep.version = version;
    }
    writeContracts(this.swarmDir, data);
    return data;
  }

  addConsumer(name: string, endpoints: string[]): void {
    const data = readContracts(this.swarmDir);
    const existing = data.consumers.find(c => c.name === name);
    if (existing) {
      existing.endpoints = endpoints;
    } else {
      data.consumers.push({ name, endpoints });
    }
    // Also update endpoint consumer lists
    for (const ep of data.endpoints) {
      const key = `${ep.method} ${ep.path}`;
      if (endpoints.includes(key) && !ep.consumers.includes(name)) {
        ep.consumers.push(name);
      }
    }
    writeContracts(this.swarmDir, data);
  }

  getState(): ContractData {
    return readContracts(this.swarmDir);
  }
}
