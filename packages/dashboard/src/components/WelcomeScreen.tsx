import { FileText, Blocks, ListChecks, Code2, TestTube2, ArrowRight } from 'lucide-react';

interface WelcomeScreenProps {
  onGetStarted: () => void;
  onSkip: () => void;
}

const STAGES = [
  { icon: FileText, label: 'Analyze', desc: 'Gather requirements', color: 'text-purple-400' },
  { icon: Blocks, label: 'Architect', desc: 'Design the system', color: 'text-blue-400' },
  { icon: ListChecks, label: 'Plan', desc: 'Break into tasks', color: 'text-amber-400' },
  { icon: Code2, label: 'Build', desc: 'Write the code', color: 'text-red-400' },
  { icon: TestTube2, label: 'Test', desc: 'Run & fix tests', color: 'text-green-400' },
];

export function WelcomeScreen({ onGetStarted, onSkip }: WelcomeScreenProps) {
  return (
    <div className="fixed inset-0 bg-[#0c0a09] flex items-center justify-center z-40">
      <div className="max-w-lg w-full px-8 text-center space-y-8">
        {/* Title */}
        <div className="space-y-3">
          <h1 className="text-3xl font-bold text-stone-100">Welcome to Swarm</h1>
          <p className="text-sm text-stone-400 max-w-sm mx-auto">
            AI builds your feature while you watch. Describe what you want, and 5 specialized agents handle the rest.
          </p>
        </div>

        {/* Pipeline visualization */}
        <div className="flex items-center justify-center gap-2">
          {STAGES.map((stage, i) => {
            const Icon = stage.icon;
            return (
              <div key={stage.label} className="flex items-center gap-2">
                <div className="flex flex-col items-center gap-1.5">
                  <div className={`w-10 h-10 rounded-lg bg-stone-800/60 flex items-center justify-center ${stage.color}`}>
                    <Icon size={18} />
                  </div>
                  <span className="text-[10px] text-stone-400 font-medium">{stage.label}</span>
                  <span className="text-[9px] text-stone-500">{stage.desc}</span>
                </div>
                {i < STAGES.length - 1 && (
                  <ArrowRight size={12} className="text-stone-700 mb-6" />
                )}
              </div>
            );
          })}
        </div>

        {/* Info */}
        <div className="space-y-2 text-xs text-stone-500">
          <p>You can intervene, redirect, or send feedback at any time during the pipeline.</p>
          <p>Typical cost: <span className="text-amber-400">$3 – $8</span> per feature.</p>
        </div>

        {/* Actions */}
        <div className="space-y-3">
          <button
            onClick={onGetStarted}
            className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-lg text-sm font-semibold text-white bg-blue-600 hover:bg-blue-500 transition-colors"
          >
            Get Started
            <ArrowRight size={16} />
          </button>
          <button
            onClick={onSkip}
            className="text-xs text-stone-500 hover:text-stone-400 transition-colors"
          >
            Skip introduction
          </button>
        </div>
      </div>
    </div>
  );
}
