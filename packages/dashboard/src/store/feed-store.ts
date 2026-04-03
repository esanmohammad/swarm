import { useSyncExternalStore, useCallback } from 'react';

const STORAGE_KEY = 'hivemind_selected';

// Module-level state
let _selectedId: string | null = (() => {
  try { return localStorage.getItem(STORAGE_KEY); } catch { return null; }
})();
let _collapsedSections = new Set<string>();
let _sidebarCollapsed = false;
const _listeners = new Set<() => void>();

function notify() {
  _listeners.forEach((fn) => fn());
}

function subscribe(listener: () => void): () => void {
  _listeners.add(listener);
  return () => { _listeners.delete(listener); };
}

function getSelectedId() { return _selectedId; }
function getCollapsedSnapshot() { return _collapsedSections; }
function getSidebarCollapsed() { return _sidebarCollapsed; }

/** Get all ordered feed item IDs for keyboard navigation */
let _feedItemIds: string[] = [];
export function setFeedItemIds(ids: string[]) {
  _feedItemIds = ids;
}

export function useFeedStore() {
  const selectedId = useSyncExternalStore(subscribe, getSelectedId);
  useSyncExternalStore(subscribe, getCollapsedSnapshot);
  const sidebarCollapsed = useSyncExternalStore(subscribe, getSidebarCollapsed);

  const select = useCallback((id: string | null) => {
    _selectedId = id;
    try { if (id) localStorage.setItem(STORAGE_KEY, id); else localStorage.removeItem(STORAGE_KEY); } catch {}
    notify();
  }, []);

  const selectNext = useCallback(() => {
    if (_feedItemIds.length === 0) return;
    const idx = _selectedId ? _feedItemIds.indexOf(_selectedId) : -1;
    const next = _feedItemIds[Math.min(idx + 1, _feedItemIds.length - 1)];
    if (next) { _selectedId = next; try { localStorage.setItem(STORAGE_KEY, next); } catch {} notify(); }
  }, []);

  const selectPrev = useCallback(() => {
    if (_feedItemIds.length === 0) return;
    const idx = _selectedId ? _feedItemIds.indexOf(_selectedId) : _feedItemIds.length;
    const prev = _feedItemIds[Math.max(idx - 1, 0)];
    if (prev) { _selectedId = prev; try { localStorage.setItem(STORAGE_KEY, prev); } catch {} notify(); }
  }, []);

  const toggleSection = useCallback((section: string) => {
    const next = new Set(_collapsedSections);
    if (next.has(section)) next.delete(section); else next.add(section);
    _collapsedSections = next;
    notify();
  }, []);

  const isSectionCollapsed = useCallback((section: string) => _collapsedSections.has(section), []);

  const toggleSidebar = useCallback(() => {
    _sidebarCollapsed = !_sidebarCollapsed;
    notify();
  }, []);

  return {
    selectedId,
    select,
    selectNext,
    selectPrev,
    toggleSection,
    isSectionCollapsed,
    sidebarCollapsed,
    toggleSidebar,
  };
}
