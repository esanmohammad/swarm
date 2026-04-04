import { useState } from 'react';
import {
  Sparkles, GitPullRequest, Minimize2,
  FileText, Blocks, ListChecks, Code2, TestTube2, ArrowRight,
  ChevronDown, ChevronRight, Settings2, Image, Zap, DollarSign,
} from 'lucide-react';
import type { WsCommand } from '../../types';

interface EmptyCanvasProps {
  sendCommand: (cmd: WsCommand) => void;
}

const QUICK_ACTIONS = [
  { id: 'review', label: 'Code Review', description: 'Review uncommitted changes in your working directory', icon: GitPullRequest, color: 'var(--activity-review)', action: 'run-review' },
  { id: 'simplify', label: 'Clean Up', description: 'Find dead code, reduce complexity, simplify your codebase', icon: Minimize2, color: 'var(--activity-simplify)', action: 'run-simplify' },
];

const HOW_IT_WORKS = [
  { icon: FileText, label: 'Understand', detail: 'Gathers requirements', color: 'var(--activity-pipeline)' },
  { icon: Blocks, label: 'Design', detail: 'Plans architecture', color: 'var(--accent)' },
  { icon: ListChecks, label: 'Plan', detail: 'Creates task breakdown', color: 'var(--status-warning)' },
  { icon: Code2, label: 'Code', detail: 'Writes implementation', color: 'var(--status-error)' },
  { icon: TestTube2, label: 'Test', detail: 'Validates with tests', color: 'var(--status-success)' },
];

const MODELS = [
  { id: 'opus', label: 'Opus', desc: 'Most capable, highest quality', tier: 'Premium' },
  { id: 'sonnet', label: 'Sonnet', desc: 'Fast and capable, good balance', tier: 'Standard' },
  { id: 'haiku', label: 'Haiku', desc: 'Fastest and cheapest', tier: 'Economy' },
];

const MODES = [
  { id: 'full', label: 'Full', desc: 'All stages with best models' },
  { id: 'lean', label: 'Lean', desc: 'Haiku for docs, default for code — saves ~60% on early stages' },
];

export function EmptyCanvas({ sendCommand }: EmptyCanvasProps) {
  const [prompt, setPrompt] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [model, setModel] = useState('');
  const [figmaUrl, setFigmaUrl] = useState('');
  const [mode, setMode] = useState<'full' | 'lean'>('full');
  const [budget, setBudget] = useState('');

  const handleBuild = () => {
    if (!prompt.trim()) return;
    const cmd: WsCommand = {
      action: 'run-mayday',
      prompt: prompt.trim(),
      ...(model && { model }),
      ...(figmaUrl.trim() && { figmaUrl: figmaUrl.trim() }),
      ...(mode === 'lean' && { lean: true }),
      ...(budget && { maxFixBudgetUsd: parseFloat(budget) }),
    };
    sendCommand(cmd);
    setPrompt('');
    setFigmaUrl('');
  };

  return (
    <div className="flex-1 flex items-center justify-center p-8 h-full overflow-y-auto">
      <div className="max-w-2xl w-full space-y-8">

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

          {/* Figma URL (always visible below prompt for easy access) */}
          <div className="px-5 py-2" style={{ borderTop: '1px solid var(--border-muted)' }}>
            <div className="flex items-center gap-2">
              <Image size={12} style={{ color: 'var(--text-disabled)' }} />
              <input
                value={figmaUrl}
                onChange={(e) => setFigmaUrl(e.target.value)}
                placeholder="Paste Figma URL for design reference (optional)"
                className="flex-1 bg-transparent text-xs focus:outline-none"
                style={{ color: 'var(--text-primary)' }}
              />
            </div>
          </div>

          {/* Advanced options toggle */}
          <div className="px-5 py-2" style={{ borderTop: '1px solid var(--border-muted)' }}>
            <button
              onClick={() => setShowAdvanced(!showAdvanced)}
              className="flex items-center gap-1.5 text-[11px] font-medium transition-colors"
              style={{ color: 'var(--text-tertiary)' }}
            >
              <Settings2 size={11} />
              Options
              {showAdvanced ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
            </button>
          </div>

          {/* Advanced options */}
          {showAdvanced && (
            <div className="px-5 py-3 space-y-3" style={{ borderTop: '1px solid var(--border-muted)', backgroundColor: 'var(--bg-raised)' }}>
              {/* Model selector */}
              <div>
                <label className="text-[10px] uppercase tracking-wider font-semibold mb-1.5 block" style={{ color: 'var(--text-tertiary)' }}>
                  Model
                </label>
                <div className="flex gap-2">
                  {MODELS.map((m) => (
                    <button
                      key={m.id}
                      onClick={() => setModel(model === m.id ? '' : m.id)}
                      className="flex-1 px-3 py-2 rounded-md text-left transition-colors"
                      style={{
                        backgroundColor: model === m.id ? 'var(--accent-muted)' : 'var(--bg-overlay)',
                        color: model === m.id ? 'var(--accent)' : 'var(--text-secondary)',
                        border: model === m.id ? '1px solid var(--border-active)' : '1px solid var(--border-muted)',
                      }}
                    >
                      <div className="text-xs font-medium">{m.label}</div>
                      <div className="text-[10px] mt-0.5" style={{ color: 'var(--text-disabled)' }}>{m.desc}</div>
                    </button>
                  ))}
                </div>
                {!model && (
                  <p className="text-[10px] mt-1" style={{ color: 'var(--text-disabled)' }}>
                    Default: uses project config or Opus
                  </p>
                )}
              </div>

              {/* Mode selector */}
              <div>
                <label className="text-[10px] uppercase tracking-wider font-semibold mb-1.5 block" style={{ color: 'var(--text-tertiary)' }}>
                  Mode
                </label>
                <div className="flex gap-2">
                  {MODES.map((m) => (
                    <button
                      key={m.id}
                      onClick={() => setMode(m.id as 'full' | 'lean')}
                      className="flex-1 px-3 py-2 rounded-md text-left transition-colors"
                      style={{
                        backgroundColor: mode === m.id ? 'var(--accent-muted)' : 'var(--bg-overlay)',
                        color: mode === m.id ? 'var(--accent)' : 'var(--text-secondary)',
                        border: mode === m.id ? '1px solid var(--border-active)' : '1px solid var(--border-muted)',
                      }}
                    >
                      <div className="flex items-center gap-1.5">
                        <Zap size={10} />
                        <span className="text-xs font-medium">{m.label}</span>
                      </div>
                      <div className="text-[10px] mt-0.5" style={{ color: 'var(--text-disabled)' }}>{m.desc}</div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Budget */}
              <div>
                <label className="text-[10px] uppercase tracking-wider font-semibold mb-1.5 block" style={{ color: 'var(--text-tertiary)' }}>
                  Budget limit
                </label>
                <div
                  className="flex items-center gap-2 px-3 py-1.5 rounded-md"
                  style={{ backgroundColor: 'var(--bg-overlay)', border: '1px solid var(--border-muted)' }}
                >
                  <DollarSign size={11} style={{ color: 'var(--text-disabled)' }} />
                  <input
                    type="number"
                    value={budget}
                    onChange={(e) => setBudget(e.target.value)}
                    placeholder="No limit"
                    min="0"
                    step="1"
                    className="flex-1 bg-transparent text-xs font-code focus:outline-none"
                    style={{ color: 'var(--text-primary)' }}
                  />
                  <span className="text-[10px]" style={{ color: 'var(--text-disabled)' }}>USD max spend</span>
                </div>
                <p className="text-[10px] mt-1" style={{ color: 'var(--text-disabled)' }}>
                  You'll be prompted to increase if the limit is reached — agents won't be killed automatically.
                </p>
              </div>
            </div>
          )}

          {/* Launch bar */}
          <div
            className="flex items-center justify-between px-5 py-3"
            style={{ borderTop: '1px solid var(--border-muted)', backgroundColor: 'var(--bg-raised)' }}
          >
            <div className="flex items-center gap-2">
              <span className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
                Enter to start
              </span>
              {(model || mode === 'lean' || figmaUrl) && (
                <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ backgroundColor: 'var(--bg-subtle)', color: 'var(--text-disabled)' }}>
                  {[model && model, mode === 'lean' && 'lean', figmaUrl && 'figma'].filter(Boolean).join(' · ')}
                </span>
              )}
            </div>
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
                <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ backgroundColor: 'var(--bg-subtle)' }}>
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
            How it works
          </div>
          <div className="flex items-start gap-0">
            {HOW_IT_WORKS.map((step, i) => {
              const Icon = step.icon;
              return (
                <div key={step.label} className="flex items-center flex-1">
                  <div className="flex flex-col items-center text-center px-1">
                    <div className="w-8 h-8 rounded-full flex items-center justify-center mb-1.5" style={{ backgroundColor: 'var(--bg-subtle)' }}>
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
