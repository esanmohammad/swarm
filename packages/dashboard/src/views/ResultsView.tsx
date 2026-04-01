import { useState } from 'react';
import { FileText, Check, X, RotateCw, Copy, CheckCircle } from 'lucide-react';
import type { PipelineState, StageName, AgentActivity } from '../types';
import { DiffViewer } from '../components/DiffViewer';

const STAGES: { key: StageName; label: string; artifact: string }[] = [
  { key: 'analyze', label: 'Analyze', artifact: 'REQUIREMENTS.md' },
  { key: 'architect', label: 'Architect', artifact: 'SPEC.md' },
  { key: 'plan', label: 'Plan', artifact: 'TASKS.md' },
  { key: 'build', label: 'Build', artifact: 'Code' },
  { key: 'test', label: 'Test', artifact: 'TESTPLAN.md' },
];

function formatDuration(ms: number): string {
  const secs = Math.floor(ms / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  const remSecs = secs % 60;
  return `${mins}m ${remSecs}s`;
}

interface ResultsViewProps {
  pipeline: PipelineState;
  agentActivities: Map<string, AgentActivity[]>;
  onNavigate: (view: 'launch') => void;
}

export function ResultsView({ pipeline, agentActivities, onNavigate }: ResultsViewProps) {
  const { stages, totalCost, mayday, agents } = pipeline;
  const [copied, setCopied] = useState(false);

  const allPassed = mayday?.lastTestPassed === true;
  const hasErrors = Object.values(stages).some((s) => s.status === 'error');
  const featureRequest = mayday?.featureRequest || '';

  // Collect all activities across all agents for diff viewer
  const allActivities = agents.flatMap((a) => agentActivities.get(a.id) || []);

  // Count file changes from activities
  const fileChanges = new Set<string>();
  for (const act of allActivities) {
    if (act.kind === 'tool_use' && (act.tool === 'Edit' || act.tool === 'Write')) {
      const match = act.summary.match(/(?:^|\s)((?:\/|\.\/|[a-zA-Z])[^\s]+\.[a-zA-Z0-9]+)/);
      if (match) fileChanges.add(match[1]);
    }
  }

  // Build summary text
  const summaryLines = [
    `## Pipeline Summary`,
    ``,
    `**Feature:** ${featureRequest}`,
    `**Status:** ${allPassed ? 'All tests passed' : hasErrors ? 'Completed with errors' : 'Completed'}`,
    `**Cost:** $${totalCost.totalUsd.toFixed(2)}`,
    `**Duration:** ${formatDuration(totalCost.durationMs)}`,
    `**Files changed:** ${fileChanges.size}`,
  ];

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(summaryLines.join('\n'));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* silent */ }
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Summary header */}
      <div className="px-6 py-5 border-b border-stone-800/50 bg-[#0e0c0b]">
        <div className="flex items-start justify-between mb-4">
          <div>
            <div className="flex items-center gap-3 mb-2">
              {allPassed ? (
                <div className="flex items-center gap-1.5 text-green-400">
                  <CheckCircle size={18} />
                  <span className="text-sm font-semibold">All tests passed</span>
                </div>
              ) : hasErrors ? (
                <div className="flex items-center gap-1.5 text-red-400">
                  <X size={18} />
                  <span className="text-sm font-semibold">Completed with errors</span>
                </div>
              ) : (
                <div className="flex items-center gap-1.5 text-stone-300">
                  <Check size={18} />
                  <span className="text-sm font-semibold">Pipeline complete</span>
                </div>
              )}
            </div>
            {featureRequest && (
              <p className="text-xs text-stone-400 max-w-lg truncate">{featureRequest}</p>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleCopy}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs text-stone-400 hover:text-stone-300 bg-stone-800/40 hover:bg-stone-800/60 transition-colors"
            >
              {copied ? <Check size={12} className="text-green-400" /> : <Copy size={12} />}
              {copied ? 'Copied' : 'Copy summary'}
            </button>
            <button
              onClick={() => onNavigate('launch')}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs text-stone-400 hover:text-stone-300 bg-stone-800/40 hover:bg-stone-800/60 transition-colors"
            >
              <RotateCw size={12} />
              New build
            </button>
          </div>
        </div>

        {/* Stats row */}
        <div className="flex items-center gap-6 text-xs">
          <div>
            <span className="text-stone-500">Cost</span>
            <span className="text-amber-400 font-mono ml-2">${totalCost.totalUsd.toFixed(2)}</span>
          </div>
          <div>
            <span className="text-stone-500">Time</span>
            <span className="text-stone-300 font-mono ml-2">{formatDuration(totalCost.durationMs)}</span>
          </div>
          <div>
            <span className="text-stone-500">Files</span>
            <span className="text-stone-300 font-mono ml-2">{fileChanges.size} changed</span>
          </div>
          <div>
            <span className="text-stone-500">Agents</span>
            <span className="text-stone-300 font-mono ml-2">{agents.length} spawned</span>
          </div>
          {mayday?.fixIteration != null && mayday.fixIteration > 0 && (
            <div>
              <span className="text-stone-500">Fix iterations</span>
              <span className="text-stone-300 font-mono ml-2">{mayday.fixIteration}</span>
            </div>
          )}
        </div>

        {/* Stage summary */}
        <div className="flex items-center gap-1 mt-4">
          {STAGES.map((stage) => {
            const s = stages[stage.key];
            return (
              <div
                key={stage.key}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-[11px] ${
                  s.status === 'done' ? 'text-green-400/80' :
                  s.status === 'error' ? 'text-red-400/80' :
                  s.status === 'skipped' ? 'text-stone-600' :
                  'text-stone-500'
                }`}
              >
                {s.status === 'done' && <Check size={11} />}
                {s.status === 'error' && <X size={11} />}
                {stage.label}
              </div>
            );
          })}
        </div>
      </div>

      {/* File changes / diff */}
      <div className="flex-1 overflow-hidden">
        {allActivities.length > 0 ? (
          <DiffViewer activities={allActivities} />
        ) : (
          <div className="flex items-center justify-center h-full">
            <div className="text-center text-stone-500">
              <FileText size={32} className="mx-auto mb-3 opacity-20" />
              <p className="text-xs">No file changes recorded</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
