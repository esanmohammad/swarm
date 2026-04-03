import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Search, ArrowRight, Home, Rocket, BarChart3, Clock, Users,
  Wrench, GitPullRequest, Bot, Inbox, GitBranch, Eye,
  TrendingUp, Activity, LineChart, Gauge,
  Layers, HelpCircle, BookOpen, Brain, Network,
  Map, Target, Zap, Bug, Shield, ClipboardCheck, Building2,
  Upload, Database, Package, AlertTriangle,
  Sparkles
} from 'lucide-react';

interface PaletteItem {
  id: string;
  label: string;
  category: 'navigate' | 'action';
  route?: string;
  keywords: string[];
  icon: typeof Home;
  description?: string;
  action?: () => void;
}

const PALETTE_ITEMS: PaletteItem[] = [
  // Navigation
  { id: 'home', label: 'Home', category: 'navigate', route: '/', keywords: ['home', 'dashboard', 'start'], icon: Home },
  { id: 'pipeline', label: 'Pipeline', category: 'navigate', route: '/pipeline', keywords: ['pipeline', 'mayday', 'build'], icon: Rocket },
  { id: 'launch', label: 'Launch', category: 'navigate', route: '/launch', keywords: ['launch', 'new', 'start', 'feature'], icon: Sparkles },
  { id: 'results', label: 'Results', category: 'navigate', route: '/results', keywords: ['results', 'output', 'done'], icon: BarChart3 },
  { id: 'history', label: 'History', category: 'navigate', route: '/history', keywords: ['history', 'past', 'runs', 'log'], icon: Clock },
  { id: 'agents', label: 'Agents', category: 'navigate', route: '/agents', keywords: ['agents', 'processes', 'spawn'], icon: Users },
  { id: 'workflows', label: 'Workflows Hub', category: 'navigate', route: '/workflows', keywords: ['workflows', 'tools', 'hub'], icon: Wrench },
  { id: 'autopilot', label: 'Autopilot', category: 'navigate', route: '/workflows/autopilot', keywords: ['autopilot', 'auto', 'daemon', 'issues'], icon: Bot },
  { id: 'inbox', label: 'Inbox', category: 'navigate', route: '/workflows/inbox', keywords: ['inbox', 'queue', 'work', 'tasks'], icon: Inbox },
  { id: 'reviews', label: 'PR Reviews', category: 'navigate', route: '/workflows/review', keywords: ['review', 'pr', 'pull request', 'code review'], icon: GitPullRequest },
  { id: 'delegate', label: 'Delegate', category: 'navigate', route: '/workflows/delegate', keywords: ['delegate', 'decompose', 'split'], icon: GitBranch },
  { id: 'watch', label: 'Watch', category: 'navigate', route: '/workflows/watch', keywords: ['watch', 'file', 'monitor'], icon: Eye },
  { id: 'intelligence', label: 'Intelligence Hub', category: 'navigate', route: '/intelligence', keywords: ['intelligence', 'metrics', 'analytics'], icon: TrendingUp },
  { id: 'stats', label: 'Stats', category: 'navigate', route: '/intelligence/stats', keywords: ['stats', 'cost', 'spending', 'money', 'budget'], icon: TrendingUp },
  { id: 'health', label: 'Health', category: 'navigate', route: '/intelligence/health', keywords: ['health', 'quality', 'score', 'coverage'], icon: Activity },
  { id: 'forecast', label: 'Forecast', category: 'navigate', route: '/intelligence/forecast', keywords: ['forecast', 'predict', 'trend'], icon: LineChart },
  { id: 'benchmark', label: 'Benchmark', category: 'navigate', route: '/intelligence/benchmark', keywords: ['benchmark', 'performance', 'perf', 'speed'], icon: Gauge },
  { id: 'codebase', label: 'Codebase Hub', category: 'navigate', route: '/codebase', keywords: ['codebase', 'code', 'source'], icon: Layers },
  { id: 'context', label: 'Context', category: 'navigate', route: '/codebase/context', keywords: ['context', 'index', 'modules'], icon: Layers },
  { id: 'explain', label: 'Explain', category: 'navigate', route: '/codebase/explain', keywords: ['explain', 'question', 'ask', 'how'], icon: HelpCircle },
  { id: 'conventions', label: 'Conventions', category: 'navigate', route: '/codebase/conventions', keywords: ['conventions', 'patterns', 'style', 'learn'], icon: BookOpen },
  { id: 'memory', label: 'Memory', category: 'navigate', route: '/codebase/memory', keywords: ['memory', 'remember', 'knowledge'], icon: Brain },
  { id: 'system', label: 'System Map', category: 'navigate', route: '/codebase/system', keywords: ['system', 'architecture', 'map', 'diagram'], icon: Network },
  { id: 'planning', label: 'Planning Hub', category: 'navigate', route: '/planning', keywords: ['planning', 'plan', 'roadmap'], icon: Map },
  { id: 'roadmap', label: 'Roadmap', category: 'navigate', route: '/planning/roadmap', keywords: ['roadmap', 'timeline', 'milestones'], icon: Map },
  { id: 'scope', label: 'Scope', category: 'navigate', route: '/planning/scope', keywords: ['scope', 'estimate', 'feasibility'], icon: Search },
  { id: 'quality', label: 'Quality Hub', category: 'navigate', route: '/quality', keywords: ['quality', 'testing', 'qa'], icon: Target },
  { id: 'slo', label: 'SLOs', category: 'navigate', route: '/quality/slo', keywords: ['slo', 'sla', 'reliability', 'uptime'], icon: Zap },
  { id: 'debt', label: 'Tech Debt', category: 'navigate', route: '/quality/debt', keywords: ['debt', 'technical debt', 'cleanup'], icon: Bug },
  { id: 'security', label: 'Security', category: 'navigate', route: '/quality/security', keywords: ['security', 'vulnerability', 'scan', 'secrets'], icon: Shield },
  { id: 'compliance', label: 'Compliance', category: 'navigate', route: '/quality/compliance', keywords: ['compliance', 'regulation', 'audit'], icon: ClipboardCheck },
  { id: 'architecture', label: 'Architecture Review', category: 'navigate', route: '/quality/architecture', keywords: ['architecture', 'design', 'coupling'], icon: Building2 },
  { id: 'deploy', label: 'Deploy', category: 'navigate', route: '/operations/deploy', keywords: ['deploy', 'release', 'staging', 'production'], icon: Upload },
  { id: 'migrate', label: 'Migrate', category: 'navigate', route: '/operations/migrate', keywords: ['migrate', 'migration', 'database', 'schema'], icon: Database },
  { id: 'deps', label: 'Dependencies', category: 'navigate', route: '/operations/deps', keywords: ['deps', 'dependencies', 'packages', 'npm', 'update'], icon: Package },
  { id: 'incident', label: 'Incident', category: 'navigate', route: '/operations/incident', keywords: ['incident', 'outage', 'emergency', 'rca'], icon: AlertTriangle },
];

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  onAction?: (actionId: string) => void;
}

export function CommandPalette({ open, onClose }: CommandPaletteProps) {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Recent items
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

  // Filter items
  const filtered = useMemo(() => {
    if (!query.trim()) {
      // Show recent + all nav items
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

  // Reset on open
  useEffect(() => {
    if (open) {
      setQuery('');
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  // Keyboard navigation
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
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
        if (allItems[selectedIndex]) {
          const item = allItems[selectedIndex];
          addRecent(item.id);
          if (item.route) navigate(item.route);
          if (item.action) item.action();
          onClose();
        }
        break;
      case 'Escape':
        onClose();
        break;
    }
  }, [allItems, selectedIndex, navigate, onClose, addRecent]);

  // Scroll selected into view
  useEffect(() => {
    const el = listRef.current?.children[selectedIndex] as HTMLElement | undefined;
    el?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  if (!open) return null;

  return (
    <>
      <div className="fixed inset-0 bg-black/50 z-50" onClick={onClose} />
      <div className="fixed top-[15%] left-1/2 -translate-x-1/2 w-full max-w-lg z-50">
        <div className="bg-stone-900 border border-stone-700/50 rounded-xl shadow-2xl overflow-hidden">
          {/* Search input */}
          <div className="flex items-center gap-2 px-4 py-3 border-b border-stone-800/50">
            <Search size={16} className="text-stone-500 shrink-0" />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={e => { setQuery(e.target.value); setSelectedIndex(0); }}
              onKeyDown={handleKeyDown}
              placeholder="Type a command or feature..."
              className="flex-1 bg-transparent text-sm text-stone-300 placeholder-stone-600 focus:outline-none"
              autoComplete="off"
            />
            <kbd className="text-[10px] text-stone-600 bg-stone-800 px-1.5 py-0.5 rounded">esc</kbd>
          </div>

          {/* Results */}
          <div ref={listRef} className="max-h-80 overflow-y-auto py-1">
            {/* Recent section */}
            {filtered.recent.length > 0 && (
              <>
                <div className="px-4 py-1 text-[10px] font-semibold text-stone-600 uppercase tracking-wider">Recent</div>
                {filtered.recent.map((item, i) => {
                  const Icon = item.icon;
                  return (
                    <button
                      key={`recent-${item.id}`}
                      onClick={() => { addRecent(item.id); if (item.route) navigate(item.route); onClose(); }}
                      onMouseEnter={() => setSelectedIndex(i)}
                      className={`flex items-center gap-3 w-full px-4 py-2 text-left transition-colors ${
                        selectedIndex === i ? 'bg-stone-800/60 text-stone-200' : 'text-stone-400 hover:bg-stone-800/40'
                      }`}
                    >
                      <Icon size={14} className="shrink-0 text-stone-500" />
                      <span className="text-xs">{item.label}</span>
                      <ArrowRight size={12} className="ml-auto text-stone-600" />
                    </button>
                  );
                })}
              </>
            )}

            {/* Search results */}
            {filtered.results.length > 0 && (
              <>
                {filtered.recent.length > 0 && <div className="my-1 border-t border-stone-800/30" />}
                <div className="px-4 py-1 text-[10px] font-semibold text-stone-600 uppercase tracking-wider">Results</div>
                {filtered.results.map((item, i) => {
                  const Icon = item.icon;
                  const idx = filtered.recent.length + i;
                  return (
                    <button
                      key={item.id}
                      onClick={() => { addRecent(item.id); if (item.route) navigate(item.route); onClose(); }}
                      onMouseEnter={() => setSelectedIndex(idx)}
                      className={`flex items-center gap-3 w-full px-4 py-2 text-left transition-colors ${
                        selectedIndex === idx ? 'bg-stone-800/60 text-stone-200' : 'text-stone-400 hover:bg-stone-800/40'
                      }`}
                    >
                      <Icon size={14} className="shrink-0 text-stone-500" />
                      <div>
                        <span className="text-xs">{item.label}</span>
                        {item.description && <span className="text-[10px] text-stone-600 ml-2">{item.description}</span>}
                      </div>
                      <span className="ml-auto text-[10px] text-stone-700">{item.category === 'action' ? 'Run' : 'Go'}</span>
                    </button>
                  );
                })}
              </>
            )}

            {/* No results */}
            {query && filtered.results.length === 0 && (
              <div className="px-4 py-6 text-center text-xs text-stone-600">
                No results for "{query}"
              </div>
            )}

            {/* Empty state - show popular */}
            {!query && filtered.recent.length === 0 && (
              <>
                <div className="px-4 py-1 text-[10px] font-semibold text-stone-600 uppercase tracking-wider">Navigate</div>
                {PALETTE_ITEMS.slice(0, 8).map((item, i) => {
                  const Icon = item.icon;
                  return (
                    <button
                      key={item.id}
                      onClick={() => { addRecent(item.id); if (item.route) navigate(item.route); onClose(); }}
                      onMouseEnter={() => setSelectedIndex(i)}
                      className={`flex items-center gap-3 w-full px-4 py-2 text-left transition-colors ${
                        selectedIndex === i ? 'bg-stone-800/60 text-stone-200' : 'text-stone-400 hover:bg-stone-800/40'
                      }`}
                    >
                      <Icon size={14} className="shrink-0 text-stone-500" />
                      <span className="text-xs">{item.label}</span>
                      <ArrowRight size={12} className="ml-auto text-stone-600" />
                    </button>
                  );
                })}
              </>
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between px-4 py-2 border-t border-stone-800/40 text-[10px] text-stone-600">
            <span>Navigate with arrow keys</span>
            <span>Cmd+Shift+K: Spawn Agent</span>
          </div>
        </div>
      </div>
    </>
  );
}
