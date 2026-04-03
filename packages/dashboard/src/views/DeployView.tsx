import { useState } from 'react';
import { Upload, Play, AlertTriangle, CheckCircle, XCircle, RotateCcw, Loader2, MinusCircle } from 'lucide-react';
import { FeatureGuide } from '../components/FeatureGuide';
import { StateView } from '../components/StateView';
import type { WsCommand } from '../types';

interface DeployStep {
  name: string;
  cmd: string;
  status: 'pass' | 'fail' | 'skip' | 'pending';
  output?: string;
  durationMs: number;
}

interface DeployResult {
  environment: string;
  steps: DeployStep[];
  success: boolean;
  rolledBack: boolean;
  timestamp: number;
}

interface DeployViewProps {
  sendCommand: (cmd: WsCommand) => void;
  deployResult: DeployResult | null;
}

const STATUS_ICON = {
  pass: { icon: CheckCircle, color: 'text-green-400' },
  fail: { icon: XCircle, color: 'text-red-400' },
  skip: { icon: MinusCircle, color: 'text-stone-500' },
  pending: { icon: Loader2, color: 'text-blue-400 animate-spin' },
};

export function DeployView({ sendCommand, deployResult }: DeployViewProps) {
  const [env, setEnv] = useState('staging');
  const [dryRun, setDryRun] = useState(false);
  const [expandedStep, setExpandedStep] = useState<number | null>(null);

  const isRunning = deployResult?.steps.some(s => s.status === 'pending') ?? false;

  const handleDeploy = () => {
    sendCommand({ action: 'run-deploy', environment: env, dryRun } as WsCommand);
  };

  const handleRollback = () => {
    sendCommand({ action: 'run-deploy', environment: env } as WsCommand);
  };

  return (
    <div className="flex-1 flex flex-col p-6 overflow-hidden">
      <div className="max-w-4xl w-full mx-auto flex flex-col flex-1 min-h-0">
        <div className="flex items-center gap-2 mb-4">
          <Upload size={18} className="text-emerald-400" />
          <h2 className="text-lg font-semibold text-stone-200">Deploy</h2>
          <FeatureGuide
            featureId="deploy"
            title="Deploy"
            description="AI-assisted deployments with pre-flight checks, rollback support, and step-by-step execution visibility."
            cliCommands={[
              { command: 'swarm deploy staging', description: 'Deploy to staging environment' },
              { command: 'swarm deploy production', description: 'Deploy to production environment' },
            ]}
            hasData={!!deployResult}
          />
        </div>

        <p className="text-xs text-stone-500 mb-4">
          Deploy using steps defined in <code className="text-stone-400 bg-stone-800/60 px-1 py-0.5 rounded">.swarm/deploy.yaml</code>.
          Includes auto-rollback on failure.
        </p>

        {/* Controls */}
        <div className="flex items-center gap-3 mb-4 p-3 rounded-lg bg-stone-900/40 border border-stone-800/40">
          <div className="flex gap-2">
            {['staging', 'production'].map(e => (
              <button
                key={e}
                onClick={() => setEnv(e)}
                className={`px-3 py-1.5 rounded-md text-xs font-medium border transition-colors ${
                  env === e
                    ? e === 'production' ? 'bg-red-600/15 text-red-300 border-red-500/40' : 'bg-blue-600/20 text-blue-300 border-blue-500/40'
                    : 'text-stone-400 border-stone-700/40 hover:border-stone-600/50'
                }`}
              >
                {e}
              </button>
            ))}
          </div>

          <label className="flex items-center gap-1.5 text-xs text-stone-400 cursor-pointer">
            <input type="checkbox" checked={dryRun} onChange={e => setDryRun(e.target.checked)} className="rounded border-stone-600 bg-stone-800" />
            Dry run
          </label>

          <div className="flex-1" />

          {/* Rollback button (only show if last deploy failed) */}
          {deployResult && !deployResult.success && !deployResult.rolledBack && (
            <button
              onClick={handleRollback}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium text-amber-300 bg-amber-600/15 border border-amber-500/30 hover:bg-amber-600/25 transition-colors"
            >
              <RotateCcw size={12} />
              Rollback
            </button>
          )}

          <button
            onClick={handleDeploy}
            disabled={isRunning}
            className={`flex items-center gap-1.5 px-4 py-1.5 rounded-md text-xs font-semibold transition-colors ${
              env === 'production' && !dryRun
                ? 'bg-red-600 hover:bg-red-500 text-white'
                : 'bg-blue-600 hover:bg-blue-500 text-white'
            } disabled:bg-stone-700 disabled:text-stone-500`}
          >
            {isRunning ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />}
            {isRunning ? 'Deploying...' : `Deploy to ${env}`}
          </button>
        </div>

        {env === 'production' && !dryRun && (
          <div className="flex items-center gap-2 p-3 rounded-lg bg-red-950/20 border border-red-800/20 mb-4">
            <AlertTriangle size={14} className="text-red-400 shrink-0" />
            <span className="text-xs text-red-300">Production deployment — changes will be applied to live systems.</span>
          </div>
        )}

        {/* Results */}
        {deployResult ? (
          <div className="flex-1 min-h-0 overflow-auto space-y-2">
            {/* Status banner */}
            <div className={`p-3 rounded-lg border ${
              deployResult.success
                ? 'bg-green-950/20 border-green-800/20'
                : 'bg-red-950/20 border-red-800/20'
            }`}>
              <div className="flex items-center gap-2">
                {deployResult.success ? (
                  <CheckCircle size={16} className="text-green-400" />
                ) : (
                  <XCircle size={16} className="text-red-400" />
                )}
                <span className={`text-sm font-medium ${deployResult.success ? 'text-green-300' : 'text-red-300'}`}>
                  {deployResult.success ? `Deployed to ${deployResult.environment} successfully` : `Deploy to ${deployResult.environment} failed`}
                </span>
                {deployResult.rolledBack && (
                  <span className="text-xs text-amber-400 ml-2">(auto-rolled back)</span>
                )}
              </div>
            </div>

            {/* Step list */}
            {deployResult.steps.map((step, idx) => {
              const { icon: Icon, color } = STATUS_ICON[step.status];
              return (
                <div
                  key={idx}
                  className="rounded-lg bg-stone-900/40 border border-stone-800/40 hover:border-stone-700/40 transition-colors"
                >
                  <div
                    className="flex items-center gap-3 p-3 cursor-pointer"
                    onClick={() => setExpandedStep(expandedStep === idx ? null : idx)}
                  >
                    <Icon size={14} className={color} />
                    <div className="flex-1 min-w-0">
                      <span className="text-xs font-medium text-stone-200">{step.name}</span>
                      <span className="text-[10px] text-stone-500 ml-2 font-mono">{step.cmd}</span>
                    </div>
                    <span className="text-[10px] text-stone-500">{step.durationMs > 0 ? `${(step.durationMs / 1000).toFixed(1)}s` : ''}</span>
                  </div>

                  {expandedStep === idx && step.output && (
                    <div className="px-3 pb-3">
                      <pre className="p-2 rounded bg-stone-950/60 text-[10px] text-stone-400 font-mono whitespace-pre-wrap max-h-40 overflow-auto">
                        {step.output}
                      </pre>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <StateView
            status="empty"
            title="No deployments yet"
            message="Configure your deployment pipeline in .swarm/deploy.yaml, then run a deploy from here or the CLI."
          >
            <pre className="text-[10px] text-stone-400 font-mono leading-relaxed text-left mt-3 bg-stone-900/40 rounded-md p-3">{`staging:
  build: "docker build -t app:staging ."
  deploy: "kubectl apply -f k8s/staging/"
  healthcheck: "curl -f http://staging.internal/health"

production:
  promote: "kubectl set image deployment/app app=app:staging"
  healthcheck: "curl -f http://prod.internal/health"
  rollback: "kubectl rollout undo deployment/app"`}</pre>
          </StateView>
        )}
      </div>
    </div>
  );
}
