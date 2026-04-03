import { useState, useCallback, useRef, useEffect } from 'react';
import type { WsCommand } from '../types';

export type ActionStatus = 'idle' | 'pending' | 'running' | 'success' | 'error';

export interface ActionState {
  status: ActionStatus;
  message: string;
  detail?: string;
  progress?: number; // 0-100
  elapsed: number; // ms
  cost: number;
  result?: unknown;
  error?: string;
}

interface UseActionOptions {
  onSuccess?: (result: unknown) => void;
  onError?: (error: string) => void;
  timeout?: number; // ms, default 120000
}

export interface UseActionReturn {
  state: ActionState;
  execute: (command: WsCommand, message?: string) => void;
  cancel: () => void;
  reset: () => void;
}

const INITIAL_STATE: ActionState = {
  status: 'idle',
  message: '',
  elapsed: 0,
  cost: 0,
};

export function useAction(
  sendCommand: (cmd: WsCommand) => void,
  options: UseActionOptions = {}
): UseActionReturn {
  const [state, setState] = useState<ActionState>(INITIAL_STATE);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = useRef<number>(0);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { timeout = 120000 } = options;

  const clearTimers = useCallback(() => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    if (timeoutRef.current) { clearTimeout(timeoutRef.current); timeoutRef.current = null; }
  }, []);

  // Cleanup on unmount
  useEffect(() => clearTimers, [clearTimers]);

  const execute = useCallback((command: WsCommand, message = 'Starting...') => {
    clearTimers();
    startTimeRef.current = Date.now();

    setState({
      status: 'pending',
      message,
      elapsed: 0,
      cost: 0,
    });

    // Send command
    sendCommand(command);

    // Start elapsed timer
    timerRef.current = setInterval(() => {
      setState(prev => ({
        ...prev,
        status: prev.status === 'pending' ? 'running' : prev.status,
        elapsed: Date.now() - startTimeRef.current,
      }));
    }, 500);

    // Timeout
    if (timeout > 0) {
      timeoutRef.current = setTimeout(() => {
        clearTimers();
        setState(prev => ({
          ...prev,
          status: 'error',
          error: `Operation timed out after ${Math.round(timeout / 1000)}s`,
        }));
        options.onError?.(`Operation timed out after ${Math.round(timeout / 1000)}s`);
      }, timeout);
    }
  }, [sendCommand, clearTimers, timeout, options]);

  const cancel = useCallback(() => {
    clearTimers();
    setState(prev => ({
      ...prev,
      status: 'idle',
      message: 'Cancelled',
    }));
  }, [clearTimers]);

  const reset = useCallback(() => {
    clearTimers();
    setState(INITIAL_STATE);
  }, [clearTimers]);

  return { state, execute, cancel, reset };
}

