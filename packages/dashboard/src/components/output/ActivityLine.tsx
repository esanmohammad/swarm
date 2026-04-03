import { ChevronDown, ChevronRight, FileText, Pencil, TerminalSquare, Search, Brain, FolderSearch, Globe, Zap } from 'lucide-react';
import type { AgentActivity } from '../../types';
import { MarkdownRenderer } from './MarkdownRenderer';

function toolMeta(tool?: string) {
  switch (tool) {
    case 'Read': return { icon: FileText, color: 'var(--accent)', prefix: 'READ' };
    case 'Edit': return { icon: Pencil, color: 'var(--status-warning)', prefix: 'EDIT' };
    case 'Write': return { icon: Pencil, color: 'var(--status-warning)', prefix: 'WRITE' };
    case 'Bash': return { icon: TerminalSquare, color: 'var(--status-success)', prefix: 'BASH' };
    case 'Grep': return { icon: Search, color: 'var(--activity-pipeline)', prefix: 'GREP' };
    case 'Glob': return { icon: FolderSearch, color: 'var(--activity-pipeline)', prefix: 'GLOB' };
    case 'Agent': return { icon: Zap, color: 'var(--status-error)', prefix: 'AGENT' };
    case 'WebSearch': return { icon: Globe, color: 'var(--activity-simplify)', prefix: 'SEARCH' };
    case 'WebFetch': return { icon: Globe, color: 'var(--activity-simplify)', prefix: 'FETCH' };
    default: return { icon: Zap, color: 'var(--text-tertiary)', prefix: tool?.toUpperCase() ?? 'TOOL' };
  }
}

/** Detect if text looks like markdown (has headings, lists, code blocks, bold, etc.) */
function looksLikeMarkdown(text: string): boolean {
  if (!text) return false;
  // Quick heuristic: check for common markdown patterns
  return /^#{1,6}\s/m.test(text) ||     // headings
    /\*\*.+\*\*/m.test(text) ||          // bold
    /^[-*+]\s/m.test(text) ||            // unordered list
    /^\d+[.)]\s/m.test(text) ||          // ordered list
    /^```/m.test(text) ||                // code blocks
    /^>/m.test(text);                    // blockquotes
}

interface ActivityLineProps {
  activity: AgentActivity;
  index: number;
  isExpanded: boolean;
  onToggleExpanded: (id: string) => void;
  /** When true, text activities auto-expand (used for the last text item) */
  isLastText?: boolean;
}

export function ActivityLine({ activity, index, isExpanded, onToggleExpanded, isLastText }: ActivityLineProps) {
  if (activity.kind === 'tool_result') return null;

  const hasExpandableContent = activity.content && activity.content.length > 200;
  const lineNum = String(index + 1).padStart(3, ' ');
  const time = new Date(activity.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

  // Text activities — render with markdown
  // Auto-expand if this is the last text activity (the agent's final answer)
  const effectiveExpanded = isExpanded || (isLastText && !!activity.content);
  if (activity.kind === 'text') {
    const fullText = activity.summary + (effectiveExpanded && activity.content ? '\n' + activity.content : '');
    const isMd = looksLikeMarkdown(fullText);

    return (
      <div
        className="group transition-colors"
        onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--bg-subtle)'}
        onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
      >
        <div className="flex items-start px-3 py-1.5">
          <span className="text-[10px] w-7 shrink-0 text-right pr-2 pt-0.5 tabular-nums select-none font-code" style={{ color: 'var(--text-tertiary)' }}>{lineNum}</span>
          <span className="w-1 shrink-0 mr-2 pt-0.5" style={{ color: 'var(--text-disabled)' }}>|</span>
          <div className="flex-1 min-w-0">
            {isMd ? (
              <MarkdownRenderer content={fullText} />
            ) : (
              <pre className="text-xs whitespace-pre-wrap break-words leading-relaxed font-ui" style={{ color: 'var(--text-primary)' }}>
                {activity.summary}
                {hasExpandableContent && !effectiveExpanded && <span style={{ color: 'var(--text-tertiary)' }}>...</span>}
                {effectiveExpanded && activity.content && (
                  <span style={{ color: 'var(--text-secondary)' }}>{'\n'}{activity.content}</span>
                )}
              </pre>
            )}
          </div>
          {hasExpandableContent && (
            <button onClick={() => onToggleExpanded(activity.id)} className="shrink-0 p-0.5 ml-1 mt-0.5" style={{ color: 'var(--text-tertiary)' }}>
              {isExpanded ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
            </button>
          )}
        </div>
      </div>
    );
  }

  // Tool use / thinking activities
  const meta = activity.kind === 'tool_use' ? toolMeta(activity.tool) : { icon: Brain, color: 'var(--activity-refactor)', prefix: 'THINK' };
  const Icon = meta.icon;

  return (
    <div
      className="group transition-colors"
      onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--bg-subtle)'}
      onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
    >
      <button
        onClick={() => hasExpandableContent && onToggleExpanded(activity.id)}
        aria-expanded={hasExpandableContent ? isExpanded : undefined}
        className={`w-full flex items-start px-3 py-1 text-left ${hasExpandableContent ? 'cursor-pointer' : 'cursor-default'}`}
      >
        <span className="text-[10px] w-7 shrink-0 text-right pr-2 pt-0.5 tabular-nums select-none font-code" style={{ color: 'var(--text-tertiary)' }}>{lineNum}</span>
        <span className="w-1 shrink-0 mr-2 pt-0.5" style={{ color: 'var(--text-disabled)' }}>|</span>
        <Icon size={11} className="shrink-0 mt-0.5 mr-1.5" style={{ color: meta.color }} />
        <span className="text-xs font-semibold font-ui shrink-0 mr-2 mt-px tracking-wider" style={{ color: meta.color }}>
          {meta.prefix}
        </span>
        <span className="text-xs truncate flex-1" style={{ color: 'var(--text-primary)' }}>{activity.summary}</span>
        <span className="text-[10px] shrink-0 ml-2 tabular-nums font-code" style={{ color: 'var(--text-tertiary)' }}>{time}</span>
        {hasExpandableContent && (
          <span className="shrink-0 ml-1" style={{ color: 'var(--text-tertiary)' }}>
            {isExpanded ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
          </span>
        )}
      </button>
      {isExpanded && activity.content && (
        <div className="pl-12 pr-3 pb-1.5">
          <pre
            className="text-[11px] font-code whitespace-pre-wrap break-words max-h-48 overflow-auto rounded px-2 py-1.5 leading-relaxed"
            style={{
              backgroundColor: 'var(--bg-inset)',
              color: 'var(--text-tertiary)',
              border: '1px solid var(--border-muted)',
            }}
          >
            {activity.content}
          </pre>
        </div>
      )}
    </div>
  );
}
