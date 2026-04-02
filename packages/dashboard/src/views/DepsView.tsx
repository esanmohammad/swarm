import { useState } from 'react';
import { Package, Play, Loader2 } from 'lucide-react';
import type { WsCommand } from '../types';

interface DepsViewProps {
  sendCommand: (cmd: WsCommand) => void;
}

export function DepsView({ sendCommand }: DepsViewProps) {
  const [updateLevel, setUpdateLevel] = useState<'patch' | 'minor' | 'major'>('patch');
  const [running, setRunning] = useState<string | null>(null);

  const runAction = (action: string, extra?: Record<string, unknown>) => {
    setRunning(action);
    sendCommand({ action, ...extra } as WsCommand);
    setTimeout(() => setRunning(null), 30000);
  };

  return (
    <div className="flex-1 flex flex-col p-6 overflow-hidden">
      <div className="max-w-4xl w-full mx-auto flex flex-col flex-1 min-h-0">
        <div className="flex items-center gap-2 mb-4">
          <Package size={18} className="text-cyan-400" />
          <h2 className="text-lg font-semibold text-stone-200">Dependencies</h2>
        </div>

        <p className="text-xs text-stone-500 mb-6">
          Manage project dependencies. Check for outdated packages, apply updates, and run security audits.
        </p>

        <div className="space-y-3">
          <div className="p-4 rounded-lg bg-stone-900/40 border border-stone-800/40">
            <h3 className="text-xs font-medium text-stone-300 mb-2">Check Dependencies</h3>
            <p className="text-[10px] text-stone-500 mb-3">
              Scans for outdated, deprecated, or unused dependencies.
            </p>
            <button
              onClick={() => runAction('run-deps-check')}
              disabled={running === 'run-deps-check'}
              className="flex items-center gap-1.5 px-4 py-1.5 rounded-md text-xs font-medium text-white bg-blue-600 hover:bg-blue-500 disabled:bg-stone-700 disabled:text-stone-500 transition-colors"
            >
              {running === 'run-deps-check' ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />}
              {running === 'run-deps-check' ? 'Checking...' : 'Check Dependencies'}
            </button>
          </div>

          <div className="p-4 rounded-lg bg-stone-900/40 border border-stone-800/40">
            <h3 className="text-xs font-medium text-stone-300 mb-2">Update Dependencies</h3>
            <p className="text-[10px] text-stone-500 mb-3">
              Updates dependencies to the selected level. AI reviews changelogs for breaking changes.
            </p>
            <div className="flex items-center gap-3">
              <div className="flex gap-2">
                {(['patch', 'minor', 'major'] as const).map(level => (
                  <button
                    key={level}
                    onClick={() => setUpdateLevel(level)}
                    className={`px-3 py-1.5 rounded-md text-xs font-medium border transition-colors ${
                      updateLevel === level
                        ? level === 'major' ? 'bg-red-600/15 text-red-300 border-red-500/40' : 'bg-blue-600/20 text-blue-300 border-blue-500/40'
                        : 'text-stone-400 border-stone-700/40 hover:border-stone-600/50'
                    }`}
                  >
                    {level}
                  </button>
                ))}
              </div>
              <button
                onClick={() => runAction('run-deps-update', { level: updateLevel })}
                disabled={running === 'run-deps-update'}
                className="flex items-center gap-1.5 px-4 py-1.5 rounded-md text-xs font-medium text-white bg-blue-600 hover:bg-blue-500 disabled:bg-stone-700 disabled:text-stone-500 transition-colors"
              >
                {running === 'run-deps-update' ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />}
                {running === 'run-deps-update' ? 'Updating...' : `Update ${updateLevel}`}
              </button>
            </div>
          </div>

          <div className="p-4 rounded-lg bg-stone-900/40 border border-stone-800/40">
            <h3 className="text-xs font-medium text-stone-300 mb-2">Security Audit</h3>
            <p className="text-[10px] text-stone-500 mb-3">
              Runs a security audit on all dependencies and reports known vulnerabilities.
            </p>
            <button
              onClick={() => runAction('run-deps-audit')}
              disabled={running === 'run-deps-audit'}
              className="flex items-center gap-1.5 px-4 py-1.5 rounded-md text-xs font-medium text-white bg-blue-600 hover:bg-blue-500 disabled:bg-stone-700 disabled:text-stone-500 transition-colors"
            >
              {running === 'run-deps-audit' ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />}
              {running === 'run-deps-audit' ? 'Auditing...' : 'Security Audit'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
