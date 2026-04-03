import { useState } from 'react';
import { FileText } from 'lucide-react';
import { useDiffData } from './useDiffData';
import { DiffFileTree } from './DiffFileTree';
import { UnifiedDiff } from './UnifiedDiff';
import { SplitDiff } from './SplitDiff';
import type { AgentActivity } from '../../types';

type DiffMode = 'unified' | 'split';

interface DiffViewerProps {
  activities: AgentActivity[];
}

export function DiffViewer({ activities }: DiffViewerProps) {
  const files = useDiffData(activities);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [mode, setMode] = useState<DiffMode>('unified');

  const activePath = selectedPath ?? files[0]?.filePath ?? null;
  const activeFile = files.find((f) => f.filePath === activePath);

  if (files.length === 0) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <FileText size={28} className="mx-auto mb-3 opacity-15" style={{ color: 'var(--text-tertiary)' }} />
          <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>No file changes detected</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full font-code">
      {/* File tree */}
      <DiffFileTree
        files={files}
        selectedPath={activePath}
        onSelect={setSelectedPath}
      />

      {/* Diff content */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {activeFile && (
          <>
            {/* File header with mode toggle */}
            <div
              className="flex items-center justify-between px-3 py-1.5 shrink-0 sticky top-0 z-10"
              style={{
                backgroundColor: 'var(--bg-surface)',
                borderBottom: '1px solid var(--border-muted)',
              }}
            >
              <span className="text-[11px] truncate" style={{ color: 'var(--text-primary)' }}>
                {activeFile.filePath}
              </span>
              <div className="flex text-[10px] font-ui shrink-0 ml-2">
                <button
                  onClick={() => setMode('unified')}
                  className="px-2 py-0.5 transition-colors"
                  style={{
                    backgroundColor: mode === 'unified' ? 'var(--bg-emphasis)' : 'transparent',
                    color: mode === 'unified' ? 'var(--text-primary)' : 'var(--text-tertiary)',
                    border: '1px solid var(--border-muted)',
                    borderRadius: '4px 0 0 4px',
                  }}
                >
                  Unified
                </button>
                <button
                  onClick={() => setMode('split')}
                  className="px-2 py-0.5 transition-colors"
                  style={{
                    backgroundColor: mode === 'split' ? 'var(--bg-emphasis)' : 'transparent',
                    color: mode === 'split' ? 'var(--text-primary)' : 'var(--text-tertiary)',
                    border: '1px solid var(--border-muted)',
                    borderLeft: 'none',
                    borderRadius: '0 4px 4px 0',
                  }}
                >
                  Split
                </button>
              </div>
            </div>

            {/* Diff body */}
            <div className="flex-1 overflow-auto" style={{ backgroundColor: 'var(--bg-base)' }}>
              {mode === 'unified' ? (
                <UnifiedDiff filePath={activeFile.filePath} changes={activeFile.changes} />
              ) : (
                <SplitDiff filePath={activeFile.filePath} changes={activeFile.changes} />
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
