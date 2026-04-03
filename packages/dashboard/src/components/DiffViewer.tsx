import { useState, useMemo } from 'react';
import { FileText, Pencil, Plus } from 'lucide-react';
import type { AgentActivity } from '../types';

interface DiffViewerProps {
  activities: AgentActivity[];
}

interface FileChange {
  filePath: string;
  changes: {
    type: 'edit' | 'write';
    oldString?: string;
    newString?: string;
    content?: string;
    timestamp: number;
  }[];
}

function extractFilePath(summary: string): string {
  // Summary usually contains the file path — extract it
  // Common patterns: "Edit src/foo.ts", "Write src/bar.ts", or just a path
  const match = summary.match(/(?:^|\s)((?:\/|\.\/|[a-zA-Z])[^\s]+\.[a-zA-Z0-9]+)/);
  return match ? match[1] : summary;
}

function parseEditContent(content?: string): { old_string?: string; new_string?: string } {
  if (!content) return {};
  try {
    const parsed = JSON.parse(content);
    return { old_string: parsed.old_string, new_string: parsed.new_string };
  } catch {
    // Try to extract old_string / new_string from non-JSON content
    return {};
  }
}

function DiffBlock({ change }: { change: FileChange['changes'][number] }) {
  if (change.type === 'write') {
    const lines = (change.content || '').split('\n');
    return (
      <div className="mb-3">
        <div className="flex items-center gap-1.5 px-2 py-1 text-[10px] text-green-400 bg-green-950/20 border-b border-stone-800/30">
          <Plus size={10} />
          <span>new file</span>
          <span className="text-stone-500 ml-auto tabular-nums">
            {new Date(change.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
          </span>
        </div>
        <div className="text-[11px] leading-relaxed">
          {lines.slice(0, 50).map((line, i) => (
            <div key={i} className="flex bg-green-950/30">
              <span className="text-stone-500 w-10 shrink-0 text-right pr-2 select-none tabular-nums">{i + 1}</span>
              <span className="text-green-300 px-1">+</span>
              <pre className="text-green-300/80 whitespace-pre-wrap break-words">{line}</pre>
            </div>
          ))}
          {lines.length > 50 && (
            <div className="px-2 py-1 text-[10px] text-stone-500 italic">
              ... {lines.length - 50} more lines
            </div>
          )}
        </div>
      </div>
    );
  }

  // Edit type
  const oldLines = (change.oldString || '').split('\n');
  const newLines = (change.newString || '').split('\n');

  return (
    <div className="mb-3">
      <div className="flex items-center gap-1.5 px-2 py-1 text-[10px] text-amber-400 bg-amber-950/20 border-b border-stone-800/30">
        <Pencil size={10} />
        <span>edit</span>
        <span className="text-stone-500 ml-auto tabular-nums">
          {new Date(change.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
        </span>
      </div>
      <div className="text-[11px] leading-relaxed">
        {oldLines.map((line, i) => (
          <div key={`old-${i}`} className="flex bg-red-950/30">
            <span className="text-stone-500 w-10 shrink-0 text-right pr-2 select-none tabular-nums">{i + 1}</span>
            <span className="text-red-400 px-1">-</span>
            <pre className="text-red-300/80 whitespace-pre-wrap break-words">{line}</pre>
          </div>
        ))}
        {newLines.map((line, i) => (
          <div key={`new-${i}`} className="flex bg-green-950/30">
            <span className="text-stone-500 w-10 shrink-0 text-right pr-2 select-none tabular-nums">{i + 1}</span>
            <span className="text-green-300 px-1">+</span>
            <pre className="text-green-300/80 whitespace-pre-wrap break-words">{line}</pre>
          </div>
        ))}
      </div>
    </div>
  );
}

export function DiffViewer({ activities }: DiffViewerProps) {
  const fileChanges = useMemo(() => {
    const changeMap = new Map<string, FileChange['changes']>();

    for (const activity of activities) {
      if (activity.kind !== 'tool_use') continue;
      if (activity.tool !== 'Edit' && activity.tool !== 'Write') continue;

      const filePath = extractFilePath(activity.summary);

      if (!changeMap.has(filePath)) {
        changeMap.set(filePath, []);
      }

      if (activity.tool === 'Edit') {
        const { old_string, new_string } = parseEditContent(activity.content);
        changeMap.get(filePath)!.push({
          type: 'edit',
          oldString: old_string,
          newString: new_string,
          timestamp: activity.timestamp,
        });
      } else {
        // Write
        let content = activity.content || '';
        try {
          const parsed = JSON.parse(content);
          content = parsed.content || content;
        } catch { /* use raw */ }
        changeMap.get(filePath)!.push({
          type: 'write',
          content,
          timestamp: activity.timestamp,
        });
      }
    }

    const result: FileChange[] = [];
    for (const [filePath, changes] of changeMap) {
      result.push({ filePath, changes });
    }
    return result;
  }, [activities]);

  const [selectedFile, setSelectedFile] = useState<string | null>(null);

  const activeFile = selectedFile ?? fileChanges[0]?.filePath ?? null;
  const activeChanges = fileChanges.find(f => f.filePath === activeFile);

  if (fileChanges.length === 0) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center text-stone-400 font-mono">
          <FileText size={28} className="mx-auto mb-3 opacity-15" />
          <p className="text-xs">No file changes detected</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full font-mono">
      {/* File list */}
      <div className="w-52 shrink-0 border-r border-stone-800/50 overflow-auto bg-[#0b0908]">
        <div className="px-2 py-1.5 text-[10px] font-ui text-stone-400 uppercase tracking-wider border-b border-stone-800/30">
          Files changed ({fileChanges.length})
        </div>
        {fileChanges.map((fc) => {
          const isActive = fc.filePath === activeFile;
          const editCount = fc.changes.filter(c => c.type === 'edit').length;
          const writeCount = fc.changes.filter(c => c.type === 'write').length;
          return (
            <button
              key={fc.filePath}
              onClick={() => setSelectedFile(fc.filePath)}
              className={`w-full text-left px-2 py-1.5 text-[10px] transition-colors truncate flex items-center gap-1.5 ${
                isActive
                  ? 'bg-stone-800/40 text-stone-200'
                  : 'text-stone-400 hover:bg-stone-800/20 hover:text-stone-300'
              }`}
              title={fc.filePath}
            >
              <FileText size={10} className="shrink-0 text-stone-500" />
              <span className="truncate flex-1">{fc.filePath.split('/').pop()}</span>
              <span className="shrink-0 flex gap-1">
                {editCount > 0 && <span className="text-amber-400/70">{editCount}e</span>}
                {writeCount > 0 && <span className="text-green-400/70">{writeCount}w</span>}
              </span>
            </button>
          );
        })}
      </div>

      {/* Diff content */}
      <div className="flex-1 overflow-auto bg-[#0c0a09]">
        {activeChanges && (
          <>
            <div className="sticky top-0 z-10 px-3 py-1.5 text-[10px] text-stone-300 bg-[#0e0c0b] border-b border-stone-800/30 truncate">
              {activeChanges.filePath}
            </div>
            <div className="p-1">
              {activeChanges.changes.map((change, i) => (
                <DiffBlock key={i} change={change} />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
