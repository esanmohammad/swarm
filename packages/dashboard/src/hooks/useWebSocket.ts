import { useState, useEffect, useRef, useCallback } from 'react';
import type { PipelineState, WsMessage, WsCommand, GuardrailViolation, AgentActivity } from '../types';

// WS port is injected by the dashboard HTTP server into window.__SWARM_WS_PORT__
// Falls back to deriving from dashboard port (wsPort = dashboardPort - 1) or default 3847
const wsPort = (window as unknown as Record<string, unknown>).__SWARM_WS_PORT__
  ?? (parseInt(new URLSearchParams(window.location.search).get('wsPort') || '', 10)
  || (window.location.port ? parseInt(window.location.port, 10) - 1 : 3847));
const wsToken = (window as unknown as Record<string, unknown>).__SWARM_WS_TOKEN__ as string | undefined;
const WS_URL = wsToken
  ? `ws://${window.location.hostname}:${wsPort}?token=${wsToken}`
  : `ws://${window.location.hostname}:${wsPort}`;
const RECONNECT_DELAY = 2000;
const MAX_RECONNECT_DELAY = 30000;

interface UseWebSocketReturn {
  state: PipelineState | null;
  connected: boolean;
  agentOutputs: Map<string, string>;
  agentActivities: Map<string, AgentActivity[]>;
  violations: GuardrailViolation[];
  sendCommand: (cmd: WsCommand) => void;
}

export function useWebSocket(): UseWebSocketReturn {
  const [state, setState] = useState<PipelineState | null>(null);
  const [connected, setConnected] = useState(false);
  const [violations, setViolations] = useState<GuardrailViolation[]>([]);
  const agentOutputsRef = useRef(new Map<string, string>());
  const agentActivitiesRef = useRef(new Map<string, AgentActivity[]>());
  const [, forceUpdate] = useState(0);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectDelay = useRef(RECONNECT_DELAY);

  const connect = useCallback(() => {
    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      reconnectDelay.current = RECONNECT_DELAY;
    };

    ws.onclose = () => {
      setConnected(false);
      // Auto-reconnect with exponential backoff
      setTimeout(() => {
        reconnectDelay.current = Math.min(reconnectDelay.current * 1.5, MAX_RECONNECT_DELAY);
        connect();
      }, reconnectDelay.current);
    };

    ws.onerror = () => {
      ws.close();
    };

    ws.onmessage = (event) => {
      try {
        const msg: WsMessage = JSON.parse(event.data);

        switch (msg.type) {
          case 'state':
            setState(msg.payload);
            // Load violations from state (e.g. from evaluate command run in another terminal)
            if (msg.payload.violations && msg.payload.violations.length > 0) {
              setViolations(msg.payload.violations);
            }
            break;

          case 'agent-update':
            setState((prev) => {
              if (!prev) return prev;
              const agents = prev.agents.map((a) =>
                a.id === msg.payload.id ? msg.payload : a,
              );
              if (!agents.find((a) => a.id === msg.payload.id)) {
                agents.push(msg.payload);
              }
              return { ...prev, agents };
            });
            break;

          case 'agent-output':
            agentOutputsRef.current.set(
              msg.payload.agentId,
              (agentOutputsRef.current.get(msg.payload.agentId) || '') + msg.payload.chunk,
            );
            forceUpdate((n) => n + 1);
            break;

          case 'agent-activity': {
            const aid = msg.payload.agentId;
            const existing = agentActivitiesRef.current.get(aid) || [];
            // Keep last 200 activities per agent to avoid unbounded growth
            const updated = [...existing, msg.payload].slice(-200);
            agentActivitiesRef.current.set(aid, updated);
            forceUpdate((n) => n + 1);
            break;
          }

          case 'guardrail-alert':
            setViolations((prev) => [...prev, msg.payload]);
            break;

          case 'cost-update':
            setState((prev) => prev ? { ...prev, totalCost: msg.payload } : prev);
            break;
        }
      } catch {
        // ignore malformed messages
      }
    };
  }, []);

  useEffect(() => {
    connect();
    return () => {
      wsRef.current?.close();
    };
  }, [connect]);

  const sendCommand = useCallback((cmd: WsCommand) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(cmd));
    }
  }, []);

  return {
    state,
    connected,
    agentOutputs: agentOutputsRef.current,
    agentActivities: agentActivitiesRef.current,
    violations,
    sendCommand,
  };
}
