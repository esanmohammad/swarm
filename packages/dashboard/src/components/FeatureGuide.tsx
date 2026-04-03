import { useState } from 'react';
import { HelpCircle, ChevronUp, Check, X, Copy, ExternalLink } from 'lucide-react';
import { usePersistedState } from '../hooks/usePersistedState';

interface SetupStep {
  label: string;
  command?: string;
  done?: boolean;
}

interface FeatureGuideProps {
  featureId: string;
  title: string;
  description: string;
  setupSteps?: SetupStep[];
  prerequisites?: Array<{ label: string; met: boolean }>;
  cliCommands?: Array<{ command: string; description: string }>;
  learnMoreUrl?: string;
  hasData: boolean;
  children?: React.ReactNode;
}

export function FeatureGuide({
  featureId,
  title,
  description,
  setupSteps,
  prerequisites,
  cliCommands,
  learnMoreUrl,
  hasData,
  children,
}: FeatureGuideProps) {
  const [dismissed, setDismissed] = usePersistedState(`swarm_guide_${featureId}`, false);
  const [showGuide, setShowGuide] = useState(false);
  const [copiedCmd, setCopiedCmd] = useState<string | null>(null);

  const shouldShow = !hasData && !dismissed;
  const isVisible = shouldShow || showGuide;

  const copyCommand = (cmd: string) => {
    navigator.clipboard.writeText(cmd);
    setCopiedCmd(cmd);
    setTimeout(() => setCopiedCmd(null), 2000);
  };

  return (
    <>
      {/* Help toggle button - always visible in header area */}
      {!shouldShow && (
        <button
          onClick={() => setShowGuide(!showGuide)}
          className="inline-flex items-center gap-1 text-xs text-stone-500 hover:text-stone-400 transition-colors"
          title={`How ${title} works`}
        >
          <HelpCircle size={13} />
          <span>Guide</span>
        </button>
      )}

      {isVisible && (
        <div className="mb-4 rounded-lg border border-stone-800/60 bg-stone-900/40 overflow-hidden">
          <div className="px-4 py-3 flex items-center justify-between border-b border-stone-800/40">
            <div className="flex items-center gap-2">
              <HelpCircle size={14} className="text-blue-400" />
              <span className="text-sm font-medium text-stone-300">How {title} Works</span>
            </div>
            <div className="flex items-center gap-1">
              {showGuide && (
                <button onClick={() => setShowGuide(false)} className="text-stone-500 hover:text-stone-400 p-1">
                  <ChevronUp size={14} />
                </button>
              )}
              {shouldShow && (
                <button
                  onClick={() => setDismissed(true)}
                  className="text-xs text-stone-500 hover:text-stone-400 px-2 py-1 rounded hover:bg-stone-800/50"
                >
                  Dismiss
                </button>
              )}
            </div>
          </div>

          <div className="px-4 py-3 space-y-3">
            <p className="text-xs text-stone-400 leading-relaxed">{description}</p>

            {/* Prerequisites */}
            {prerequisites && prerequisites.length > 0 && (
              <div>
                <h4 className="text-xs font-medium text-stone-400 mb-1.5">Prerequisites</h4>
                <div className="space-y-1">
                  {prerequisites.map((p) => (
                    <div key={p.label} className="flex items-center gap-2 text-xs">
                      {p.met ? (
                        <Check size={12} className="text-green-500" />
                      ) : (
                        <X size={12} className="text-red-500" />
                      )}
                      <span className={p.met ? 'text-stone-400' : 'text-stone-300'}>{p.label}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Setup Steps */}
            {setupSteps && setupSteps.length > 0 && (
              <div>
                <h4 className="text-xs font-medium text-stone-400 mb-1.5">Setup</h4>
                <ol className="space-y-1.5">
                  {setupSteps.map((step, i) => (
                    <li key={i} className="flex items-start gap-2 text-xs">
                      <span className="text-stone-600 shrink-0 w-4 text-right">{i + 1}.</span>
                      <div>
                        <span className="text-stone-400">{step.label}</span>
                        {step.command && (
                          <button
                            onClick={() => copyCommand(step.command!)}
                            className="ml-1.5 inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-stone-800/60 text-stone-400 hover:text-stone-300 font-mono text-[10px]"
                          >
                            <code>{step.command}</code>
                            {copiedCmd === step.command ? <Check size={10} className="text-green-400" /> : <Copy size={10} />}
                          </button>
                        )}
                      </div>
                    </li>
                  ))}
                </ol>
              </div>
            )}

            {/* CLI Commands */}
            {cliCommands && cliCommands.length > 0 && (
              <div>
                <h4 className="text-xs font-medium text-stone-400 mb-1.5">CLI Commands</h4>
                <div className="space-y-1">
                  {cliCommands.map((c) => (
                    <div key={c.command} className="flex items-center gap-2">
                      <button
                        onClick={() => copyCommand(c.command)}
                        className="inline-flex items-center gap-1.5 px-2 py-1 rounded bg-stone-800/60 text-stone-400 hover:text-stone-300 font-mono text-[10px]"
                      >
                        <code>$ {c.command}</code>
                        {copiedCmd === c.command ? <Check size={10} className="text-green-400" /> : <Copy size={10} />}
                      </button>
                      <span className="text-[10px] text-stone-500">{c.description}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {children}

            {learnMoreUrl && (
              <a href={learnMoreUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300">
                Learn more <ExternalLink size={10} />
              </a>
            )}
          </div>
        </div>
      )}
    </>
  );
}
