import { useMemo } from 'react';
import type { AgentActivity } from '../../types';

export interface DiffChange {
  type: 'edit' | 'write';
  oldString?: string;
  newString?: string;
  content?: string;
  timestamp: number;
}

export interface DiffFile {
  filePath: string;
  changes: DiffChange[];
  additions: number;
  deletions: number;
}

function extractFilePath(summary: string): string {
  const match = summary.match(/(?:^|\s)((?:\/|\.\/|[a-zA-Z])[^\s]+\.[a-zA-Z0-9]+)/);
  return match ? match[1] : summary;
}

function parseEditContent(content?: string): { old_string?: string; new_string?: string } {
  if (!content) return {};
  try {
    const parsed = JSON.parse(content);
    return { old_string: parsed.old_string, new_string: parsed.new_string };
  } catch {
    return {};
  }
}

export function useDiffData(activities: AgentActivity[]): DiffFile[] {
  return useMemo(() => {
    const changeMap = new Map<string, DiffChange[]>();

    for (const activity of activities) {
      if (activity.kind !== 'tool_use') continue;
      if (activity.tool !== 'Edit' && activity.tool !== 'Write') continue;

      const filePath = extractFilePath(activity.summary);
      if (!changeMap.has(filePath)) changeMap.set(filePath, []);

      if (activity.tool === 'Edit') {
        const { old_string, new_string } = parseEditContent(activity.content);
        changeMap.get(filePath)!.push({
          type: 'edit',
          oldString: old_string,
          newString: new_string,
          timestamp: activity.timestamp,
        });
      } else {
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

    const files: DiffFile[] = [];
    for (const [filePath, changes] of changeMap) {
      let additions = 0;
      let deletions = 0;
      for (const c of changes) {
        if (c.type === 'write') {
          additions += (c.content || '').split('\n').length;
        } else {
          deletions += (c.oldString || '').split('\n').filter(Boolean).length;
          additions += (c.newString || '').split('\n').filter(Boolean).length;
        }
      }
      files.push({ filePath, changes, additions, deletions });
    }

    return files;
  }, [activities]);
}
