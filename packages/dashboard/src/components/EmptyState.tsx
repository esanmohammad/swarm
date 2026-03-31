import { Siren, FileText, Blocks, ListChecks, Code2, TestTube2, ChevronRight } from 'lucide-react';
import type { WsCommand } from '../types';

const PIPELINE_STAGES = [
  {
    label: 'Analyze',
    artifact: 'REQUIREMENTS.md',
    description: 'Gathers and structures requirements from your feature request',
    icon: FileText,
    color: 'text-purple-400',
    accentBorder: 'border-purple-900/30',
    accentBg: 'bg-purple-950/20',
  },
  {
    label: 'Architect',
    artifact: 'SPEC.md',
    description: 'Designs system architecture with ADRs and component diagrams',
    icon: Blocks,
    color: 'text-blue-400',
    accentBorder: 'border-blue-900/30',
    accentBg: 'bg-blue-950/20',
  },
  {
    label: 'Plan',
    artifact: 'TASKS.md',
    description: 'Breaks work into parallelizable task groups with IDs',
    icon: ListChecks,
    color: 'text-amber-400',
    accentBorder: 'border-amber-900/30',
    accentBg: 'bg-amber-950/20',
  },
  {
    label: 'Build',
    artifact: 'Code',
    description: 'Engineers implement tasks in parallel sub-agents',
    icon: Code2,
    color: 'text-red-400',
    accentBorder: 'border-red-900/30',
    accentBg: 'bg-red-950/20',
  },
  {
    label: 'Test',
    artifact: 'TESTPLAN.md',
    description: 'Creates and runs E2E test plans against the build',
    icon: TestTube2,
    color: 'text-green-400',
    accentBorder: 'border-green-900/30',
    accentBg: 'bg-green-950/20',
  },
];

interface EmptyStateProps {
  sendCommand: (cmd: WsCommand) => void;
}

export function EmptyState({ sendCommand }: EmptyStateProps) {
  return (
    <div className="flex-1 flex items-center justify-center p-8 font-[JetBrains_Mono]">
      <div className="max-w-2xl w-full space-y-8">
        {/* Header */}
        <div className="text-center space-y-3">
          <h2 className="text-lg font-semibold tracking-[0.15em] text-stone-300 uppercase">
            swarm pipeline
          </h2>
          <p className="text-sm text-stone-400 leading-relaxed max-w-md mx-auto">
            Orchestrate Claude Code sub-agents through a structured development pipeline.
            Each stage produces an artifact that feeds the next.
          </p>
        </div>

        {/* Pipeline stages */}
        <div className="space-y-2">
          {PIPELINE_STAGES.map((stage, i) => {
            const Icon = stage.icon;
            return (
              <div key={stage.label} className="flex items-start gap-3">
                {/* Step connector */}
                <div className="flex flex-col items-center pt-1">
                  <div className={`w-6 h-6 rounded flex items-center justify-center ${stage.accentBg} border ${stage.accentBorder}`}>
                    <Icon size={13} className={stage.color} />
                  </div>
                  {i < PIPELINE_STAGES.length - 1 && (
                    <div className="w-px h-4 bg-stone-800/60 mt-1" />
                  )}
                </div>

                {/* Content */}
                <div className="flex-1 flex items-baseline gap-3 py-0.5">
                  <span className={`text-xs font-semibold ${stage.color} w-20`}>
                    {stage.label}
                  </span>
                  <ChevronRight size={10} className="text-stone-700 shrink-0 mt-0.5" />
                  <span className="text-[11px] text-stone-300 font-medium w-36 shrink-0">
                    {stage.artifact}
                  </span>
                  <span className="text-[11px] text-stone-400 leading-relaxed">
                    {stage.description}
                  </span>
                </div>
              </div>
            );
          })}
        </div>

        {/* CTA */}
        <div className="text-center pt-4">
          <button
            onClick={() => sendCommand({ action: 'run-mayday', prompt: '' })}
            className="inline-flex items-center gap-2.5 px-6 py-3 rounded-md text-sm font-bold text-red-300 bg-red-950/50 hover:bg-red-950/70 border border-red-800/50 hover:border-red-700/60 shadow-[0_0_16px_rgba(239,68,68,0.1)] hover:shadow-[0_0_24px_rgba(239,68,68,0.2)] transition-all uppercase tracking-wider"
          >
            <Siren size={16} className="text-red-400" />
            Start with MayDay
          </button>
          <p className="text-[11px] text-stone-400 mt-3">
            MayDay runs the full pipeline autonomously — analyze, architect, plan, build, and test.
          </p>
        </div>
      </div>
    </div>
  );
}
