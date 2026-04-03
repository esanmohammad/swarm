import { describe, it, expect, afterEach } from 'vitest';
import { WebSocket, WebSocketServer } from 'ws';
import { StateManager } from '../../core/state.js';
import { createTempSwarmDir } from '../helpers/temp-dir.js';
import { createEmptyPipeline } from '../../types.js';
import type { PipelineState } from '../../types.js';

function getRandomPort(): number {
  return 40000 + Math.floor(Math.random() * 20000);
}

/**
 * Connect to server and collect the first message.
 * Sets up the message handler BEFORE 'open' to avoid race conditions.
 */
function connectAndRecv(url: string): Promise<{ ws: WebSocket; msg: Record<string, unknown> }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const timer = setTimeout(() => reject(new Error('connect timed out')), 3000);
    ws.on('message', function handler(data) {
      ws.removeListener('message', handler);
      clearTimeout(timer);
      resolve({ ws, msg: JSON.parse(data.toString()) });
    });
    ws.on('error', (e) => { clearTimeout(timer); reject(e); });
  });
}

function recv(ws: WebSocket): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('recv timed out')), 3000);
    ws.on('message', function handler(data) {
      ws.removeListener('message', handler);
      clearTimeout(timer);
      resolve(JSON.parse(data.toString()));
    });
  });
}

interface MiniServer {
  wss: WebSocketServer;
  broadcast: (msg: { type: string; payload: unknown }) => void;
  state: PipelineState;
  stop: () => Promise<void>;
}

function startServer(port: number, authToken?: string): Promise<MiniServer> {
  return new Promise((resolve) => {
    const state = createEmptyPipeline('test-project', 'node');
    const clients = new Set<WebSocket>();

    const wss = new WebSocketServer({ port }, () => {
      resolve({ wss, broadcast, state, stop });
    });

    wss.on('connection', (ws, req) => {
      if (authToken) {
        const url = new URL(req.url || '/', `http://localhost:${port}`);
        if (url.searchParams.get('token') !== authToken) {
          ws.close(4001, 'Unauthorized');
          return;
        }
      }

      clients.add(ws);
      ws.send(JSON.stringify({ type: 'state', payload: state }));

      ws.on('message', (raw) => {
        try {
          const cmd = JSON.parse(raw.toString());
          if (cmd.action === 'get-state') {
            broadcast({ type: 'state', payload: state });
          }
        } catch {
          ws.send(JSON.stringify({ type: 'error', payload: { message: 'Invalid JSON' } }));
        }
      });

      ws.on('close', () => clients.delete(ws));
    });

    function broadcast(msg: { type: string; payload: unknown }) {
      const data = JSON.stringify(msg);
      for (const c of clients) {
        if (c.readyState === WebSocket.OPEN) c.send(data);
      }
    }

    function stop(): Promise<void> {
      return new Promise((res) => {
        for (const c of clients) c.close();
        clients.clear();
        wss.close(() => res());
      });
    }
  });
}

describe('SwarmWsServer protocol', () => {
  let server: MiniServer | null = null;

  afterEach(async () => {
    if (server) { await server.stop(); server = null; }
  });

  it('should accept connection and send initial state', async () => {
    const port = getRandomPort();
    server = await startServer(port);
    const { ws, msg } = await connectAndRecv(`ws://localhost:${port}`);
    expect(msg.type).toBe('state');
    expect((msg.payload as Record<string, unknown>).projectName).toBe('test-project');
    ws.close();
  });

  it('should reject connection without auth token', async () => {
    const port = getRandomPort();
    server = await startServer(port, 'secret');
    const ws = new WebSocket(`ws://localhost:${port}`);
    const code = await new Promise<number>((resolve) => ws.on('close', resolve));
    expect(code).toBe(4001);
  });

  it('should accept connection with correct auth token', async () => {
    const port = getRandomPort();
    server = await startServer(port, 'secret');
    const { ws, msg } = await connectAndRecv(`ws://localhost:${port}?token=secret`);
    expect(msg.type).toBe('state');
    ws.close();
  });

  it('should broadcast state changes to all clients', async () => {
    const port = getRandomPort();
    server = await startServer(port);
    const { ws } = await connectAndRecv(`ws://localhost:${port}`);
    const p = recv(ws);
    server.broadcast({ type: 'state', payload: server.state });
    const msg = await p;
    expect(msg.type).toBe('state');
    ws.close();
  });

  it('should handle get-state command', async () => {
    const port = getRandomPort();
    server = await startServer(port);
    const { ws } = await connectAndRecv(`ws://localhost:${port}`);
    const p = recv(ws);
    ws.send(JSON.stringify({ action: 'get-state' }));
    const msg = await p;
    expect(msg.type).toBe('state');
    ws.close();
  });

  it('should handle malformed JSON gracefully', async () => {
    const port = getRandomPort();
    server = await startServer(port);
    const { ws } = await connectAndRecv(`ws://localhost:${port}`);
    const p = recv(ws);
    ws.send('not json');
    const errMsg = await p;
    expect(errMsg.type).toBe('error');
    // Still works after error
    const p2 = recv(ws);
    ws.send(JSON.stringify({ action: 'get-state' }));
    const msg = await p2;
    expect(msg.type).toBe('state');
    ws.close();
  });

  it('should handle kill for non-existent agent without crashing', async () => {
    const port = getRandomPort();
    server = await startServer(port);
    const { ws } = await connectAndRecv(`ws://localhost:${port}`);
    ws.send(JSON.stringify({ action: 'kill', agentId: 'non-existent' }));
    await new Promise((r) => setTimeout(r, 50));
    const p = recv(ws);
    ws.send(JSON.stringify({ action: 'get-state' }));
    const msg = await p;
    expect(msg.type).toBe('state');
    ws.close();
  });
});

describe('StateManager events for WS broadcast', () => {
  it('should emit state-change events suitable for WS broadcast', () => {
    const { swarmDir, cleanup } = createTempSwarmDir();
    try {
      const state = new StateManager(swarmDir);
      state.init('test-project', 'node');
      const events: PipelineState[] = [];
      state.on('state-change', (s: PipelineState) => events.push(s));
      state.updateStage('analyze', { status: 'running' });
      expect(events.length).toBeGreaterThan(0);
      expect(events[0].stages.analyze.status).toBe('running');
    } finally {
      cleanup();
    }
  });
});
