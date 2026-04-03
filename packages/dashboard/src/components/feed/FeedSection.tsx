import { ChevronRight } from 'lucide-react';
import type { ReactNode } from 'react';

interface FeedSectionProps {
  label: string;
  count?: number;
  collapsed?: boolean;
  onToggle: () => void;
  dotColor?: string;
  children: ReactNode;
}

export function FeedSection({ label, count, collapsed, onToggle, dotColor, children }: FeedSectionProps) {
  return (
    <div className="mb-1">
      <button
        onClick={onToggle}
        className="flex items-center gap-1.5 w-full px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider transition-colors hover:opacity-80"
        style={{ color: 'var(--text-tertiary)' }}
      >
        <ChevronRight
          size={10}
          className="transition-transform"
          style={{ transform: collapsed ? 'rotate(0deg)' : 'rotate(90deg)' }}
        />
        {dotColor && (
          <span
            className="w-1.5 h-1.5 rounded-full animate-pulse"
            style={{ backgroundColor: dotColor }}
          />
        )}
        <span>{label}</span>
        {count != null && (
          <span style={{ color: 'var(--text-disabled)' }}>{count}</span>
        )}
      </button>
      {!collapsed && (
        <div>{children}</div>
      )}
    </div>
  );
}
