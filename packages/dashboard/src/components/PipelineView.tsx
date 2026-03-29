import { ArrowRight, CheckCircle, Circle, Loader2, XCircle, SkipForward } from 'lucide-react';
import type { PipelineState, StageName } from '../types';

const STAGES: { key: StageName; label: string }[] = [
  { key: 'analyze', label: 'Analyze' },
  { key: 'architect', label: 'Architect' },
  { key: 'plan', label: 'Plan' },
  { key: 'build', label: 'Build' },
  { key: 'evaluate', label: 'Evaluate' },
];

const STATUS_CONFIG = {
  pending: { icon: Circle, color: 'text-gray-500', bg: 'bg-gray-800', ring: '' },
  running: { icon: Loader2, color: 'text-cyan-400', bg: 'bg-cyan-950', ring: 'ring-2 ring-cyan-400/50' },
  done: { icon: CheckCircle, color: 'text-green-400', bg: 'bg-green-950', ring: '' },
  error: { icon: XCircle, color: 'text-red-400', bg: 'bg-red-950', ring: 'ring-2 ring-red-400/50' },
  skipped: { icon: SkipForward, color: 'text-gray-600', bg: 'bg-gray-900', ring: '' },
};

export function PipelineView({ pipeline }: { pipeline: PipelineState }) {
  return (
    <div className="flex items-center gap-2 p-4">
      {STAGES.map((stage, i) => {
        const s = pipeline.stages[stage.key];
        const cfg = STATUS_CONFIG[s.status];
        const Icon = cfg.icon;
        const isRunning = s.status === 'running';

        return (
          <div key={stage.key} className="flex items-center gap-2">
            <div className={`flex items-center gap-2 px-4 py-2 rounded-lg ${cfg.bg} ${cfg.ring}`}>
              <Icon
                size={16}
                className={`${cfg.color} ${isRunning ? 'animate-spin' : ''}`}
              />
              <span className={`text-sm font-medium ${cfg.color}`}>{stage.label}</span>
              {s.artifact && (
                <span className="text-xs text-gray-500 ml-1">{s.artifact}</span>
              )}
              {s.agentIds.length > 0 && (
                <span className="text-xs bg-gray-700 px-1.5 py-0.5 rounded-full text-gray-300">
                  {s.agentIds.length}
                </span>
              )}
            </div>
            {i < STAGES.length - 1 && (
              <ArrowRight size={14} className="text-gray-600" />
            )}
          </div>
        );
      })}
    </div>
  );
}
