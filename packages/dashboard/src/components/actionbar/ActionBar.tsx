import { useState, useRef, useEffect } from 'react';
import {
  Sparkles, Wrench, GitPullRequest, Search, RefreshCw, Minimize2,
} from 'lucide-react';
import type { WsCommand, PipelineState } from '../../types';

interface ActionBarProps {
  sendCommand: (cmd: WsCommand) => void;
  state: PipelineState;
}

const ACTIONS = [
  {
    id: 'build', label: 'Build Feature', hint: 'Full pipeline: requirements → design → code → test',
    icon: Sparkles, color: 'var(--activity-pipeline)', action: 'run-mayday', requiresPrompt: true,
    placeholder: 'Describe a feature to build...',
  },
  {
    id: 'fix', label: 'Fix Bug', hint: 'Describe a bug and an agent will fix it',
    icon: Wrench, color: 'var(--activity-fix)', action: 'run-fix', requiresPrompt: true,
    placeholder: 'Describe the bug...',
  },
  {
    id: 'review', label: 'Code Review', hint: 'Review local diff or paste a PR link',
    icon: GitPullRequest, color: 'var(--activity-review)', action: 'run-review', requiresPrompt: false,
    placeholder: 'Paste a PR link to review, or leave empty for local diff',
  },
  {
    id: 'spike', label: 'Research', hint: 'Investigate a question about the codebase',
    icon: Search, color: 'var(--activity-spike)', action: 'run-spike', requiresPrompt: true,
    placeholder: 'What do you want to investigate?',
  },
  {
    id: 'refactor', label: 'Refactor', hint: 'Restructure code without changing behavior',
    icon: RefreshCw, color: 'var(--activity-refactor)', action: 'run-refactor', requiresPrompt: true,
    placeholder: 'What should be refactored?',
  },
  {
    id: 'simplify', label: 'Clean Up', hint: 'Remove dead code and reduce complexity',
    icon: Minimize2, color: 'var(--activity-simplify)', action: 'run-simplify', requiresPrompt: false,
    placeholder: 'Analyzes your codebase automatically',
  },
] as const;

export function ActionBar({ sendCommand }: ActionBarProps) {
  const [prompt, setPrompt] = useState('');
  const [expanded, setExpanded] = useState(false);
  const [activeAction, setActiveAction] = useState<string>('run-mayday');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 120) + 'px';
    }
  }, [prompt]);

  const currentAction = ACTIONS.find((a) => a.action === activeAction) || ACTIONS[0];
  const canRun = !currentAction.requiresPrompt || prompt.trim().length > 0;

  const handleRun = () => {
    if (!canRun) return;
    const text = prompt.trim();
    // For review, pass text as `target` (PR link/number) instead of `prompt`
    if (activeAction === 'run-review') {
      sendCommand({ action: 'run-review', target: text || undefined } as WsCommand);
    } else {
      sendCommand({ action: activeAction, prompt: text || undefined } as WsCommand);
    }
    setPrompt('');
    setExpanded(false);
    setActiveAction('run-mayday');
  };

  const handleActionClick = (actionId: string) => {
    const action = ACTIONS.find((a) => a.action === actionId);
    if (!action) return;
    if (!action.requiresPrompt) {
      const text = prompt.trim();
      if (actionId === 'run-review') {
        sendCommand({ action: 'run-review', target: text || undefined } as WsCommand);
      } else {
        sendCommand({ action: actionId, prompt: text || undefined } as WsCommand);
      }
      setPrompt('');
      setExpanded(false);
      return;
    }
    setActiveAction(actionId);
    textareaRef.current?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleRun();
    }
    if (e.key === 'Escape') {
      setExpanded(false);
      textareaRef.current?.blur();
    }
  };

  const CurrentIcon = currentAction.icon;

  return (
    <div
      className="shrink-0 px-4 py-2"
      style={{ backgroundColor: 'var(--bg-surface)', borderTop: '1px solid var(--border-muted)' }}
    >
      <div
        className="rounded-lg overflow-hidden"
        style={{ backgroundColor: 'var(--bg-raised)', border: '1px solid var(--border-default)' }}
      >
        {/* Input row */}
        <div className="flex items-end gap-2 px-3 py-2">
          <textarea
            ref={textareaRef}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={handleKeyDown}
            onFocus={() => setExpanded(true)}
            placeholder={currentAction.placeholder}
            rows={1}
            className="flex-1 bg-transparent text-sm resize-none focus:outline-none min-h-[24px]"
            style={{ color: 'var(--text-primary)' }}
          />
          <button
            onClick={handleRun}
            disabled={!canRun}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-all disabled:opacity-30 shrink-0"
            style={{ backgroundColor: 'var(--accent-emphasis)', color: '#fff' }}
          >
            <CurrentIcon size={12} />
            {currentAction.label}
          </button>
        </div>

        {/* Expanded action picker */}
        {expanded && (
          <div
            className="flex items-center gap-1 px-3 py-1.5 overflow-x-auto"
            style={{ borderTop: '1px solid var(--border-muted)' }}
          >
            {ACTIONS.map((action) => {
              const Icon = action.icon;
              const isActive = action.action === activeAction;
              return (
                <button
                  key={action.id}
                  onClick={() => handleActionClick(action.action)}
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors whitespace-nowrap"
                  style={{
                    color: isActive ? action.color : 'var(--text-tertiary)',
                    backgroundColor: isActive ? 'var(--bg-emphasis)' : 'transparent',
                    border: isActive ? '1px solid var(--border-default)' : '1px solid transparent',
                  }}
                  title={action.hint}
                >
                  <Icon size={11} />
                  {action.label}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
