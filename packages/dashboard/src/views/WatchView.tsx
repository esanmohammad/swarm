import { useState } from 'react';
import { Eye, Play, CheckCircle, XCircle, Wrench } from 'lucide-react';
import type { WsCommand } from '../types';
import { FeatureGuide } from '../components/FeatureGuide';
import { StateView } from '../components/StateView';

interface WatchResult {
  passed: boolean;
  output: string;
  testCmd: string;
  timestamp: number;
}

interface WatchViewProps {
  sendCommand: (cmd: WsCommand) => void;
  watchResults: WatchResult[];
}

export function WatchView({ sendCommand, watchResults }: WatchViewProps) {
  const [running, setRunning] = useState(false);
  const [selectedResult, setSelectedResult] = useState<WatchResult | null>(null);

  const handleRunTests = () => {
    setRunning(true);
    sendCommand({ action: 'run-watch-test' } as WsCommand);
    setTimeout(() => setRunning(false), 30000);
  };

  const handleFix = (result: WatchResult) => {
    sendCommand({
      action: 'run-watch-fix',
      testOutput: result.output,
      changedFiles: [],
    } as WsCommand);
  };

  const passed = watchResults.filter(r => r.passed).length;
  const failed = watchResults.filter(r => !r.passed).length;

  return (
    <div className="flex-1 flex flex-col p-6 overflow-hidden">
      <div className="max-w-4xl w-full mx-auto flex flex-col flex-1 min-h-0">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Eye size={18} className="text-emerald-400" />
            <h2 className="text-lg font-semibold text-stone-200">Watch Mode</h2>
          </div>
          <button
            onClick={handleRunTests}
            disabled={running}
            className="flex items-center gap-1.5 px-4 py-1.5 rounded-md text-xs font-medium text-white bg-blue-600 hover:bg-blue-500 disabled:bg-stone-700 disabled:text-stone-500 transition-colors"
          >
            <Play size={12} />
            {running ? 'Running...' : 'Run Tests Now'}
          </button>
        </div>

        <FeatureGuide
          featureId="watch"
          title="File Watcher"
          description="Watches files for changes and automatically runs tests. Great for TDD — save a file, tests run automatically."
          hasData={watchResults.length > 0}
          cliCommands={[
            { command: 'swarm watch', description: 'Start watching files for changes' },
            { command: 'swarm watch --test "npm test"', description: 'Watch with a custom test command' },
          ]}
        />

        <p className="text-xs text-stone-500 mb-4">
          Run tests on demand or use <code className="text-stone-400 bg-stone-800/60 px-1 py-0.5 rounded">swarm watch start</code> in your terminal for continuous file watching with auto-fix.
        </p>

        {/* Stats */}
        {watchResults.length > 0 && (
          <div className="grid grid-cols-3 gap-3 mb-4">
            <div className="p-3 rounded-lg bg-stone-900/40 border border-stone-800/40 text-center">
              <div className="text-lg font-semibold text-stone-200">{watchResults.length}</div>
              <div className="text-[10px] text-stone-500 uppercase">Runs</div>
            </div>
            <div className="p-3 rounded-lg bg-green-950/30 border border-green-800/20 text-center">
              <div className="text-lg font-semibold text-green-400">{passed}</div>
              <div className="text-[10px] text-stone-500 uppercase">Passed</div>
            </div>
            <div className="p-3 rounded-lg bg-red-950/30 border border-red-800/20 text-center">
              <div className="text-lg font-semibold text-red-400">{failed}</div>
              <div className="text-[10px] text-stone-500 uppercase">Failed</div>
            </div>
          </div>
        )}

        {/* Results list */}
        <div className="flex-1 min-h-0 overflow-auto space-y-2">
          {watchResults.length === 0 ? (
            <StateView
              status="empty"
              title="No watch results"
              message="No watch results yet. Start the watcher to auto-run tests on file changes."
              actions={[
                { label: 'Run Tests Now', onClick: handleRunTests, variant: 'primary' },
              ]}
            />
          ) : (
            [...watchResults].reverse().map((result, idx) => (
              <div
                key={`${result.timestamp}-${idx}`}
                className="p-3 rounded-lg bg-stone-900/40 border border-stone-800/40 hover:border-stone-700/40 transition-colors cursor-pointer"
                onClick={() => setSelectedResult(selectedResult?.timestamp === result.timestamp ? null : result)}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {result.passed ? (
                      <CheckCircle size={14} className="text-green-400" />
                    ) : (
                      <XCircle size={14} className="text-red-400" />
                    )}
                    <span className="text-xs font-medium text-stone-200">
                      {result.passed ? 'PASS' : 'FAIL'}
                    </span>
                    <span className="text-[10px] text-stone-500 font-mono">{result.testCmd}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    {!result.passed && (
                      <button
                        onClick={(e) => { e.stopPropagation(); handleFix(result); }}
                        className="flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium text-amber-300 bg-amber-600/15 border border-amber-500/30 hover:bg-amber-600/25 transition-colors"
                      >
                        <Wrench size={10} />
                        Auto-fix
                      </button>
                    )}
                    <span className="text-[10px] text-stone-500">
                      {new Date(result.timestamp).toLocaleTimeString()}
                    </span>
                  </div>
                </div>

                {selectedResult?.timestamp === result.timestamp && result.output && (
                  <pre className="mt-2 p-2 rounded bg-stone-950/60 text-[10px] text-stone-400 font-mono overflow-auto max-h-60 whitespace-pre-wrap">
                    {result.output}
                  </pre>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
