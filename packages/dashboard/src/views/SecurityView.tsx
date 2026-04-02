import { useState } from 'react';
import { Shield, Play, Loader2 } from 'lucide-react';
import type { WsCommand } from '../types';

interface SecurityViewProps {
  sendCommand: (cmd: WsCommand) => void;
}

export function SecurityView({ sendCommand }: SecurityViewProps) {
  const [sandboxMode, setSandboxMode] = useState<'strict' | 'moderate' | 'off'>('strict');
  const [running, setRunning] = useState<string | null>(null);

  const runAction = (action: string) => {
    setRunning(action);
    sendCommand({ action } as WsCommand);
    setTimeout(() => setRunning(null), 30000);
  };

  return (
    <div className="flex-1 flex flex-col p-6 overflow-hidden">
      <div className="max-w-4xl w-full mx-auto flex flex-col flex-1 min-h-0">
        <div className="flex items-center gap-2 mb-4">
          <Shield size={18} className="text-violet-400" />
          <h2 className="text-lg font-semibold text-stone-200">Security</h2>
        </div>

        <p className="text-xs text-stone-500 mb-6">
          Consolidated security dashboard. Run scans for vulnerabilities, secrets, and supply chain issues.
        </p>

        {/* Security Scan */}
        <div className="space-y-3 mb-6">
          <div className="p-4 rounded-lg bg-stone-900/40 border border-stone-800/40">
            <h3 className="text-xs font-medium text-stone-300 mb-2">Vulnerability Scan</h3>
            <p className="text-[10px] text-stone-500 mb-3">
              Scans codebase for known security vulnerabilities and unsafe patterns.
            </p>
            <button
              onClick={() => runAction('run-secure')}
              disabled={running === 'run-secure'}
              className="flex items-center gap-1.5 px-4 py-1.5 rounded-md text-xs font-medium text-white bg-blue-600 hover:bg-blue-500 disabled:bg-stone-700 disabled:text-stone-500 transition-colors"
            >
              {running === 'run-secure' ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />}
              {running === 'run-secure' ? 'Scanning...' : 'Run Security Scan'}
            </button>
          </div>

          <div className="p-4 rounded-lg bg-stone-900/40 border border-stone-800/40">
            <h3 className="text-xs font-medium text-stone-300 mb-2">Secret Detection</h3>
            <p className="text-[10px] text-stone-500 mb-3">
              Detects leaked secrets, API keys, tokens, and credentials in the codebase.
            </p>
            <button
              onClick={() => runAction('run-secrets-scan')}
              disabled={running === 'run-secrets-scan'}
              className="flex items-center gap-1.5 px-4 py-1.5 rounded-md text-xs font-medium text-white bg-blue-600 hover:bg-blue-500 disabled:bg-stone-700 disabled:text-stone-500 transition-colors"
            >
              {running === 'run-secrets-scan' ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />}
              {running === 'run-secrets-scan' ? 'Scanning...' : 'Run Secret Scan'}
            </button>
          </div>

          <div className="p-4 rounded-lg bg-stone-900/40 border border-stone-800/40">
            <h3 className="text-xs font-medium text-stone-300 mb-2">Supply Chain</h3>
            <p className="text-[10px] text-stone-500 mb-3">
              Checks dependencies for supply chain risks including typosquatting, license issues, and known malicious packages.
            </p>
            <button
              onClick={() => runAction('run-supply-chain-check')}
              disabled={running === 'run-supply-chain-check'}
              className="flex items-center gap-1.5 px-4 py-1.5 rounded-md text-xs font-medium text-white bg-blue-600 hover:bg-blue-500 disabled:bg-stone-700 disabled:text-stone-500 transition-colors"
            >
              {running === 'run-supply-chain-check' ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />}
              {running === 'run-supply-chain-check' ? 'Checking...' : 'Check Supply Chain'}
            </button>
          </div>

          <div className="p-4 rounded-lg bg-stone-900/40 border border-stone-800/40">
            <h3 className="text-xs font-medium text-stone-300 mb-2">Sandbox Mode</h3>
            <p className="text-[10px] text-stone-500 mb-3">
              Controls the sandbox isolation level for agent processes.
            </p>
            <div className="flex items-center gap-3">
              <div className="flex gap-2">
                {(['strict', 'moderate', 'off'] as const).map(mode => (
                  <button
                    key={mode}
                    onClick={() => setSandboxMode(mode)}
                    className={`px-3 py-1.5 rounded-md text-xs font-medium border transition-colors ${
                      sandboxMode === mode
                        ? mode === 'off' ? 'bg-red-600/15 text-red-300 border-red-500/40' : 'bg-blue-600/20 text-blue-300 border-blue-500/40'
                        : 'text-stone-400 border-stone-700/40 hover:border-stone-600/50'
                    }`}
                  >
                    {mode}
                  </button>
                ))}
              </div>
              <button
                onClick={() => sendCommand({ action: 'set-sandbox-mode', mode: sandboxMode } as WsCommand)}
                className="flex items-center gap-1.5 px-4 py-1.5 rounded-md text-xs font-medium text-white bg-blue-600 hover:bg-blue-500 transition-colors"
              >
                Set Mode
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
