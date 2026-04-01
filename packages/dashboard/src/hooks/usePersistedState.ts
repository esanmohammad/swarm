import { useState, useCallback } from 'react';

/**
 * Like useState, but persists the value to localStorage.
 * Falls back to regular state if localStorage is unavailable.
 */
export function usePersistedState<T>(key: string, defaultValue: T): [T, (value: T | ((prev: T) => T)) => void] {
  const [state, setState] = useState<T>(() => {
    try {
      const stored = localStorage.getItem(key);
      if (stored !== null) return JSON.parse(stored) as T;
    } catch {
      // localStorage not available or invalid JSON
    }
    return defaultValue;
  });

  const setPersistedState = useCallback((value: T | ((prev: T) => T)) => {
    setState((prev) => {
      const next = typeof value === 'function' ? (value as (prev: T) => T)(prev) : value;
      try {
        localStorage.setItem(key, JSON.stringify(next));
      } catch {
        // localStorage not available
      }
      return next;
    });
  }, [key]);

  return [state, setPersistedState];
}
