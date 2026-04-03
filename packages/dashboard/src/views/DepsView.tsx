import { useState } from 'react';
import { Package, Play } from 'lucide-react';
import type { WsCommand } from '../types';
import { FeatureGuide } from '../components/FeatureGuide';
import { ActionProgress } from '../components/ActionProgress';
import { useAction } from '../hooks/useAction';
import { featureGuides } from '../data/feature-guides';

interface DepsViewProps {
  sendCommand: (cmd: WsCommand) => void;
}

export function DepsView({ sendCommand }: DepsViewProps) {
  const [updateLevel, setUpdateLevel] = useState<'patch' | 'minor' | 'major'>('patch');
  const checkAction = useAction(sendCommand);
  const updateAction = useAction(sendCommand);
  const auditAction = useAction(sendCommand);
  const guide = featureGuides.deps;

  return (
    <div className="flex-1 flex flex-col p-6 overflow-hidden">
      <div className="max-w-4xl w-full mx-auto flex flex-col flex-1 min-h-0">
        <div className="flex items-center gap-2 mb-4">
          <Package size={18} className="text-cyan-400" />
          <h2 className="text-lg font-semibold text-stone-200">Dependencies</h2>
          <FeatureGuide
            featureId="deps"
            title={guide.title}
            description="Audit and update dependencies. Checks for outdated packages, security vulnerabilities, and license issues."
            setupSteps={[{ label: 'Run a dependency check', command: 'swarm deps' }]}
            cliCommands={[
              { command: 'swarm deps', description: 'Audit dependencies' },
              { command: 'swarm deps update', description: 'Update dependencies' },
            ]}
            hasData={checkAction.state.status !== 'idle' || updateAction.state.status !== 'idle' || auditAction.state.status !== 'idle'}
          />
        </div>

        <p className="text-xs text-stone-500 mb-6">
          Manage project dependencies. Check for outdated packages, apply updates, and run security audits.
        </p>

        {/* Action Progress */}
        {checkAction.state.status !== 'idle' && (
          <div className="mb-3">
            <ActionProgress state={checkAction.state} onCancel={checkAction.cancel} onRetry={() => checkAction.execute({ action: 'run-deps-check' } as WsCommand, 'Checking dependencies...')} onDismiss={checkAction.reset} />
          </div>
        )}
        {updateAction.state.status !== 'idle' && (
          <div className="mb-3">
            <ActionProgress state={updateAction.state} onCancel={updateAction.cancel} onRetry={() => updateAction.execute({ action: 'run-deps-update', level: updateLevel } as unknown as WsCommand, `Updating ${updateLevel} dependencies...`)} onDismiss={updateAction.reset} />
          </div>
        )}
        {auditAction.state.status !== 'idle' && (
          <div className="mb-3">
            <ActionProgress state={auditAction.state} onCancel={auditAction.cancel} onRetry={() => auditAction.execute({ action: 'run-deps-audit' } as WsCommand, 'Running security audit...')} onDismiss={auditAction.reset} />
          </div>
        )}

        <div className="space-y-3">
          <div className="p-4 rounded-lg bg-stone-900/40 border border-stone-800/40">
            <h3 className="text-xs font-medium text-stone-300 mb-2">Check Dependencies</h3>
            <p className="text-[10px] text-stone-500 mb-3">
              Scans for outdated, deprecated, or unused dependencies.
            </p>
            <button
              onClick={() => checkAction.execute({ action: 'run-deps-check' } as WsCommand, 'Checking dependencies...')}
              disabled={checkAction.state.status === 'pending' || checkAction.state.status === 'running'}
              className="flex items-center gap-1.5 px-4 py-1.5 rounded-md text-xs font-medium text-white bg-blue-600 hover:bg-blue-500 disabled:bg-stone-700 disabled:text-stone-500 transition-colors"
            >
              <Play size={12} />
              Check Dependencies
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
                onClick={() => updateAction.execute({ action: 'run-deps-update', level: updateLevel } as unknown as WsCommand, `Updating ${updateLevel} dependencies...`)}
                disabled={updateAction.state.status === 'pending' || updateAction.state.status === 'running'}
                className="flex items-center gap-1.5 px-4 py-1.5 rounded-md text-xs font-medium text-white bg-blue-600 hover:bg-blue-500 disabled:bg-stone-700 disabled:text-stone-500 transition-colors"
              >
                <Play size={12} />
                {`Update ${updateLevel}`}
              </button>
            </div>
          </div>

          <div className="p-4 rounded-lg bg-stone-900/40 border border-stone-800/40">
            <h3 className="text-xs font-medium text-stone-300 mb-2">Security Audit</h3>
            <p className="text-[10px] text-stone-500 mb-3">
              Runs a security audit on all dependencies and reports known vulnerabilities.
            </p>
            <button
              onClick={() => auditAction.execute({ action: 'run-deps-audit' } as WsCommand, 'Running security audit...')}
              disabled={auditAction.state.status === 'pending' || auditAction.state.status === 'running'}
              className="flex items-center gap-1.5 px-4 py-1.5 rounded-md text-xs font-medium text-white bg-blue-600 hover:bg-blue-500 disabled:bg-stone-700 disabled:text-stone-500 transition-colors"
            >
              <Play size={12} />
              Security Audit
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
