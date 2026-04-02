import { useState } from 'react';
import { AlertTriangle, Play, Loader2 } from 'lucide-react';
import type { WsCommand } from '../types';

interface IncidentViewProps {
  sendCommand: (cmd: WsCommand) => void;
}

export function IncidentView({ sendCommand }: IncidentViewProps) {
  const [description, setDescription] = useState('');
  const [severity, setSeverity] = useState<'P1' | 'P2' | 'P3' | 'P4'>('P2');
  const [fix, setFix] = useState(false);
  const [running, setRunning] = useState(false);

  const handleRespond = () => {
    if (!description.trim()) return;
    setRunning(true);
    sendCommand({
      action: 'run-incident',
      description: description.trim(),
      severity,
      fix,
    } as WsCommand);
    setTimeout(() => setRunning(false), 30000);
  };

  return (
    <div className="flex-1 flex flex-col p-6 overflow-hidden">
      <div className="max-w-4xl w-full mx-auto flex flex-col flex-1 min-h-0">
        <div className="flex items-center gap-2 mb-4">
          <AlertTriangle size={18} className="text-red-400" />
          <h2 className="text-lg font-semibold text-stone-200">Incident Response</h2>
        </div>

        <p className="text-xs text-stone-500 mb-6">
          AI-assisted incident response. Describe the incident and severity to get diagnosis, root cause analysis, and optional automated fix.
        </p>

        <div className="space-y-3 mb-4">
          <textarea
            value={description}
            onChange={e => setDescription(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && e.metaKey && description.trim()) handleRespond(); }}
            placeholder='Describe the incident, e.g., "API returning 500 errors on /users endpoint since 2pm"'
            rows={3}
            className="w-full px-3 py-2 bg-stone-900/60 border border-stone-700/50 rounded-lg text-xs text-stone-200 placeholder-stone-500 focus:border-blue-600 focus:outline-none resize-none"
          />

          <div className="flex items-center gap-3 p-3 rounded-lg bg-stone-900/40 border border-stone-800/40">
            <div className="flex gap-2">
              {(['P1', 'P2', 'P3', 'P4'] as const).map(level => (
                <button
                  key={level}
                  onClick={() => setSeverity(level)}
                  className={`px-3 py-1.5 rounded-md text-xs font-medium border transition-colors ${
                    severity === level
                      ? level === 'P1' ? 'bg-red-600/15 text-red-300 border-red-500/40'
                        : level === 'P2' ? 'bg-orange-600/15 text-orange-300 border-orange-500/40'
                        : 'bg-blue-600/20 text-blue-300 border-blue-500/40'
                      : 'text-stone-400 border-stone-700/40 hover:border-stone-600/50'
                  }`}
                >
                  {level}
                </button>
              ))}
            </div>

            <label className="flex items-center gap-1.5 text-xs text-stone-400 cursor-pointer">
              <input
                type="checkbox"
                checked={fix}
                onChange={e => setFix(e.target.checked)}
                className="rounded border-stone-600 bg-stone-800"
              />
              Auto-fix
            </label>

            <div className="flex-1" />

            <button
              onClick={handleRespond}
              disabled={running || !description.trim()}
              className={`flex items-center gap-1.5 px-4 py-1.5 rounded-md text-xs font-semibold transition-colors ${
                severity === 'P1'
                  ? 'bg-red-600 hover:bg-red-500 text-white'
                  : 'bg-blue-600 hover:bg-blue-500 text-white'
              } disabled:bg-stone-700 disabled:text-stone-500`}
            >
              {running ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />}
              {running ? 'Responding...' : 'Respond'}
            </button>
          </div>
        </div>

        {/* Empty state */}
        <div className="flex-1 rounded-lg border border-stone-800/30 bg-stone-900/20 flex items-center justify-center">
          <div className="text-center">
            <AlertTriangle size={36} className="text-stone-700 mx-auto mb-3" />
            <p className="text-xs text-stone-500">Describe the incident above to begin response.</p>
            <p className="text-[10px] text-stone-600 mt-1">
              CLI: <code className="text-stone-400 bg-stone-800/60 px-1 py-0.5 rounded">swarm incident "description" --severity P1</code>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
