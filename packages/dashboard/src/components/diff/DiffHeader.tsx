import { Pencil, Plus } from 'lucide-react';
import type { DiffChange } from './useDiffData';

interface DiffHeaderProps {
  filePath: string;
  change: DiffChange;
}

export function DiffHeader({ change }: DiffHeaderProps) {
  const time = new Date(change.timestamp).toLocaleTimeString([], {
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });

  return (
    <div
      className="flex items-center gap-2 px-3 py-1.5 text-[10px]"
      style={{
        backgroundColor: change.type === 'write' ? 'var(--status-success-bg)' : 'var(--status-warning-bg)',
        borderBottom: '1px solid var(--border-muted)',
      }}
    >
      {change.type === 'write' ? (
        <Plus size={10} style={{ color: 'var(--diff-add-text)' }} />
      ) : (
        <Pencil size={10} style={{ color: 'var(--status-warning)' }} />
      )}
      <span style={{ color: change.type === 'write' ? 'var(--diff-add-text)' : 'var(--status-warning)' }}>
        {change.type === 'write' ? 'new file' : 'edit'}
      </span>
      <span className="ml-auto tabular-nums" style={{ color: 'var(--text-disabled)' }}>
        {time}
      </span>
    </div>
  );
}
