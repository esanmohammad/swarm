import { useState } from 'react';
import { Gauge, Play, Loader2, Save } from 'lucide-react';
import type { WsCommand } from '../types';

interface BenchmarkViewProps {
  sendCommand: (cmd: WsCommand) => void;
}

export function BenchmarkView({ sendCommand }: BenchmarkViewProps) {
  const [command, setCommand] = useState('');
  const [running, setRunning] = useState(false);

  const handleRun = () => {
    setRunning(true);
    sendCommand({
      action: 'run-benchmark',
      command: command.trim() || undefined,
    } as WsCommand);
    setTimeout(() => setRunning(false), 60000);
  };

  const handleSaveBaseline = () => {
    sendCommand({ action: 'save-benchmark-baseline' } as unknown as WsCommand);
  };

  return (
    <div className="flex-1 flex flex-col p-6 overflow-hidden">
      <div className="max-w-4xl w-full mx-auto flex flex-col flex-1 min-h-0">
        <div className="flex items-center gap-2 mb-4">
          <Gauge size={18} className="text-amber-400" />
          <h2 className="text-lg font-semibold text-stone-200">Benchmarks</h2>
        </div>

        <p className="text-xs text-stone-500 mb-6">
          Run performance benchmarks and compare against baselines.
          Results are saved for regression detection across runs.
        </p>

        <div className="space-y-3 mb-4">
          <input
            type="text"
            value={command}
            onChange={e => setCommand(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleRun(); }}
            placeholder="Custom benchmark command (optional, uses default if empty)"
            className="w-full px-3 py-2 bg-stone-900/60 border border-stone-700/50 rounded-lg text-xs text-stone-200 placeholder-stone-500 focus:border-blue-600 focus:outline-none"
          />

          <div className="flex items-center gap-3">
            <button
              onClick={handleRun}
              disabled={running}
              className="flex items-center gap-1.5 px-4 py-1.5 rounded-md text-xs font-medium text-white bg-blue-600 hover:bg-blue-500 disabled:bg-stone-700 disabled:text-stone-500 transition-colors"
            >
              {running ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />}
              {running ? 'Running...' : 'Run Benchmark'}
            </button>

            <button
              onClick={handleSaveBaseline}
              className="flex items-center gap-1.5 px-4 py-1.5 rounded-md text-xs font-medium text-stone-300 bg-stone-800/60 border border-stone-700/40 hover:border-stone-600/50 hover:text-stone-200 transition-colors"
            >
              <Save size={12} />
              Save Baseline
            </button>
          </div>
        </div>

        {/* Empty state */}
        <div className="flex-1 rounded-lg border border-stone-800/30 bg-stone-900/20 flex items-center justify-center">
          <div className="text-center">
            <Gauge size={36} className="text-stone-700 mx-auto mb-3" />
            <p className="text-xs text-stone-500">Run a benchmark to measure performance.</p>
            <p className="text-[10px] text-stone-600 mt-1">
              CLI: <code className="text-stone-400 bg-stone-800/60 px-1 py-0.5 rounded">swarm benchmark</code>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
