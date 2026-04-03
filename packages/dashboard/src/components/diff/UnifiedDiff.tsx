import type { DiffChange } from './useDiffData';
import { DiffHeader } from './DiffHeader';

interface UnifiedDiffProps {
  filePath: string;
  changes: DiffChange[];
}

export function UnifiedDiff({ filePath, changes }: UnifiedDiffProps) {
  return (
    <div>
      {changes.map((change, i) => (
        <div key={i} className="mb-4">
          <DiffHeader filePath={filePath} change={change} />
          {change.type === 'write' ? (
            <WriteBlock content={change.content || ''} />
          ) : (
            <EditBlock oldString={change.oldString || ''} newString={change.newString || ''} />
          )}
        </div>
      ))}
    </div>
  );
}

function WriteBlock({ content }: { content: string }) {
  const lines = content.split('\n');
  const displayLines = lines.slice(0, 100);

  return (
    <div className="text-[11px] font-code leading-relaxed">
      {displayLines.map((line, i) => (
        <div key={i} className="flex" style={{ backgroundColor: 'var(--diff-add-bg)' }}>
          <span
            className="w-12 shrink-0 text-right pr-2 select-none tabular-nums"
            style={{ color: 'var(--diff-line-num)', backgroundColor: 'var(--diff-add-gutter)' }}
          >
            {i + 1}
          </span>
          <span className="px-2" style={{ color: 'var(--diff-add-text)' }}>+</span>
          <pre className="whitespace-pre-wrap break-words flex-1" style={{ color: 'var(--diff-add-text)' }}>{line}</pre>
        </div>
      ))}
      {lines.length > 100 && (
        <div className="px-3 py-1 text-[10px] italic" style={{ color: 'var(--text-disabled)' }}>
          ... {lines.length - 100} more lines
        </div>
      )}
    </div>
  );
}

function EditBlock({ oldString, newString }: { oldString: string; newString: string }) {
  const oldLines = oldString.split('\n');
  const newLines = newString.split('\n');

  return (
    <div className="text-[11px] font-code leading-relaxed">
      {/* Hunk header */}
      <div className="flex px-2 py-0.5" style={{ backgroundColor: 'var(--diff-hunk-bg)' }}>
        <span className="text-[10px]" style={{ color: 'var(--accent)' }}>
          @@ -{oldLines.length} +{newLines.length} @@
        </span>
      </div>
      {/* Deletions */}
      {oldLines.map((line, i) => (
        <div key={`del-${i}`} className="flex" style={{ backgroundColor: 'var(--diff-del-bg)' }}>
          <span
            className="w-12 shrink-0 text-right pr-2 select-none tabular-nums"
            style={{ color: 'var(--diff-line-num)', backgroundColor: 'var(--diff-del-gutter)' }}
          >
            {i + 1}
          </span>
          <span className="w-6 shrink-0 text-center" style={{ color: 'var(--diff-del-text)' }}>-</span>
          <pre className="whitespace-pre-wrap break-words flex-1" style={{ color: 'var(--diff-del-text)' }}>{line}</pre>
        </div>
      ))}
      {/* Additions */}
      {newLines.map((line, i) => (
        <div key={`add-${i}`} className="flex" style={{ backgroundColor: 'var(--diff-add-bg)' }}>
          <span
            className="w-12 shrink-0 text-right pr-2 select-none tabular-nums"
            style={{ color: 'var(--diff-line-num)', backgroundColor: 'var(--diff-add-gutter)' }}
          >
            {i + 1}
          </span>
          <span className="w-6 shrink-0 text-center" style={{ color: 'var(--diff-add-text)' }}>+</span>
          <pre className="whitespace-pre-wrap break-words flex-1" style={{ color: 'var(--diff-add-text)' }}>{line}</pre>
        </div>
      ))}
    </div>
  );
}
