import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import chalk from 'chalk';
import open from 'open';
import type { Command } from 'commander';
import { loadConfig, requireSwarmDir } from '../core/config.js';
import { createContext } from './shared.js';

export function registerDashboard(program: Command): void {
  program
    .command('dashboard')
    .description('Open the Swarm dashboard in your browser')
    .option('--no-open', 'Do not auto-open the browser')
    .action(async (opts) => {
      const swarmDir = requireSwarmDir();
      const config = loadConfig();
      const { state, wsServer, cleanup } = createContext(swarmDir, config);

      // Kill any orphaned claude processes from previous sessions, then clean state
      state.killOrphanProcesses();
      state.cleanupStaleAgents();

      // Generate auth token for WebSocket connections
      const wsToken = randomBytes(32).toString('hex');

      // Start WebSocket server with auth token
      wsServer.start(config.wsPort, wsToken);
      console.log(chalk.dim(`WebSocket server on ws://localhost:${config.wsPort}`));

      // Try to serve built dashboard
      const __dirname = dirname(fileURLToPath(import.meta.url));
      const dashboardDist = join(__dirname, '..', '..', '..', '..', 'dashboard', 'dist');
      const dashboardIndex = join(dashboardDist, 'index.html');

      if (existsSync(dashboardIndex)) {
        // Inject WS port into index.html so the dashboard knows where to connect
        const rawHtml = readFileSync(dashboardIndex, 'utf-8');
        const injectedHtml = rawHtml.replace(
          '<head>',
          `<head><script>window.__SWARM_WS_PORT__=${config.wsPort};window.__SWARM_WS_TOKEN__="${wsToken}";</script>`,
        );

        // Serve static dashboard
        const server = createServer((req, res) => {
          const url = req.url === '/' ? '/index.html' : req.url!;
          const filePath = join(dashboardDist, url);

          // Serve injected index.html for root and SPA fallback
          if (url === '/index.html') {
            res.setHeader('Content-Type', 'text/html');
            res.end(injectedHtml);
          } else if (existsSync(filePath)) {
            const ext = filePath.split('.').pop();
            const contentTypes: Record<string, string> = {
              html: 'text/html',
              js: 'application/javascript',
              css: 'text/css',
              json: 'application/json',
              svg: 'image/svg+xml',
              png: 'image/png',
            };
            res.setHeader('Content-Type', contentTypes[ext!] || 'application/octet-stream');
            res.end(readFileSync(filePath));
          } else {
            // SPA fallback
            res.setHeader('Content-Type', 'text/html');
            res.end(injectedHtml);
          }
        });

        server.listen(config.dashboardPort, () => {
          const url = `http://localhost:${config.dashboardPort}`;
          console.log(chalk.green(`Dashboard running at ${chalk.bold(url)}`));

          if (opts.open !== false) {
            open(url);
          }

          console.log(chalk.dim('Press Ctrl+C to stop'));
        });

        process.on('SIGINT', () => {
          server.close();
          cleanup();
          process.exit(0);
        });
      } else {
        console.log(chalk.yellow('Dashboard not built. Run: npm run build:dashboard'));
        console.log(chalk.dim(`WebSocket server still running on port ${config.wsPort}`));
        console.log(chalk.dim('Press Ctrl+C to stop'));

        // Keep process alive
        process.on('SIGINT', () => {
          cleanup();
          process.exit(0);
        });
      }
    });
}
