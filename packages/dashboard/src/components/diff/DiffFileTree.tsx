import { FileText } from 'lucide-react';
import type { DiffFile } from './useDiffData';

interface DiffFileTreeProps {
  files: DiffFile[];
  selectedPath: string | null;
  onSelect: (path: string) => void;
}

export function DiffFileTree({ files, selectedPath, onSelect }: DiffFileTreeProps) {
  return (
    <div
      className="w-56 shrink-0 overflow-y-auto"
      style={{
        backgroundColor: 'var(--bg-inset)',
        borderRight: '1px solid var(--border-muted)',
      }}
    >
      <div
        className="px-3 py-2 text-[10px] font-ui font-semibold uppercase tracking-wider"
        style={{
          color: 'var(--text-tertiary)',
          borderBottom: '1px solid var(--border-muted)',
        }}
      >
        Files changed ({files.length})
      </div>
      {files.map((file) => {
        const isActive = file.filePath === selectedPath;
        const fileName = file.filePath.split('/').pop() || file.filePath;
        return (
          <button
            key={file.filePath}
            onClick={() => onSelect(file.filePath)}
            className="w-full text-left px-3 py-1.5 text-[11px] flex items-center gap-1.5 transition-colors truncate"
            style={{
              backgroundColor: isActive ? 'var(--bg-emphasis)' : 'transparent',
              color: isActive ? 'var(--text-primary)' : 'var(--text-secondary)',
            }}
            onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.backgroundColor = 'var(--bg-subtle)'; }}
            onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.backgroundColor = 'transparent'; }}
            title={file.filePath}
          >
            <FileText size={10} className="shrink-0" style={{ color: 'var(--text-disabled)' }} />
            <span className="truncate flex-1">{fileName}</span>
            <span className="shrink-0 flex gap-1.5 text-[10px] tabular-nums">
              {file.additions > 0 && (
                <span style={{ color: 'var(--diff-add-text)' }}>+{file.additions}</span>
              )}
              {file.deletions > 0 && (
                <span style={{ color: 'var(--diff-del-text)' }}>-{file.deletions}</span>
              )}
            </span>
          </button>
        );
      })}
    </div>
  );
}
