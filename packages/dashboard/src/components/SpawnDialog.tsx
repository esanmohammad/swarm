import { useState, useEffect } from 'react';
import { X } from 'lucide-react';
import type { WsCommand, Persona, TechStack, PermissionMode } from '../types';
import { useFocusTrap } from '../hooks/useFocusTrap';

interface SpawnDialogProps {
  onSpawn: (cmd: WsCommand) => void;
  onClose: () => void;
}

const PERSONA_DESCRIPTIONS: Record<string, string> = {
  analyst: 'Gathers requirements, asks clarifying questions',
  architect: 'Designs system architecture and technical spec',
  lead: 'Breaks work into tasks, plans execution order',
  engineer: 'Writes code, implements features and fixes',
};

const MODEL_DESCRIPTIONS: Record<string, string> = {
  opus: 'Best quality, slowest, most expensive',
  sonnet: 'Balanced speed and quality (recommended)',
  haiku: 'Fastest and cheapest, good for simple tasks',
};

const PERMISSION_OPTIONS: { value: PermissionMode; label: string; desc: string }[] = [
  { value: 'auto', label: 'Auto', desc: 'Full access — agent can read, write, and run commands' },
  { value: 'acceptEdits', label: 'Accept Edits', desc: 'Can read and edit files, but asks before running commands' },
  { value: 'plan', label: 'Read Only', desc: 'Can only read files — useful for analysis and review' },
];

const ADVANCED_PERMISSION_OPTIONS: { value: PermissionMode; label: string; desc: string }[] = [
  { value: 'bypassPermissions', label: 'Bypass All', desc: 'Skip all permission checks (use with caution)' },
];

export function SpawnDialog({ onSpawn, onClose }: SpawnDialogProps) {
  const [name, setName] = useState('');
  const [persona, setPersona] = useState<Persona>('engineer');
  const [stack, setStack] = useState<TechStack>('react');
  const [model, setModel] = useState('sonnet');
  const [prompt, setPrompt] = useState('');
  const [permissionMode, setPermissionMode] = useState<PermissionMode>('auto');
  const [showAdvancedPerms, setShowAdvancedPerms] = useState(false);
  const trapRef = useFocusTrap<HTMLDivElement>();

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    onSpawn({
      action: 'spawn',
      name: name.trim(),
      persona,
      stack,
      model: model || undefined,
      prompt: prompt || undefined,
      permissionMode,
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50" onClick={onClose} role="dialog" aria-modal="true" aria-label="Spawn Agent">
      <div
        ref={trapRef}
        className="bg-[#0e0c0b] rounded border border-stone-800/60 w-full max-w-lg font-mono mx-4"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Title bar */}
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-stone-800/50">
          <span className="text-xs text-stone-400">
            <span className="text-green-600">$</span> swarm spawn
          </span>
          <button onClick={onClose} className="text-stone-600 hover:text-stone-400 transition-colors">
            <X size={14} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          {/* Name */}
          <div>
            <label className="block text-xs font-ui text-stone-400 mb-1 tracking-wider">Agent Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="auth-engineer"
              className="w-full px-2.5 py-1.5 bg-[#0c0a09] border border-stone-800/50 rounded text-xs text-stone-300 placeholder-stone-600 focus:border-stone-600 focus:outline-none"
              autoFocus
            />
            <p className="text-[10px] text-stone-500 mt-1">A label for this agent (e.g., "auth-engineer", "api-fix")</p>
          </div>

          {/* Persona */}
          <div>
            <label className="block text-xs font-ui text-stone-400 mb-1 tracking-wider">Role</label>
            <select
              value={persona}
              onChange={(e) => setPersona(e.target.value as Persona)}
              className="w-full px-2.5 py-1.5 bg-[#0c0a09] border border-stone-800/50 rounded text-xs text-stone-300 focus:border-stone-600 focus:outline-none"
            >
              <option value="analyst">analyst</option>
              <option value="architect">architect</option>
              <option value="lead">lead</option>
              <option value="engineer">engineer</option>
            </select>
            <p className="text-[10px] text-stone-500 mt-1">{PERSONA_DESCRIPTIONS[persona]}</p>
          </div>

          {/* Stack / Model row */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-ui text-stone-400 mb-1 tracking-wider">Tech Stack</label>
              <select
                value={stack}
                onChange={(e) => setStack(e.target.value as TechStack)}
                className="w-full px-2.5 py-1.5 bg-[#0c0a09] border border-stone-800/50 rounded text-xs text-stone-300 focus:border-stone-600 focus:outline-none"
              >
                <option value="react">react</option>
                <option value="node">node</option>
                <option value="go">go</option>
                <option value="python">python</option>
                <option value="rust">rust</option>
                <option value="swift">swift</option>
                <option value="custom">custom</option>
              </select>
              <p className="text-[10px] text-stone-500 mt-1">Tailors the agent's prompts to your framework</p>
            </div>

            <div>
              <label className="block text-xs font-ui text-stone-400 mb-1 tracking-wider">Model</label>
              <select
                value={model}
                onChange={(e) => setModel(e.target.value)}
                className="w-full px-2.5 py-1.5 bg-[#0c0a09] border border-stone-800/50 rounded text-xs text-stone-300 focus:border-stone-600 focus:outline-none"
              >
                <option value="sonnet">sonnet</option>
                <option value="opus">opus</option>
                <option value="haiku">haiku</option>
              </select>
              <p className="text-[10px] text-stone-500 mt-1">{MODEL_DESCRIPTIONS[model]}</p>
            </div>
          </div>

          {/* Permissions */}
          <div>
            <label className="block text-xs font-ui text-stone-400 mb-1.5 tracking-wider">Permissions</label>
            <div className="grid grid-cols-3 gap-1.5">
              {PERMISSION_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setPermissionMode(opt.value)}
                  className={`px-2.5 py-1.5 rounded border text-left transition-colors ${
                    permissionMode === opt.value
                      ? 'border-stone-600 bg-stone-800/30 text-stone-300'
                      : 'border-stone-800/40 text-stone-500 hover:border-stone-700 hover:text-stone-400'
                  }`}
                >
                  <div className="text-[10px] font-medium">{opt.label}</div>
                  <div className="text-[10px] text-stone-500 mt-0.5">{opt.desc}</div>
                </button>
              ))}
            </div>
            {!showAdvancedPerms ? (
              <button
                type="button"
                onClick={() => setShowAdvancedPerms(true)}
                className="text-[10px] text-stone-500 hover:text-stone-400 mt-1.5 transition-colors"
              >
                Show advanced permissions
              </button>
            ) : (
              <div className="mt-1.5">
                {ADVANCED_PERMISSION_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setPermissionMode(opt.value)}
                    className={`w-full px-2.5 py-1.5 rounded border text-left transition-colors ${
                      permissionMode === opt.value
                        ? 'border-amber-700/50 bg-amber-950/20 text-amber-300'
                        : 'border-stone-800/40 text-stone-500 hover:border-stone-700 hover:text-stone-400'
                    }`}
                  >
                    <div className="text-[10px] font-medium">{opt.label}</div>
                    <div className="text-[10px] text-amber-500 mt-0.5">{opt.desc}</div>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Prompt */}
          <div>
            <label className="block text-xs font-ui text-stone-400 mb-1 tracking-wider">Task Description</label>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Implement JWT authentication middleware with refresh token rotation..."
              rows={3}
              className="w-full px-2.5 py-1.5 bg-[#0c0a09] border border-stone-800/50 rounded text-xs text-stone-300 placeholder-stone-600 focus:border-stone-600 focus:outline-none resize-none leading-relaxed"
            />
            <p className="text-[10px] text-stone-500 mt-1">What should this agent do? Be specific for best results.</p>
          </div>

          <button
            type="submit"
            disabled={!name.trim()}
            className="w-full py-2 bg-blue-600/20 hover:bg-blue-600/30 disabled:bg-stone-900/30 disabled:text-stone-700 border border-blue-500/30 hover:border-blue-500/40 rounded text-xs font-medium text-blue-300 tracking-wider transition-colors"
          >
            Spawn Agent
          </button>
        </form>
      </div>
    </div>
  );
}
