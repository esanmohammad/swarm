import { useState } from 'react';
import { Plus, X, Shield } from 'lucide-react';
import type { WsCommand, Persona, TechStack, PermissionMode } from '../types';

interface SpawnDialogProps {
  onSpawn: (cmd: WsCommand) => void;
  onClose: () => void;
}

// Only modes that work in non-interactive (dashboard) mode.
// "default" (ask) requires a terminal for user input — not possible from the dashboard.
const PERMISSION_OPTIONS: { value: PermissionMode; label: string; desc: string }[] = [
  { value: 'acceptEdits', label: 'Accept Edits', desc: 'Auto-approve file edits, prompt for bash/shell' },
  { value: 'auto', label: 'Auto', desc: 'Auto-approve all safe actions based on project settings' },
  { value: 'plan', label: 'Plan Only', desc: 'Read-only — agent can explore but not modify anything' },
  { value: 'bypassPermissions', label: 'Bypass All', desc: 'Skip all permission checks (use with caution)' },
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
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-gray-900 rounded-xl border border-gray-700 p-6 w-full max-w-lg" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Plus size={18} />
            Spawn Agent
          </h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300">
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs text-gray-400 mb-1">Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="my-agent"
              className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm focus:border-cyan-500 focus:outline-none"
              autoFocus
            />
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs text-gray-400 mb-1">Persona</label>
              <select
                value={persona}
                onChange={(e) => setPersona(e.target.value as Persona)}
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm focus:border-cyan-500 focus:outline-none"
              >
                <option value="analyst">Analyst</option>
                <option value="architect">Architect</option>
                <option value="lead">Lead</option>
                <option value="engineer">Engineer</option>
              </select>
            </div>

            <div>
              <label className="block text-xs text-gray-400 mb-1">Stack</label>
              <select
                value={stack}
                onChange={(e) => setStack(e.target.value as TechStack)}
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm focus:border-cyan-500 focus:outline-none"
              >
                <option value="react">React</option>
                <option value="node">Node.js</option>
                <option value="go">Go</option>
              </select>
            </div>

            <div>
              <label className="block text-xs text-gray-400 mb-1">Model</label>
              <select
                value={model}
                onChange={(e) => setModel(e.target.value)}
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm focus:border-cyan-500 focus:outline-none"
              >
                <option value="opus">Opus</option>
                <option value="sonnet">Sonnet</option>
                <option value="haiku">Haiku</option>
              </select>
            </div>
          </div>

          {/* Permission Mode */}
          <div>
            <label className="flex items-center gap-1.5 text-xs text-gray-400 mb-2">
              <Shield size={12} />
              Permissions
            </label>
            <div className="grid grid-cols-1 gap-1.5">
              {PERMISSION_OPTIONS.map((opt) => (
                <label
                  key={opt.value}
                  className={`flex items-center gap-3 px-3 py-2 rounded-lg border cursor-pointer transition-colors ${
                    permissionMode === opt.value
                      ? 'border-cyan-500 bg-cyan-950/30'
                      : 'border-gray-700 bg-gray-800 hover:border-gray-600'
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
                  <div className={`w-3 h-3 rounded-full border-2 flex items-center justify-center ${
                    permissionMode === opt.value ? 'border-cyan-400' : 'border-gray-600'
                  }`}>
                    {permissionMode === opt.value && (
                      <div className="w-1.5 h-1.5 rounded-full bg-cyan-400" />
                    )}
                  </div>
                  <div className="flex-1">
                    <span className="text-sm text-gray-200">{opt.label}</span>
                    <span className="text-xs text-gray-500 ml-2">{opt.desc}</span>
                  </div>
                </label>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-xs text-gray-400 mb-1">Prompt</label>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Describe the task for this agent (e.g. 'Add user auth with JWT tokens')"
              rows={3}
              className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm focus:border-cyan-500 focus:outline-none resize-none"
            />
          </div>

          <button
            type="submit"
            disabled={!name.trim()}
            className="w-full py-2 bg-cyan-600 hover:bg-cyan-500 disabled:bg-gray-700 disabled:text-gray-500 rounded-lg text-sm font-medium transition-colors"
          >
            Spawn Agent
          </button>
        </form>
      </div>
    </div>
  );
}
