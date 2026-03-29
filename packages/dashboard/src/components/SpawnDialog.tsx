import { useState } from 'react';
import { Plus, X, Shield } from 'lucide-react';
import type { WsCommand, Persona, TechStack, PermissionMode } from '../types';

interface SpawnDialogProps {
  onSpawn: (cmd: WsCommand) => void;
  onClose: () => void;
}

const PERMISSION_OPTIONS: { value: PermissionMode; label: string; desc: string }[] = [
  { value: 'acceptEdits', label: 'Accept Edits', desc: 'Auto-approve file edits, prompt for bash' },
  { value: 'auto', label: 'Auto', desc: 'Auto-approve all safe actions' },
  { value: 'plan', label: 'Plan Only', desc: 'Read-only — explore but don\'t modify' },
  { value: 'bypassPermissions', label: 'Bypass All', desc: 'Skip all permission checks' },
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
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-[#0e0e0e] rounded-xl border border-stone-800/40 p-6 w-full max-w-lg" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-base font-semibold flex items-center gap-2 text-stone-200 tracking-wide">
            <Plus size={16} className="text-red-600" />
            Spawn Agent
          </h2>
          <button onClick={onClose} className="text-stone-400 hover:text-stone-400">
            <X size={16} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-[10px] text-stone-400 mb-1 uppercase tracking-wider">Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="my-agent"
              className="w-full px-3 py-2 bg-[#111] border border-stone-800/40 rounded-lg text-sm text-stone-300 placeholder-stone-500 focus:border-red-800/50 focus:outline-none"
              autoFocus
            />
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-[10px] text-stone-400 mb-1 uppercase tracking-wider">Persona</label>
              <select
                value={persona}
                onChange={(e) => setPersona(e.target.value as Persona)}
                className="w-full px-3 py-2 bg-[#111] border border-stone-800/40 rounded-lg text-sm text-stone-300 focus:border-red-800/50 focus:outline-none"
              >
                <option value="analyst">Analyst</option>
                <option value="architect">Architect</option>
                <option value="lead">Lead</option>
                <option value="engineer">Engineer</option>
              </select>
            </div>

            <div>
              <label className="block text-[10px] text-stone-400 mb-1 uppercase tracking-wider">Stack</label>
              <select
                value={stack}
                onChange={(e) => setStack(e.target.value as TechStack)}
                className="w-full px-3 py-2 bg-[#111] border border-stone-800/40 rounded-lg text-sm text-stone-300 focus:border-red-800/50 focus:outline-none"
              >
                <option value="react">React</option>
                <option value="node">Node.js</option>
                <option value="go">Go</option>
              </select>
            </div>

            <div>
              <label className="block text-[10px] text-stone-400 mb-1 uppercase tracking-wider">Model</label>
              <select
                value={model}
                onChange={(e) => setModel(e.target.value)}
                className="w-full px-3 py-2 bg-[#111] border border-stone-800/40 rounded-lg text-sm text-stone-300 focus:border-red-800/50 focus:outline-none"
              >
                <option value="opus">Opus</option>
                <option value="sonnet">Sonnet</option>
                <option value="haiku">Haiku</option>
              </select>
            </div>
          </div>

          <div>
            <label className="flex items-center gap-1.5 text-[10px] text-stone-400 mb-2 uppercase tracking-wider">
              <Shield size={10} />
              Permissions
            </label>
            <div className="grid grid-cols-1 gap-1.5">
              {PERMISSION_OPTIONS.map((opt) => (
                <label
                  key={opt.value}
                  className={`flex items-center gap-3 px-3 py-2 rounded-lg border cursor-pointer transition-colors ${
                    permissionMode === opt.value
                      ? 'border-red-800/40 bg-red-950/15'
                      : 'border-stone-800/30 bg-[#111] hover:border-stone-700'
                  }`}
                >
                  <input
                    type="radio"
                    name="permission"
                    value={opt.value}
                    checked={permissionMode === opt.value}
                    onChange={() => setPermissionMode(opt.value)}
                    className="sr-only"
                  />
                  <div className={`w-2.5 h-2.5 rounded-full border-2 flex items-center justify-center ${
                    permissionMode === opt.value ? 'border-red-600' : 'border-stone-700'
                  }`}>
                    {permissionMode === opt.value && (
                      <div className="w-1 h-1 rounded-full bg-red-500" />
                    )}
                  </div>
                  <div className="flex-1">
                    <span className="text-sm text-stone-300">{opt.label}</span>
                    <span className="text-[10px] text-stone-400 ml-2">{opt.desc}</span>
                  </div>
                </label>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-[10px] text-stone-400 mb-1 uppercase tracking-wider">Prompt</label>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Describe the task..."
              rows={3}
              className="w-full px-3 py-2 bg-[#111] border border-stone-800/40 rounded-lg text-sm text-stone-300 placeholder-stone-500 focus:border-red-800/50 focus:outline-none resize-none"
            />
          </div>

          <button
            type="submit"
            disabled={!name.trim()}
            className="w-full py-2.5 bg-red-900/40 hover:bg-red-800/40 disabled:bg-stone-900 disabled:text-stone-400 border border-red-800/30 hover:border-red-700/40 rounded-lg text-sm font-semibold text-red-300 tracking-wide transition-colors"
          >
            Spawn Agent
          </button>
        </form>
      </div>
    </div>
  );
}
