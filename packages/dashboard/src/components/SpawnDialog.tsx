import { useState } from 'react';
import { X } from 'lucide-react';
import type { WsCommand, Persona, TechStack, PermissionMode } from '../types';

interface SpawnDialogProps {
  onSpawn: (cmd: WsCommand) => void;
  onClose: () => void;
}

const PERMISSION_OPTIONS: { value: PermissionMode; label: string; desc: string }[] = [
  { value: 'acceptEdits', label: 'accept-edits', desc: 'auto-approve file edits' },
  { value: 'auto', label: 'auto', desc: 'auto-approve safe actions' },
  { value: 'plan', label: 'plan', desc: 'read-only exploration' },
  { value: 'bypassPermissions', label: 'bypass', desc: 'skip all checks' },
];

export function SpawnDialog({ onSpawn, onClose }: SpawnDialogProps) {
  const [name, setName] = useState('');
  const [persona, setPersona] = useState<Persona>('engineer');
  const [stack, setStack] = useState<TechStack>('react');
  const [model, setModel] = useState('opus');
  const [prompt, setPrompt] = useState('');
  const [permissionMode, setPermissionMode] = useState<PermissionMode>('acceptEdits');

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
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50" onClick={onClose}>
      <div
        className="bg-[#0e0c0b] rounded border border-stone-800/60 w-full max-w-lg font-mono"
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
            <label className="block text-[10px] text-stone-500 mb-1 tracking-wider">--name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="my-agent"
              className="w-full px-2.5 py-1.5 bg-[#0c0a09] border border-stone-800/50 rounded text-xs text-stone-300 placeholder-stone-600 focus:border-stone-600 focus:outline-none"
              autoFocus
            />
          </div>

          {/* Persona / Stack / Model row */}
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-[10px] text-stone-500 mb-1 tracking-wider">--persona</label>
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
            </div>

            <div>
              <label className="block text-[10px] text-stone-500 mb-1 tracking-wider">--stack</label>
              <select
                value={stack}
                onChange={(e) => setStack(e.target.value as TechStack)}
                className="w-full px-2.5 py-1.5 bg-[#0c0a09] border border-stone-800/50 rounded text-xs text-stone-300 focus:border-stone-600 focus:outline-none"
              >
                <option value="react">react</option>
                <option value="node">node</option>
                <option value="go">go</option>
              </select>
            </div>

            <div>
              <label className="block text-[10px] text-stone-500 mb-1 tracking-wider">--model</label>
              <select
                value={model}
                onChange={(e) => setModel(e.target.value)}
                className="w-full px-2.5 py-1.5 bg-[#0c0a09] border border-stone-800/50 rounded text-xs text-stone-300 focus:border-stone-600 focus:outline-none"
              >
                <option value="opus">opus</option>
                <option value="sonnet">sonnet</option>
                <option value="haiku">haiku</option>
              </select>
            </div>
          </div>

          {/* Permissions */}
          <div>
            <label className="block text-[10px] text-stone-500 mb-1.5 tracking-wider">--permission-mode</label>
            <div className="grid grid-cols-2 gap-1.5">
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
                  <div className="text-[9px] text-stone-600 mt-0.5">{opt.desc}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Prompt */}
          <div>
            <label className="block text-[10px] text-stone-500 mb-1 tracking-wider">-p</label>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="describe the task..."
              rows={3}
              className="w-full px-2.5 py-1.5 bg-[#0c0a09] border border-stone-800/50 rounded text-xs text-stone-300 placeholder-stone-600 focus:border-stone-600 focus:outline-none resize-none leading-relaxed"
            />
          </div>

          <button
            type="submit"
            disabled={!name.trim()}
            className="w-full py-2 bg-stone-800/40 hover:bg-stone-800/60 disabled:bg-stone-900/30 disabled:text-stone-700 border border-stone-700/40 hover:border-stone-600/50 rounded text-xs font-medium text-stone-300 tracking-wider transition-colors"
          >
            spawn
          </button>
        </form>
      </div>
    </div>
  );
}
