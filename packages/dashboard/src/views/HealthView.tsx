import { useState } from 'react';
import { Activity, Play, Loader2 } from 'lucide-react';
import type { WsCommand } from '../types';

interface HealthViewProps {
  sendCommand: (cmd: WsCommand) => void;
}

export function HealthView({ sendCommand }: HealthViewProps) {
  const [running, setRunning] = useState(false);

  const handleRun = () => {
    setRunning(true);
    sendCommand({ action: 'run-health' } as WsCommand);
    setTimeout(() => setRunning(false), 30000);
  };

  return (
    <div className="flex-1 flex flex-col p-6 overflow-hidden">
      <div className="max-w-4xl w-full mx-auto flex flex-col flex-1 min-h-0">
        <div className="flex items-center gap-2 mb-4">
          <Activity size={18} className="text-green-400" />
          <h2 className="text-lg font-semibold text-stone-200">Codebase Health</h2>
        </div>

        <p className="text-xs text-stone-500 mb-6">
          Runs a comprehensive health check on the codebase including code quality, test coverage,
          dependency freshness, and technical debt analysis.
        </p>

        <div className="p-4 rounded-lg bg-stone-900/40 border border-stone-800/40 mb-4">
          <button
            onClick={handleRun}
            disabled={running}
            className="flex items-center gap-1.5 px-4 py-1.5 rounded-md text-xs font-medium text-white bg-blue-600 hover:bg-blue-500 disabled:bg-stone-700 disabled:text-stone-500 transition-colors"
          >
            {running ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />}
            {running ? 'Analyzing...' : 'Run Health Check'}
          </button>
        </div>

        {/* Empty state */}
        <div className="flex-1 rounded-lg border border-stone-800/30 bg-stone-900/20 flex items-center justify-center">
          <div className="text-center">
            <Activity size={36} className="text-stone-700 mx-auto mb-3" />
            <p className="text-xs text-stone-500">Run a health check to analyze your codebase.</p>
            <p className="text-[10px] text-stone-600 mt-1">
              CLI: <code className="text-stone-400 bg-stone-800/60 px-1 py-0.5 rounded">swarm health</code>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
