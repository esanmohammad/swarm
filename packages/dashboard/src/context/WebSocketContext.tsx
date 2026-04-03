import { createContext, useContext, type ReactNode } from 'react';
import { useWebSocket } from '../hooks/useWebSocket';

// Re-export the hook's return type
type WsContextValue = ReturnType<typeof useWebSocket>;

const WebSocketContext = createContext<WsContextValue | null>(null);

export function WebSocketProvider({ children }: { children: ReactNode }) {
  const ws = useWebSocket();
  return (
    <WebSocketContext.Provider value={ws}>
      {children}
    </WebSocketContext.Provider>
  );
}

export function useWs(): WsContextValue {
  const ctx = useContext(WebSocketContext);
  if (!ctx) throw new Error('useWs must be used within WebSocketProvider');
  return ctx;
}
