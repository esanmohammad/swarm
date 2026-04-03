import { useState } from 'react';
import {
  Sparkles, GitPullRequest, Minimize2,
  FileText, Blocks, ListChecks, Code2, TestTube2, ArrowRight,
} from 'lucide-react';
import type { WsCommand } from '../../types';

interface EmptyCanvasProps {
  sendCommand: (cmd: WsCommand) => void;
}

const QUICK_ACTIONS = [
  {
    id: 'review',
    label: 'Code Review',
    description: 'Review uncommitted changes in your working directory',
    icon: GitPullRequest,
    color: 'var(--activity-review)',
    action: 'run-review',
    needsPrompt: false,
  },
  {
    id: 'simplify',
    label: 'Clean Up',
    description: 'Find dead code, reduce complexity, simplify your codebase',
    icon: Minimize2,
    color: 'var(--activity-simplify)',
    action: 'run-simplify',
    needsPrompt: false,
  },
];

const HOW_IT_WORKS = [
  { icon: FileText, label: 'Understand', detail: 'Gathers requirements from your description', color: 'var(--activity-pipeline)' },
  { icon: Blocks, label: 'Design', detail: 'Architects the solution with component design', color: 'var(--accent)' },
  { icon: ListChecks, label: 'Plan', detail: 'Breaks work into parallelizable tasks', color: 'var(--status-warning)' },
  { icon: Code2, label: 'Code', detail: 'Engineers write the implementation', color: 'var(--status-error)' },
  { icon: TestTube2, label: 'Test', detail: 'Validates with an automated test plan', color: 'var(--status-success)' },
];

export function EmptyCanvas({ sendCommand }: EmptyCanvasProps) {
  const [prompt, setPrompt] = useState('');

  const handleBuild = () => {
    if (!prompt.trim()) return;
    sendCommand({ action: 'run-mayday', prompt: prompt.trim() });
    setPrompt('');
  };

  return (
    <div className="flex-1 flex items-center justify-center p-8 h-full overflow-y-auto">
      <div className="max-w-2xl w-full space-y-10">

        {/* Hero */}
        <div className="text-center space-y-2">
          <h1 className="text-xl font-semibold" style={{ color: 'var(--text-primary)' }}>
            What would you like to build?
          </h1>
          <p className="text-sm leading-relaxed max-w-md mx-auto" style={{ color: 'var(--text-secondary)' }}>
            Describe a feature in plain English. Hivemind will handle requirements, design, planning, coding, and testing automatically.
          </p>
        </div>

        {/* Main prompt */}
        <div
          className="rounded-xl overflow-hidden shadow-lg"
          style={{ border: '1px solid var(--border-default)', backgroundColor: 'var(--bg-surface)' }}
        >
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && prompt.trim()) {
                e.preventDefault();
                handleBuild();
              }
            }}
            placeholder='e.g. "Add dark mode with system preference detection and a toggle in settings"'
            rows={3}
            className="w-full px-5 py-4 text-sm bg-transparent resize-none focus:outline-none leading-relaxed"
            style={{ color: 'var(--text-primary)' }}
          />
          <div
            className="flex items-center justify-between px-5 py-3"
            style={{ borderTop: '1px solid var(--border-muted)', backgroundColor: 'var(--bg-raised)' }}
          >
            <span className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
              Press Enter to start building
            </span>
            <button
              onClick={handleBuild}
              disabled={!prompt.trim()}
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold transition-all disabled:opacity-30"
              style={{ backgroundColor: 'var(--accent-emphasis)', color: '#fff' }}
            >
              <Sparkles size={13} />
              Build Feature
            </button>
          </div>
        </div>

        {/* Quick actions */}
        <div className="grid grid-cols-2 gap-3">
          {QUICK_ACTIONS.map((qa) => {
            const Icon = qa.icon;
            return (
              <button
                key={qa.id}
                onClick={() => sendCommand({ action: qa.action } as WsCommand)}
                className="flex items-center gap-3 px-4 py-3 rounded-lg text-left transition-all group"
                style={{ backgroundColor: 'var(--bg-surface)', border: '1px solid var(--border-muted)' }}
                onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--border-default)'; e.currentTarget.style.backgroundColor = 'var(--bg-raised)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--border-muted)'; e.currentTarget.style.backgroundColor = 'var(--bg-surface)'; }}
              >
                <div
                  className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
                  style={{ backgroundColor: 'var(--bg-subtle)' }}
                >
                  <Icon size={15} style={{ color: qa.color }} />
                </div>
                <div className="min-w-0">
                  <div className="text-xs font-medium" style={{ color: 'var(--text-primary)' }}>{qa.label}</div>
                  <div className="text-[10px] leading-snug mt-0.5" style={{ color: 'var(--text-tertiary)' }}>{qa.description}</div>
                </div>
                <ArrowRight size={12} className="shrink-0 ml-auto opacity-0 group-hover:opacity-100 transition-opacity" style={{ color: 'var(--text-disabled)' }} />
              </button>
            );
          })}
        </div>

        {/* How it works */}
        <div>
          <div className="text-[10px] uppercase tracking-wider font-semibold mb-3 text-center" style={{ color: 'var(--text-tertiary)' }}>
            How "Build Feature" works
          </div>
          <div className="flex items-start gap-0">
            {HOW_IT_WORKS.map((step, i) => {
              const Icon = step.icon;
              return (
                <div key={step.label} className="flex items-center flex-1">
                  <div className="flex flex-col items-center text-center px-1">
                    <div
                      className="w-8 h-8 rounded-full flex items-center justify-center mb-1.5"
                      style={{ backgroundColor: 'var(--bg-subtle)' }}
                    >
                      <Icon size={13} style={{ color: step.color }} />
                    </div>
                    <span className="text-[10px] font-medium" style={{ color: step.color }}>{step.label}</span>
                    <span className="text-[9px] leading-tight mt-0.5 max-w-[100px]" style={{ color: 'var(--text-disabled)' }}>{step.detail}</span>
                  </div>
                  {i < HOW_IT_WORKS.length - 1 && (
                    <div className="w-6 h-px mt-[-16px] shrink-0" style={{ backgroundColor: 'var(--border-default)' }} />
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
