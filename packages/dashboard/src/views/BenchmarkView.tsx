import { useState } from 'react';
import { Gauge, Play, Save } from 'lucide-react';
import type { WsCommand } from '../types';
import { FeatureGuide } from '../components/FeatureGuide';
import { StateView } from '../components/StateView';
import { ActionProgress } from '../components/ActionProgress';
import { useAction } from '../hooks/useAction';
import { featureGuides } from '../data/feature-guides';

interface BenchmarkViewProps {
  sendCommand: (cmd: WsCommand) => void;
}

export function BenchmarkView({ sendCommand }: BenchmarkViewProps) {
  const [command, setCommand] = useState('');
  const benchmarkAction = useAction(sendCommand, { timeout: 180000 });
  const guide = featureGuides.benchmark;

  const handleRun = () => {
    benchmarkAction.execute({
      action: 'run-benchmark',
      command: command.trim() || undefined,
    } as WsCommand, 'Running benchmark...');
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
          <FeatureGuide
            featureId="benchmark"
            title={guide.title}
            description="Run performance benchmarks and detect regressions. Compares against previous baselines to catch slowdowns."
            setupSteps={[{ label: 'Run your first benchmark', command: 'swarm benchmark' }]}
            cliCommands={[
              { command: 'swarm benchmark', description: 'Run benchmarks' },
              { command: 'swarm benchmark --save', description: 'Save as baseline' },
            ]}
            hasData={benchmarkAction.state.status !== 'idle'}
          />
        </div>

        <p className="text-xs text-stone-500 mb-6">
          Run performance benchmarks and compare against baselines.
          Results are saved for regression detection across runs.
        </p>

        {/* Action Progress */}
        {benchmarkAction.state.status !== 'idle' && (
          <div className="mb-3">
            <ActionProgress state={benchmarkAction.state} onCancel={benchmarkAction.cancel} onRetry={handleRun} onDismiss={benchmarkAction.reset} />
          </div>
        )}

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
              disabled={benchmarkAction.state.status === 'pending' || benchmarkAction.state.status === 'running'}
              className="flex items-center gap-1.5 px-4 py-1.5 rounded-md text-xs font-medium text-white bg-blue-600 hover:bg-blue-500 disabled:bg-stone-700 disabled:text-stone-500 transition-colors"
            >
              <Play size={12} />
              Run Benchmark
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
        {benchmarkAction.state.status === 'idle' && (
          <StateView
            status="empty"
            title="No benchmarks run yet"
            message="Run a benchmark to measure performance metrics like response time, throughput, and memory usage. Results are compared against saved baselines to detect regressions."
          />
        )}
      </div>
    </div>
  );
}
