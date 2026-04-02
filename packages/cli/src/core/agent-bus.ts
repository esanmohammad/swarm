import { EventEmitter } from 'node:events';
import type { AgentManager } from './agent-manager.js';
import type { Persona } from '../types.js';

export type BusMessageKind = 'question' | 'clarification' | 'blocker' | 'status-update';

export interface BusMessage {
  id: string;
  fromAgentId: string;
  fromPersona: Persona;
  toAgentId: string;
  toPersona: Persona;
  kind: BusMessageKind;
  content: string;
  timestamp: number;
  delivered: boolean;
}

/** Which personas can message which */
const ALLOWED_ROUTES: Record<string, string[]> = {
  engineer: ['lead', 'tester', 'architect'],
  tester: ['engineer', 'lead'],
  lead: ['engineer', 'architect', 'analyst'],
  architect: ['analyst', 'lead'],
  analyst: ['architect'],
};

const MAX_EXCHANGES_PER_PAIR = 3;

export class AgentBus extends EventEmitter {
  private messages: BusMessage[] = [];
  private exchangeCounts = new Map<string, number>();
  private queued: BusMessage[] = [];

  constructor(private agentManager: AgentManager) {
    super();
  }

  /** Send a message from one agent to another */
  sendTo(
    fromAgentId: string,
    fromPersona: Persona,
    toAgentId: string,
    toPersona: Persona,
    kind: BusMessageKind,
    content: string,
  ): BusMessage | null {
    // Validate route
    const allowed = ALLOWED_ROUTES[fromPersona] || [];
    if (!allowed.includes(toPersona)) {
      console.warn(`[agent-bus] Route denied: ${fromPersona} → ${toPersona}`);
      return null;
    }

    // Check exchange limit
    const pairKey = [fromAgentId, toAgentId].sort().join(':');
    const count = this.exchangeCounts.get(pairKey) || 0;
    if (count >= MAX_EXCHANGES_PER_PAIR) {
      console.warn(`[agent-bus] Exchange limit reached for ${pairKey} (${count}/${MAX_EXCHANGES_PER_PAIR})`);
      return null;
    }
    this.exchangeCounts.set(pairKey, count + 1);

    const msg: BusMessage = {
      id: `bus-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      fromAgentId,
      fromPersona,
      toAgentId,
      toPersona,
      kind,
      content,
      timestamp: Date.now(),
      delivered: false,
    };

    this.messages.push(msg);
    this.emit('message', msg);

    // Try to deliver immediately
    this.deliver(msg);

    return msg;
  }

  /** Broadcast a message to all running agents */
  broadcast(fromAgentId: string, fromPersona: Persona, content: string): void {
    const agents = this.agentManager.listAgents?.() || [];
    for (const agent of agents) {
      if (agent.id !== fromAgentId && agent.status === 'running') {
        this.sendTo(fromAgentId, fromPersona, agent.id, agent.persona, 'status-update', content);
      }
    }
  }

  /** Get all messages (for dashboard) */
  getMessages(): BusMessage[] {
    return [...this.messages];
  }

  /** Get messages for a specific agent */
  getMessagesFor(agentId: string): BusMessage[] {
    return this.messages.filter(m => m.toAgentId === agentId);
  }

  /** Clear all messages */
  clear(): void {
    this.messages = [];
    this.queued = [];
    this.exchangeCounts.clear();
  }

  /** Attempt to deliver a message to the target agent */
  private deliver(msg: BusMessage): void {
    const agent = this.agentManager.getAgent?.(msg.toAgentId);
    if (!agent) {
      this.queued.push(msg);
      return;
    }

    // If agent is done (waiting), deliver via sendInput
    if (agent.status === 'done' || agent.status === 'running') {
      const formatted = this.formatMessage(msg);
      try {
        this.agentManager.sendInput(msg.toAgentId, formatted);
        msg.delivered = true;
        this.emit('delivered', msg);
      } catch {
        // Queue for later
        this.queued.push(msg);
      }
    } else {
      this.queued.push(msg);
    }
  }

  /** Try to deliver queued messages (call after agent status changes) */
  deliverQueued(): void {
    const remaining: BusMessage[] = [];
    for (const msg of this.queued) {
      if (msg.delivered) continue;
      const agent = this.agentManager.getAgent?.(msg.toAgentId);
      if (agent && (agent.status === 'done' || agent.status === 'running')) {
        try {
          this.agentManager.sendInput(msg.toAgentId, this.formatMessage(msg));
          msg.delivered = true;
          this.emit('delivered', msg);
        } catch {
          remaining.push(msg);
        }
      } else {
        remaining.push(msg);
      }
    }
    this.queued = remaining;
  }

  private formatMessage(msg: BusMessage): string {
    const kindLabel = msg.kind.replace('-', ' ').toUpperCase();
    return `[INTER-AGENT MESSAGE — ${kindLabel}]\nFrom: ${msg.fromPersona} (agent ${msg.fromAgentId.slice(0, 8)})\n\n${msg.content}\n\nPlease respond to this message as part of your current work. Stay within your role boundaries.`;
  }
}
