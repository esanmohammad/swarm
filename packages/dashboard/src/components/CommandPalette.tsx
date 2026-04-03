import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  Search, Sparkles, BarChart3, BookOpen, Brain,
  Wrench, GitPullRequest, RefreshCw, Minimize2,
} from 'lucide-react';
import { useFeedStore } from '../store/feed-store';
import type { WsCommand } from '../types';

interface PaletteItem {
  id: string;
  label: string;
  category: 'navigate' | 'action';
  keywords: string[];
  icon: typeof Sparkles;
  feedId?: string;
  /** WS action to execute (for action items) */
  wsAction?: string;
  /** Whether this action needs a prompt */
  needsPrompt?: boolean;
}

const PALETTE_ITEMS: PaletteItem[] = [
  // Navigation
  { id: 'conventions', label: 'Coding Conventions', category: 'navigate', keywords: ['conventions', 'patterns', 'style', 'learn', 'rules'], icon: BookOpen, feedId: 'tool:conventions' },
  { id: 'memory', label: 'Project Memory', category: 'navigate', keywords: ['memory', 'remember', 'knowledge', 'context'], icon: Brain, feedId: 'tool:memory' },
  { id: 'stats', label: 'Usage & Costs', category: 'navigate', keywords: ['stats', 'cost', 'spending', 'money', 'budget', 'usage'], icon: BarChart3, feedId: 'tool:stats' },
  // Actions
  { id: 'build', label: 'Build Feature', category: 'action', keywords: ['build', 'feature', 'new', 'start', 'create', 'implement', 'launch'], icon: Sparkles, wsAction: 'run-mayday', needsPrompt: true },
  { id: 'fix', label: 'Fix Bug', category: 'action', keywords: ['fix', 'bug', 'error', 'repair', 'broken', 'issue'], icon: Wrench, wsAction: 'run-fix', needsPrompt: true },
  { id: 'spike', label: 'Research', category: 'action', keywords: ['research', 'spike', 'investigate', 'explore', 'question', 'how', 'why'], icon: Search, wsAction: 'run-spike', needsPrompt: true },
  { id: 'review', label: 'Code Review', category: 'action', keywords: ['review', 'pr', 'pull request', 'code review', 'diff', 'check'], icon: GitPullRequest, wsAction: 'run-review' },
  { id: 'refactor', label: 'Refactor Code', category: 'action', keywords: ['refactor', 'clean', 'restructure', 'rewrite', 'improve'], icon: RefreshCw, wsAction: 'run-refactor', needsPrompt: true },
  { id: 'simplify', label: 'Clean Up Code', category: 'action', keywords: ['simplify', 'cleanup', 'reduce', 'dead code', 'complexity'], icon: Minimize2, wsAction: 'run-simplify' },
  { id: 'learn', label: 'Scan Conventions', category: 'action', keywords: ['scan', 'learn', 'conventions', 'generate', 'analyze'], icon: BookOpen, wsAction: 'run-learn' },
];

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  sendCommand?: (cmd: WsCommand) => void;
}

export function CommandPalette({ open, onClose, sendCommand }: CommandPaletteProps) {
  const { select } = useFeedStore();
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [promptMode, setPromptMode] = useState<PaletteItem | null>(null);
  const [promptText, setPromptText] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const promptRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const [recent, setRecent] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem('swarm_recent_palette') || '[]'); }
    catch { return []; }
  });

  const addRecent = useCallback((id: string) => {
    setRecent(prev => {
      const next = [id, ...prev.filter(r => r !== id)].slice(0, 8);
      localStorage.setItem('swarm_recent_palette', JSON.stringify(next));
      return next;
    });
  }, []);

  const filtered = useMemo(() => {
    if (!query.trim()) {
      const recentItems = recent.map(id => PALETTE_ITEMS.find(i => i.id === id)).filter(Boolean) as PaletteItem[];
      return { recent: recentItems, results: [] };
    }
    const q = query.toLowerCase();
    const results = PALETTE_ITEMS.filter(item =>
      item.label.toLowerCase().includes(q) ||
      item.keywords.some(k => k.includes(q))
    ).slice(0, 15);
    return { recent: [], results };
  }, [query, recent]);

  const allItems = [...filtered.recent, ...filtered.results];

  useEffect(() => {
    if (open) {
      setQuery('');
      setSelectedIndex(0);
      setPromptMode(null);
      setPromptText('');
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  const executeItem = useCallback((item: PaletteItem) => {
    addRecent(item.id);

    if (item.feedId) {
      select(item.feedId);
      onClose();
      return;
    }

    if (item.wsAction && sendCommand) {
      if (item.needsPrompt) {
        // Switch to prompt mode
        setPromptMode(item);
        setTimeout(() => promptRef.current?.focus(), 50);
        return;
      }
      // Execute immediately
      sendCommand({ action: item.wsAction } as WsCommand);
      onClose();
      return;
    }

    onClose();
  }, [addRecent, select, onClose, sendCommand]);

  const executePromptAction = useCallback(() => {
    if (!promptMode || !sendCommand) return;
    const text = promptText.trim();
    // These actions require a prompt
    const requiresPrompt = ['run-mayday', 'run-fix', 'run-spike', 'run-refactor'];
    if (requiresPrompt.includes(promptMode.wsAction || '') && !text) return;

    sendCommand({ action: promptMode.wsAction, prompt: text || undefined } as WsCommand);
    setPromptMode(null);
    setPromptText('');
    onClose();
  }, [promptMode, promptText, sendCommand, onClose]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (promptMode) {
      if (e.key === 'Enter') {
        e.preventDefault();
        executePromptAction();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        setPromptMode(null);
        setTimeout(() => inputRef.current?.focus(), 50);
      }
      return;
    }

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setSelectedIndex(prev => Math.min(prev + 1, allItems.length - 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setSelectedIndex(prev => Math.max(prev - 1, 0));
        break;
      case 'Enter':
        e.preventDefault();
        if (allItems[selectedIndex]) executeItem(allItems[selectedIndex]);
        break;
      case 'Escape':
        onClose();
        break;
    }
  }, [allItems, selectedIndex, onClose, executeItem, promptMode, executePromptAction]);

  useEffect(() => {
    const el = listRef.current?.children[selectedIndex] as HTMLElement | undefined;
    el?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  if (!open) return null;

  return (
    <>
      <div className="fixed inset-0 z-50" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }} onClick={onClose} />
      <div className="fixed top-[15%] left-1/2 -translate-x-1/2 w-full max-w-lg z-50">
        <div
          className="rounded-xl shadow-2xl overflow-hidden"
          style={{ backgroundColor: 'var(--bg-raised)', border: '1px solid var(--border-default)' }}
        >
          {/* Prompt mode */}
          {promptMode ? (
            <div className="p-4 space-y-3">
              <div className="flex items-center gap-2">
                <promptMode.icon size={14} style={{ color: 'var(--accent)' }} />
                <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                  {promptMode.label}
                </span>
              </div>
              <input
                ref={promptRef}
                type="text"
                value={promptText}
                onChange={(e) => setPromptText(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={promptMode.id === 'build' ? 'Describe what to build...'
                  : promptMode.id === 'fix' ? 'Describe the bug to fix...'
                  : promptMode.id === 'spike' ? 'What do you want to investigate?'
                  : promptMode.id === 'refactor' ? 'What to refactor...'
                  : 'Enter prompt...'}
                className="w-full px-3 py-2 rounded-md text-sm bg-transparent focus:outline-none"
                style={{ color: 'var(--text-primary)', border: '1px solid var(--border-default)', backgroundColor: 'var(--bg-overlay)' }}
                autoComplete="off"
              />
              <div className="flex items-center justify-between">
                <button
                  onClick={() => { setPromptMode(null); setTimeout(() => inputRef.current?.focus(), 50); }}
                  className="text-xs px-2 py-1 rounded"
                  style={{ color: 'var(--text-tertiary)' }}
                >
                  Back
                </button>
                <button
                  onClick={executePromptAction}
                  disabled={['build', 'fix', 'spike', 'refactor'].includes(promptMode.id) && !promptText.trim()}
                  className="flex items-center gap-1 px-3 py-1.5 rounded-md text-xs font-medium transition-all disabled:opacity-30"
                  style={{ backgroundColor: 'var(--accent-emphasis)', color: '#fff' }}
                >
                  Run
                </button>
              </div>
            </div>
          ) : (
            <>
              {/* Search input */}
              <div className="flex items-center gap-2 px-4 py-3" style={{ borderBottom: '1px solid var(--border-muted)' }}>
                <Search size={16} style={{ color: 'var(--text-disabled)' }} />
                <input
                  ref={inputRef}
                  type="text"
                  value={query}
                  onChange={e => { setQuery(e.target.value); setSelectedIndex(0); }}
                  onKeyDown={handleKeyDown}
                  placeholder="Type a command..."
                  className="flex-1 bg-transparent text-sm focus:outline-none"
                  style={{ color: 'var(--text-primary)' }}
                  autoComplete="off"
                />
                <kbd className="text-[10px] px-1.5 py-0.5 rounded" style={{ backgroundColor: 'var(--bg-overlay)', color: 'var(--text-disabled)' }}>esc</kbd>
              </div>

              {/* Results */}
              <div ref={listRef} className="max-h-80 overflow-y-auto py-1">
                {filtered.recent.length > 0 && (
                  <>
                    <div className="px-4 py-1 text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-disabled)' }}>Recent</div>
                    {filtered.recent.map((item, i) => (
                      <PaletteRow key={`recent-${item.id}`} item={item} selected={selectedIndex === i} onSelect={() => executeItem(item)} onHover={() => setSelectedIndex(i)} />
                    ))}
                  </>
                )}

                {filtered.results.length > 0 && (
                  <>
                    {filtered.recent.length > 0 && <div className="my-1" style={{ borderTop: '1px solid var(--border-muted)' }} />}
                    <div className="px-4 py-1 text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-disabled)' }}>Results</div>
                    {filtered.results.map((item, i) => {
                      const idx = filtered.recent.length + i;
                      return <PaletteRow key={item.id} item={item} selected={selectedIndex === idx} onSelect={() => executeItem(item)} onHover={() => setSelectedIndex(idx)} />;
                    })}
                  </>
                )}

                {query && filtered.results.length === 0 && (
                  <div className="px-4 py-6 text-center text-xs" style={{ color: 'var(--text-disabled)' }}>No results for "{query}"</div>
                )}

                {!query && filtered.recent.length === 0 && (
                  <>
                    <div className="px-4 py-1 text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-disabled)' }}>Commands</div>
                    {PALETTE_ITEMS.map((item, i) => (
                      <PaletteRow key={item.id} item={item} selected={selectedIndex === i} onSelect={() => executeItem(item)} onHover={() => setSelectedIndex(i)} />
                    ))}
                  </>
                )}
              </div>

              {/* Footer */}
              <div className="flex items-center justify-between px-4 py-2 text-[10px]" style={{ borderTop: '1px solid var(--border-muted)', color: 'var(--text-disabled)' }}>
                <span>Navigate with arrow keys</span>
                <span>Cmd+K to toggle</span>
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}

function PaletteRow({ item, selected, onSelect, onHover }: { item: PaletteItem; selected: boolean; onSelect: () => void; onHover: () => void }) {
  const Icon = item.icon;
  return (
    <button
      onClick={onSelect}
      onMouseEnter={onHover}
      className="flex items-center gap-3 w-full px-4 py-2 text-left transition-colors"
      style={{
        backgroundColor: selected ? 'var(--bg-emphasis)' : 'transparent',
        color: selected ? 'var(--text-primary)' : 'var(--text-secondary)',
      }}
    >
      <Icon size={14} style={{ color: 'var(--text-disabled)' }} />
      <span className="text-xs flex-1">{item.label}</span>
      <span className="text-[10px]" style={{ color: 'var(--text-disabled)' }}>
        {item.category === 'action' ? 'Run' : 'Go'}
      </span>
    </button>
  );
}
