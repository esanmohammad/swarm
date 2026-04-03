import { useState, useEffect } from 'react';
import {
  Sparkles, Wrench, CheckCircle2, XCircle, Clock,
  BookOpen, Brain, BarChart3, GitPullRequest, Zap,
  Minimize2, Search, RefreshCw, TestTube2,
} from 'lucide-react';
import type { FeedItemData } from './useFeedItems';

const TYPE_CONFIG: Record<string, { icon: typeof Sparkles; color: string; label: string }> = {
  pipeline:   { icon: Sparkles,       color: 'var(--activity-pipeline)', label: 'Build' },
  fix:        { icon: Wrench,         color: 'var(--activity-fix)',      label: 'Fix' },
  review:     { icon: GitPullRequest, color: 'var(--activity-review)',   label: 'Review' },
  spike:      { icon: Search,         color: 'var(--activity-spike)',    label: 'Research' },
  refactor:   { icon: RefreshCw,      color: 'var(--activity-refactor)', label: 'Refactor' },
  simplify:   { icon: Minimize2,      color: 'var(--activity-simplify)', label: 'Clean Up' },
  'test-gen': { icon: TestTube2,      color: 'var(--status-success)',    label: 'Test' },
  conventions:{ icon: BookOpen,       color: 'var(--text-secondary)',    label: 'Conventions' },
  memory:     { icon: Brain,          color: 'var(--text-secondary)',    label: 'Memory' },
  stats:      { icon: BarChart3,      color: 'var(--text-secondary)',    label: 'Stats' },
};

function StatusIndicator({ status, timestamp }: { status: string; timestamp?: number }) {
  if (status === 'running') {
    return <ElapsedTimer startedAt={timestamp} />;
  }
  if (status === 'done' || status === 'success') {
    return <CheckCircle2 size={11} style={{ color: 'var(--status-success)' }} />;
  }
  if (status === 'error') {
    return <XCircle size={11} style={{ color: 'var(--status-error)' }} />;
  }
  return <Clock size={11} style={{ color: 'var(--status-pending)' }} />;
}

/** Live-ticking elapsed timer for running items */
function ElapsedTimer({ startedAt }: { startedAt?: number }) {
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  if (!startedAt) {
    return <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ backgroundColor: 'var(--status-running)' }} />;
  }

  const elapsed = Math.floor((now - startedAt) / 1000);
  const m = Math.floor(elapsed / 60);
  const s = elapsed % 60;
  const display = m > 0 ? `${m}:${String(s).padStart(2, '0')}` : `${s}s`;

  return (
    <span className="flex items-center gap-1">
      <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ backgroundColor: 'var(--status-running)' }} />
      <span className="text-[10px] tabular-nums font-code" style={{ color: 'var(--status-running)' }}>
        {display}
      </span>
    </span>
  );
}

interface FeedItemProps {
  item: FeedItemData;
  selected: boolean;
  onSelect: () => void;
}

export function FeedItem({ item, selected, onSelect }: FeedItemProps) {
  const iconType = item.icon || item.type;
  const config = TYPE_CONFIG[iconType] || { icon: Zap, color: 'var(--text-secondary)', label: iconType };
  const Icon = config.icon;

  return (
    <button
      onClick={onSelect}
      className="w-full flex items-center gap-2 px-3 py-1.5 text-left transition-colors group"
      style={{
        backgroundColor: selected ? 'var(--bg-emphasis)' : 'transparent',
        borderLeft: selected ? '2px solid var(--accent)' : '2px solid transparent',
      }}
      onMouseEnter={(e) => { if (!selected) e.currentTarget.style.backgroundColor = 'var(--bg-subtle)'; }}
      onMouseLeave={(e) => { if (!selected) e.currentTarget.style.backgroundColor = 'transparent'; }}
      data-feed-id={item.id}
    >
      <Icon size={13} style={{ color: config.color }} className="shrink-0" />
      <span
        className="text-xs truncate flex-1"
        style={{ color: selected ? 'var(--text-primary)' : 'var(--text-secondary)' }}
      >
        {item.label}
      </span>
      {item.type !== 'tool' && <StatusIndicator status={item.status} timestamp={item.timestamp} />}
      {item.type !== 'tool' && item.status !== 'running' && item.cost != null && item.cost > 0 && (
        <span className="text-[10px] tabular-nums font-code shrink-0" style={{ color: 'var(--text-tertiary)' }}>
          ${item.cost.toFixed(2)}
        </span>
      )}
    </button>
  );
}
