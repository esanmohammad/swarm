import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';
import type { ActionState } from '../hooks/useAction';

interface ActiveAction {
  id: string;
  type: string;
  label: string;
  state: ActionState;
  triggeredFrom: string;
  startedAt: number;
  agentId?: string;
}

interface ActionsContextValue {
  activeActions: ActiveAction[];
  recentActions: ActiveAction[];
  registerAction: (action: Omit<ActiveAction, 'startedAt'>) => void;
  updateAction: (id: string, updates: Partial<ActionState>) => void;
  completeAction: (id: string, result?: unknown) => void;
  failAction: (id: string, error: string) => void;
  removeAction: (id: string) => void;
  runningCount: number;
}

const ActionsContext = createContext<ActionsContextValue | null>(null);

export function ActionsProvider({ children }: { children: ReactNode }) {
  const [actions, setActions] = useState<ActiveAction[]>([]);
  const [recentActions, setRecentActions] = useState<ActiveAction[]>(() => {
    try {
      const stored = sessionStorage.getItem('swarm_recent_actions');
      return stored ? JSON.parse(stored) : [];
    } catch { return []; }
  });

  const registerAction = useCallback((action: Omit<ActiveAction, 'startedAt'>) => {
    const newAction: ActiveAction = { ...action, startedAt: Date.now() };
    setActions(prev => [...prev, newAction]);
  }, []);

  const updateAction = useCallback((id: string, updates: Partial<ActionState>) => {
    setActions(prev => prev.map(a =>
      a.id === id ? { ...a, state: { ...a.state, ...updates } } : a
    ));
  }, []);

  const completeAction = useCallback((id: string, result?: unknown) => {
    setActions(prev => {
      const action = prev.find(a => a.id === id);
      if (action) {
        const completed = { ...action, state: { ...action.state, status: 'success' as const, result } };
        setRecentActions(recent => {
          const updated = [completed, ...recent].slice(0, 20);
          try { sessionStorage.setItem('swarm_recent_actions', JSON.stringify(updated)); } catch {}
          return updated;
        });
      }
      return prev.filter(a => a.id !== id);
    });
  }, []);

  const failAction = useCallback((id: string, error: string) => {
    setActions(prev => {
      const action = prev.find(a => a.id === id);
      if (action) {
        const failed = { ...action, state: { ...action.state, status: 'error' as const, error } };
        setRecentActions(recent => {
          const updated = [failed, ...recent].slice(0, 20);
          try { sessionStorage.setItem('swarm_recent_actions', JSON.stringify(updated)); } catch {}
          return updated;
        });
      }
      return prev.filter(a => a.id !== id);
    });
  }, []);

  const removeAction = useCallback((id: string) => {
    setActions(prev => prev.filter(a => a.id !== id));
  }, []);

  const runningCount = actions.filter(a => a.state.status === 'running' || a.state.status === 'pending').length;

  return (
    <ActionsContext.Provider value={{ activeActions: actions, recentActions, registerAction, updateAction, completeAction, failAction, removeAction, runningCount }}>
      {children}
    </ActionsContext.Provider>
  );
}

export function useActions(): ActionsContextValue {
  const ctx = useContext(ActionsContext);
  if (!ctx) throw new Error('useActions must be used within ActionsProvider');
  return ctx;
}
