import { EventEmitter } from 'events';
import WebSocket from 'ws';
import type { PipelineState, WsMessage, WsCommand, Agent } from './types';

export class SwarmClient extends EventEmitter {
  private ws: WebSocket | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private _state: PipelineState | null = null;
  private _connected = false;
  private host = 'localhost';
  private port = 3847;
  private intentionalClose = false;

  get state(): PipelineState | null {
    return this._state;
  }

  get connected(): boolean {
    return this._connected;
  }

  connect(host: string, port: number): void {
    this.host = host;
    this.port = port;
    this.intentionalClose = false;
    this.doConnect();
  }

  disconnect(): void {
    this.intentionalClose = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this._connected = false;
    this.emit('disconnected');
  }

  sendCommand(cmd: WsCommand): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(cmd));
    }
  }

  getRunningAgents(): Agent[] {
    if (!this._state) { return []; }
    return this._state.agents.filter(a => a.status === 'running');
  }

  private doConnect(): void {
    if (this.ws) {
      this.ws.removeAllListeners();
      this.ws.close();
    }

    const url = `ws://${this.host}:${this.port}`;
    this.ws = new WebSocket(url);

    this.ws.on('open', () => {
      this._connected = true;
      this.emit('connected');
      // Request fresh state
      this.sendCommand({ action: 'get-state' });
    });

    this.ws.on('message', (data: WebSocket.Data) => {
      try {
        const msg: WsMessage = JSON.parse(data.toString());
        this.handleMessage(msg);
      } catch {
        // Ignore malformed messages
      }
    });

    this.ws.on('close', () => {
      this._connected = false;
      this.emit('disconnected');
      this.scheduleReconnect();
    });

    this.ws.on('error', () => {
      // Error will be followed by close event
    });
  }

  private handleMessage(msg: WsMessage): void {
    switch (msg.type) {
      case 'state':
        this._state = msg.payload;
        this.emit('state', msg.payload);
        break;

      case 'agent-update':
        if (this._state) {
          const idx = this._state.agents.findIndex(a => a.id === msg.payload.id);
          if (idx >= 0) {
            this._state.agents[idx] = msg.payload;
          } else {
            this._state.agents.push(msg.payload);
          }
        }
        this.emit('agent-update', msg.payload);
        break;

      case 'agent-output':
        this.emit('agent-output', msg.payload);
        break;

      case 'agent-activity':
        this.emit('agent-activity', msg.payload);
        break;

      case 'agent-logs':
        this.emit('agent-logs', msg.payload);
        break;

      case 'cost-update':
        this.emit('cost-update', msg.payload);
        break;
    }
  }

  private scheduleReconnect(): void {
    if (this.intentionalClose) { return; }
    if (this.reconnectTimer) { return; }
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.doConnect();
    }, 5000);
  }
}
