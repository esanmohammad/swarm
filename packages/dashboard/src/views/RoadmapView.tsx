import { useState, useEffect } from 'react';
import {
  Map,
  Play,
  ArrowRight,
  AlertTriangle,
  CheckCircle,
  Clock,
  Target,
} from 'lucide-react';
import type { WsCommand } from '../types';

interface RoadmapPhase {
  id: string;
  name: string;
  description: string;
  status: 'pending' | 'in-progress' | 'done' | 'blocked';
  progress: number;
  estimatedWeeks: number;
  actualWeeks?: number;
  dependencies: string[];
  riskLevel: 'low' | 'medium' | 'high';
  rollbackStrategy: string;
  successMetrics: string[];
}

interface RoadmapData {
  goal: string;
  phases: RoadmapPhase[];
  criticalPath: string[];
  estimatedTotalWeeks: number;
  estimatedTotalCost: number;
  startedAt?: number;
  status: 'planning' | 'executing' | 'complete' | 'paused';
}

interface RoadmapViewProps {
  sendCommand: (cmd: WsCommand) => void;
  roadmapData: RoadmapData | null;
}

function RiskBadge({ level }: { level: 'low' | 'medium' | 'high' }) {
  const styles: Record<string, string> = {
    low: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
    medium: 'bg-amber-500/20 text-amber-300 border-amber-500/30',
    high: 'bg-red-500/20 text-red-300 border-red-500/30',
  };
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium border ${styles[level]}`}>
      <AlertTriangle size={9} />
      {level.toUpperCase()}
    </span>
  );
}

function StatusIcon({ status }: { status: string }) {
  if (status === 'done') return <CheckCircle size={14} className="text-emerald-400" />;
  if (status === 'in-progress') return <Clock size={14} className="text-blue-400" />;
  if (status === 'blocked') return <AlertTriangle size={14} className="text-red-400" />;
  return <Clock size={14} className="text-stone-600" />;
}

export function RoadmapView({ sendCommand, roadmapData }: RoadmapViewProps) {
  const [goalInput, setGoalInput] = useState('');

  useEffect(() => {
    sendCommand({ action: 'get-roadmap' } as WsCommand);
  }, []);

  const handleGenerate = () => {
    const goal = goalInput.trim();
    if (!goal) return;
    sendCommand({ action: 'run-roadmap', goal } as WsCommand);
    setGoalInput('');
  };

  const handleStartPhase = (phase: string) => {
    sendCommand({ action: 'run-roadmap-execute', phase } as WsCommand);
  };

  if (!roadmapData) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center">
          <Map size={36} className="text-stone-600 mx-auto mb-3" />
          <p className="text-sm text-stone-400">Loading roadmap...</p>
        </div>
      </div>
    );
  }

  const { goal, phases, estimatedTotalWeeks } = roadmapData;
  const doneCount = phases.filter(p => p.status === 'done').length;
  const overallProgressPct = phases.length > 0 ? Math.round((doneCount / phases.length) * 100) : 0;

  return (
    <div className="flex-1 flex flex-col p-6 overflow-auto">
      <div className="max-w-5xl w-full mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Map size={18} className="text-indigo-400" />
            <h2 className="text-lg font-semibold text-stone-200">Roadmap</h2>
          </div>
          <button
            onClick={() => sendCommand({ action: 'run-roadmap' } as WsCommand)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium bg-indigo-600/20 text-indigo-300 border border-indigo-500/30 hover:bg-indigo-600/30 transition-colors"
          >
            <Play size={12} />
            Regenerate
          </button>
        </div>

        {/* Goal input */}
        <div className="flex gap-2">
          <input
            type="text"
            value={goalInput}
            onChange={e => setGoalInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') handleGenerate();
            }}
            placeholder="Describe your project goal..."
            className="flex-1 px-3 py-2 bg-stone-900/60 border border-stone-700/50 rounded-lg text-xs text-stone-200 placeholder-stone-500 focus:border-indigo-600 focus:outline-none focus:ring-1 focus:ring-indigo-600/30"
          />
          <button
            onClick={handleGenerate}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-medium text-white bg-indigo-600 hover:bg-indigo-500 transition-colors shrink-0"
          >
            <Target size={12} />
            Generate
          </button>
        </div>

        {/* Overall progress */}
        <div className="p-4 rounded-lg bg-stone-800/40 border border-stone-700/40 space-y-2">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[10px] text-stone-500 uppercase tracking-wider">Goal</p>
              <p className="text-xs text-stone-200 mt-0.5">{goal}</p>
            </div>
            <div className="text-right">
              <p className="text-[10px] text-stone-500 uppercase tracking-wider">Est. Duration</p>
              <p className="text-xs text-stone-300 mt-0.5">{estimatedTotalWeeks} weeks</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex-1 h-2 bg-stone-700 rounded-full overflow-hidden">
              <div
                className="h-full rounded-full bg-indigo-500 transition-all"
                style={{ width: `${overallProgressPct}%` }}
              />
            </div>
            <span className="text-xs text-stone-400">{overallProgressPct}%</span>
          </div>
        </div>

        {/* Phase cards */}
        <div className="space-y-3">
          {phases.map((phase, i) => (
            <div
              key={phase.id}
              className="bg-stone-800/40 rounded-lg border border-stone-700/40 p-4 space-y-3"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <StatusIcon status={phase.status} />
                  <h4 className="text-sm font-semibold text-stone-200">
                    Phase {i + 1}: {phase.name}
                  </h4>
                  <RiskBadge level={phase.riskLevel} />
                </div>
                {phase.status === 'pending' && (
                  <button
                    onClick={() => handleStartPhase(phase.id)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium bg-indigo-600/20 text-indigo-300 border border-indigo-500/30 hover:bg-indigo-600/30 transition-colors"
                  >
                    <Play size={12} />
                    Start Phase
                  </button>
                )}
              </div>

              <p className="text-[11px] text-stone-400">{phase.description}</p>

              {/* Progress bar */}
              <div className="flex items-center gap-2">
                <div className="flex-1 h-1.5 bg-stone-700 rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full bg-indigo-500 transition-all"
                    style={{ width: `${phase.progress}%` }}
                  />
                </div>
                <span className="text-[10px] text-stone-400 w-8 text-right">{phase.progress}%</span>
              </div>

              {/* Dependencies */}
              {phase.dependencies.length > 0 && (
                <div className="flex items-center gap-1.5 flex-wrap">
                  <ArrowRight size={10} className="text-stone-600" />
                  <span className="text-[10px] text-stone-500">Depends on:</span>
                  {phase.dependencies.map(dep => (
                    <span key={dep} className="text-[10px] px-1.5 py-0.5 rounded bg-stone-700/50 text-stone-400">
                      {dep}
                    </span>
                  ))}
                </div>
              )}

              {/* Milestones */}
              {phase.successMetrics.length > 0 && (
                <div className="space-y-1">
                  {phase.successMetrics.map((ms, j) => (
                    <div key={j} className="flex items-center gap-1.5">
                      <span className="w-1 h-1 rounded-full bg-stone-600" />
                      <span className="text-[10px] text-stone-500">{ms}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
