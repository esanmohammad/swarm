import { useState } from 'react';
import { Shield, Play } from 'lucide-react';
import type { WsCommand } from '../types';
import { FeatureGuide } from '../components/FeatureGuide';
import { ActionProgress } from '../components/ActionProgress';
import { useAction } from '../hooks/useAction';
import { featureGuides } from '../data/feature-guides';

interface SecurityViewProps {
  sendCommand: (cmd: WsCommand) => void;
}

export function SecurityView({ sendCommand }: SecurityViewProps) {
  const [sandboxMode, setSandboxMode] = useState<'strict' | 'moderate' | 'off'>('strict');
  const secureAction = useAction(sendCommand);
  const secretsAction = useAction(sendCommand);
  const supplyChainAction = useAction(sendCommand);
  const guide = featureGuides.security;

  return (
    <div className="flex-1 flex flex-col p-6 overflow-hidden">
      <div className="max-w-4xl w-full mx-auto flex flex-col flex-1 min-h-0">
        <div className="flex items-center gap-2 mb-4">
          <Shield size={18} className="text-violet-400" />
          <h2 className="text-lg font-semibold text-stone-200">Security</h2>
          <FeatureGuide
            featureId="security"
            title={guide.title}
            description="Scan your codebase for vulnerabilities, secret leaks, supply chain risks, and OWASP issues."
            setupSteps={[{ label: 'Run your first security scan', command: 'swarm secure' }]}
            cliCommands={[
              { command: 'swarm secure', description: 'Run full security scan' },
              { command: 'swarm secrets', description: 'Check for leaked secrets' },
              { command: 'swarm supply-chain', description: 'Supply chain audit' },
            ]}
            hasData={secureAction.state.status !== 'idle' || secretsAction.state.status !== 'idle' || supplyChainAction.state.status !== 'idle'}
          />
        </div>

        <p className="text-xs text-stone-500 mb-6">
          Consolidated security dashboard. Run scans for vulnerabilities, secrets, and supply chain issues.
        </p>

        {/* Action Progress */}
        {secureAction.state.status !== 'idle' && (
          <div className="mb-3">
            <ActionProgress state={secureAction.state} onCancel={secureAction.cancel} onRetry={() => secureAction.execute({ action: 'run-secure' } as WsCommand, 'Running security scan...')} onDismiss={secureAction.reset} />
          </div>
        )}
        {secretsAction.state.status !== 'idle' && (
          <div className="mb-3">
            <ActionProgress state={secretsAction.state} onCancel={secretsAction.cancel} onRetry={() => secretsAction.execute({ action: 'run-secrets-scan' } as WsCommand, 'Scanning for secrets...')} onDismiss={secretsAction.reset} />
          </div>
        )}
        {supplyChainAction.state.status !== 'idle' && (
          <div className="mb-3">
            <ActionProgress state={supplyChainAction.state} onCancel={supplyChainAction.cancel} onRetry={() => supplyChainAction.execute({ action: 'run-supply-chain-check' } as WsCommand, 'Checking supply chain...')} onDismiss={supplyChainAction.reset} />
          </div>
        )}

        {/* Security Scan */}
        <div className="space-y-3 mb-6">
          <div className="p-4 rounded-lg bg-stone-900/40 border border-stone-800/40">
            <h3 className="text-xs font-medium text-stone-300 mb-2">Vulnerability Scan</h3>
            <p className="text-[10px] text-stone-500 mb-3">
              Scans codebase for known security vulnerabilities and unsafe patterns.
            </p>
            <button
              onClick={() => secureAction.execute({ action: 'run-secure' } as WsCommand, 'Running security scan...')}
              disabled={secureAction.state.status === 'pending' || secureAction.state.status === 'running'}
              className="flex items-center gap-1.5 px-4 py-1.5 rounded-md text-xs font-medium text-white bg-blue-600 hover:bg-blue-500 disabled:bg-stone-700 disabled:text-stone-500 transition-colors"
            >
              <Play size={12} />
              Run Security Scan
            </button>
          </div>

          <div className="p-4 rounded-lg bg-stone-900/40 border border-stone-800/40">
            <h3 className="text-xs font-medium text-stone-300 mb-2">Secret Detection</h3>
            <p className="text-[10px] text-stone-500 mb-3">
              Detects leaked secrets, API keys, tokens, and credentials in the codebase.
            </p>
            <button
              onClick={() => secretsAction.execute({ action: 'run-secrets-scan' } as WsCommand, 'Scanning for secrets...')}
              disabled={secretsAction.state.status === 'pending' || secretsAction.state.status === 'running'}
              className="flex items-center gap-1.5 px-4 py-1.5 rounded-md text-xs font-medium text-white bg-blue-600 hover:bg-blue-500 disabled:bg-stone-700 disabled:text-stone-500 transition-colors"
            >
              <Play size={12} />
              Run Secret Scan
            </button>
          </div>

          <div className="p-4 rounded-lg bg-stone-900/40 border border-stone-800/40">
            <h3 className="text-xs font-medium text-stone-300 mb-2">Supply Chain</h3>
            <p className="text-[10px] text-stone-500 mb-3">
              Checks dependencies for supply chain risks including typosquatting, license issues, and known malicious packages.
            </p>
            <button
              onClick={() => supplyChainAction.execute({ action: 'run-supply-chain-check' } as WsCommand, 'Checking supply chain...')}
              disabled={supplyChainAction.state.status === 'pending' || supplyChainAction.state.status === 'running'}
              className="flex items-center gap-1.5 px-4 py-1.5 rounded-md text-xs font-medium text-white bg-blue-600 hover:bg-blue-500 disabled:bg-stone-700 disabled:text-stone-500 transition-colors"
            >
              <Play size={12} />
              Check Supply Chain
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
