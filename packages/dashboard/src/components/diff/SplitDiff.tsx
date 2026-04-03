import type { DiffChange } from './useDiffData';
import { DiffHeader } from './DiffHeader';

interface SplitDiffProps {
  filePath: string;
  changes: DiffChange[];
}

export function SplitDiff({ filePath, changes }: SplitDiffProps) {
  return (
    <div>
      {changes.map((change, i) => (
        <div key={i} className="mb-4">
          <DiffHeader filePath={filePath} change={change} />
          {change.type === 'write' ? (
            <SplitWriteBlock content={change.content || ''} />
          ) : (
            <SplitEditBlock oldString={change.oldString || ''} newString={change.newString || ''} />
          )}
        </div>
      ))}
    </div>
  );
}

function SplitWriteBlock({ content }: { content: string }) {
  const lines = content.split('\n').slice(0, 100);

  return (
    <div className="flex text-[11px] font-code leading-relaxed">
      {/* Left: empty */}
      <div className="w-1/2" style={{ borderRight: '1px solid var(--border-muted)' }}>
        {lines.map((_, i) => (
          <div key={i} className="flex h-[20px]" style={{ backgroundColor: 'var(--bg-inset)' }}>
            <span className="w-10 shrink-0 text-right pr-2 select-none tabular-nums" style={{ color: 'var(--text-disabled)' }} />
            <pre className="flex-1 px-1" />
          </div>
        ))}
      </div>
      {/* Right: new content */}
      <div className="w-1/2">
        {lines.map((line, i) => (
          <div key={i} className="flex h-[20px]" style={{ backgroundColor: 'var(--diff-add-bg)' }}>
            <span
              className="w-10 shrink-0 text-right pr-2 select-none tabular-nums"
              style={{ color: 'var(--diff-line-num)', backgroundColor: 'var(--diff-add-gutter)' }}
            >
              {i + 1}
            </span>
            <span className="w-4 shrink-0 text-center" style={{ color: 'var(--diff-add-text)' }}>+</span>
            <pre className="whitespace-pre break-words flex-1 truncate" style={{ color: 'var(--diff-add-text)' }}>{line}</pre>
          </div>
        ))}
      </div>
    </div>
  );
}

function SplitEditBlock({ oldString, newString }: { oldString: string; newString: string }) {
  const oldLines = oldString.split('\n');
  const newLines = newString.split('\n');
  const maxLen = Math.max(oldLines.length, newLines.length);

  return (
    <div className="text-[11px] font-code leading-relaxed">
      {/* Hunk header */}
      <div className="flex px-2 py-0.5" style={{ backgroundColor: 'var(--diff-hunk-bg)' }}>
        <span className="text-[10px]" style={{ color: 'var(--accent)' }}>
          @@ -{oldLines.length} +{newLines.length} @@
        </span>
      </div>
      <div className="flex">
        {/* Left: old */}
        <div className="w-1/2" style={{ borderRight: '1px solid var(--border-muted)' }}>
          {Array.from({ length: maxLen }, (_, i) => {
            const line = oldLines[i];
            const hasLine = i < oldLines.length;
            return (
              <div
                key={i}
                className="flex h-[20px]"
                style={{ backgroundColor: hasLine ? 'var(--diff-del-bg)' : 'var(--bg-inset)' }}
              >
                <span
                  className="w-10 shrink-0 text-right pr-2 select-none tabular-nums"
                  style={{ color: 'var(--diff-line-num)', backgroundColor: hasLine ? 'var(--diff-del-gutter)' : 'transparent' }}
                >
                  {hasLine ? i + 1 : ''}
                </span>
                {hasLine && <span className="w-4 shrink-0 text-center" style={{ color: 'var(--diff-del-text)' }}>-</span>}
                <pre className="whitespace-pre break-words flex-1 truncate" style={{ color: 'var(--diff-del-text)' }}>
                  {line ?? ''}
                </pre>
              </div>
            );
          })}
        </div>
        {/* Right: new */}
        <div className="w-1/2">
          {Array.from({ length: maxLen }, (_, i) => {
            const line = newLines[i];
            const hasLine = i < newLines.length;
            return (
              <div
                key={i}
                className="flex h-[20px]"
                style={{ backgroundColor: hasLine ? 'var(--diff-add-bg)' : 'var(--bg-inset)' }}
              >
                <span
                  className="w-10 shrink-0 text-right pr-2 select-none tabular-nums"
                  style={{ color: 'var(--diff-line-num)', backgroundColor: hasLine ? 'var(--diff-add-gutter)' : 'transparent' }}
                >
                  {hasLine ? i + 1 : ''}
                </span>
                {hasLine && <span className="w-4 shrink-0 text-center" style={{ color: 'var(--diff-add-text)' }}>+</span>}
                <pre className="whitespace-pre break-words flex-1 truncate" style={{ color: 'var(--diff-add-text)' }}>
                  {line ?? ''}
                </pre>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
