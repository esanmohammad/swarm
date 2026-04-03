import { useState } from 'react';
import { GitCompareArrows, X } from 'lucide-react';
import type { PipelineInfo, StageName, WsCommand } from '../types';

interface PipelineCompareProps {
  pipelines: PipelineInfo[];
  activePipeline: string;
  sendCommand: (cmd: WsCommand) => void;
  artifactContent: Map<StageName, string>;
  onClose: () => void;
}

const COMPARABLE_STAGES: { name: StageName; label: string; artifact: string }[] = [
  { name: 'analyze', label: 'Analyze', artifact: 'REQUIREMENTS.md' },
  { name: 'architect', label: 'Architect', artifact: 'SPEC.md' },
  { name: 'plan', label: 'Plan', artifact: 'TASKS.md' },
  { name: 'test', label: 'Test', artifact: 'TESTPLAN.md' },
];

function statusDot(status: string | undefined) {
  if (!status) return 'bg-stone-600';
  switch (status) {
    case 'done': return 'bg-green-500';
    case 'running': return 'bg-amber-500 animate-pulse';
    case 'error': return 'bg-red-500';
    case 'skipped': return 'bg-stone-500';
    default: return 'bg-stone-600';
  }
}

function formatCost(usd: number): string {
  return `$${usd.toFixed(4)}`;
}

function formatTime(ts: number | undefined): string {
  if (!ts) return '--';
  return new Date(ts).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function PipelineCard({
  pipeline,
  stage,
  isActive,
  artifactContent,
}: {
  pipeline: PipelineInfo | null;
  stage: StageName;
  isActive: boolean;
  artifactContent: Map<StageName, string>;
}) {
  if (!pipeline) {
    return (
      <div className="flex-1 bg-stone-900/50 border border-stone-700/30 rounded-lg p-4 flex items-center justify-center">
        <span className="text-stone-500 text-xs">Select a pipeline</span>
      </div>
    );
  }

  const stageInfo = COMPARABLE_STAGES.find(s => s.name === stage);
  const pipelineStatus = pipeline.status;
  const hasArtifact = isActive && artifactContent.has(stage);

  return (
    <div className="flex-1 bg-stone-900/50 border border-stone-700/30 rounded-lg overflow-hidden">
      {/* Pipeline header */}
      <div className="px-4 py-2.5 border-b border-stone-700/30 bg-stone-800/30">
        <div className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full shrink-0 ${
            pipelineStatus === 'running' ? 'bg-amber-500 animate-pulse' :
            pipelineStatus === 'complete' ? 'bg-green-500' :
            pipelineStatus === 'error' ? 'bg-red-500' :
            'bg-stone-600'
          }`} />
          <span className="text-sm text-stone-200 font-medium truncate">{pipeline.namespace}</span>
          {isActive && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-400 uppercase tracking-wider">active</span>
          )}
        </div>
        <div className="text-[10px] text-stone-500 mt-1">
          {pipeline.projectName}
        </div>
      </div>

      {/* Stage info */}
      <div className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-xs text-stone-400">Stage</span>
          <div className="flex items-center gap-1.5">
            <span className={`w-1.5 h-1.5 rounded-full ${statusDot(pipeline.currentStage === stage ? pipelineStatus : 'pending')}`} />
            <span className="text-xs text-stone-300">{stageInfo?.label}</span>
          </div>
        </div>

        <div className="flex items-center justify-between">
          <span className="text-xs text-stone-400">Current Stage</span>
          <span className="text-xs text-stone-300">{pipeline.currentStage || 'idle'}</span>
        </div>

        <div className="flex items-center justify-between">
          <span className="text-xs text-stone-400">Total Cost</span>
          <span className="text-xs text-stone-300 tabular-nums">{formatCost(pipeline.totalCost.totalUsd)}</span>
        </div>

        <div className="flex items-center justify-between">
          <span className="text-xs text-stone-400">Updated</span>
          <span className="text-xs text-stone-300">{formatTime(pipeline.updatedAt)}</span>
        </div>

        {pipeline.worktreePath && (
          <div className="flex items-center justify-between">
            <span className="text-xs text-stone-400">Worktree</span>
            <span className="text-[10px] text-stone-500 truncate max-w-[180px]" title={pipeline.worktreePath}>
              {pipeline.worktreePath}
            </span>
          </div>
        )}

        {/* Artifact content if available */}
        {hasArtifact && (
          <div className="mt-3 pt-3 border-t border-stone-700/30">
            <div className="text-[10px] text-stone-500 uppercase tracking-wider mb-2">
              Artifact: {stageInfo?.artifact}
            </div>
            <pre className="text-[10px] text-stone-400 bg-stone-950/50 rounded p-2 max-h-48 overflow-auto whitespace-pre-wrap break-words font-mono leading-relaxed">
              {artifactContent.get(stage)?.slice(0, 2000)}
              {(artifactContent.get(stage)?.length ?? 0) > 2000 && '\n... (truncated)'}
            </pre>
          </div>
        )}

        {!hasArtifact && isActive && (
          <div className="mt-3 pt-3 border-t border-stone-700/30">
            <div className="text-[10px] text-stone-500 italic">
              No artifact loaded for this stage
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export function PipelineCompare({
  pipelines,
  activePipeline,
  sendCommand: _sendCommand,
  artifactContent,
  onClose,
}: PipelineCompareProps) {
  const [pipelineA, setPipelineA] = useState<string>(pipelines[0]?.namespace ?? '');
  const [pipelineB, setPipelineB] = useState<string>(pipelines[1]?.namespace ?? '');
  const [selectedStage, setSelectedStage] = useState<StageName>('analyze');

  const infoA = pipelines.find(p => p.namespace === pipelineA) ?? null;
  const infoB = pipelines.find(p => p.namespace === pipelineB) ?? null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-stone-900 border border-stone-700/50 rounded-xl shadow-2xl w-[900px] max-w-[95vw] max-h-[85vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-stone-700/50">
          <div className="flex items-center gap-2.5">
            <GitCompareArrows size={16} className="text-stone-400" />
            <h2 className="text-sm font-medium text-stone-200">Compare Pipelines</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-stone-800 text-stone-400 hover:text-stone-200 transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {/* Pipeline selectors */}
        <div className="flex items-center gap-4 px-5 py-3 border-b border-stone-700/30">
          <div className="flex-1">
            <label className="text-[10px] text-stone-500 uppercase tracking-wider mb-1 block">Pipeline A</label>
            <select
              value={pipelineA}
              onChange={e => setPipelineA(e.target.value)}
              className="w-full bg-stone-800 border border-stone-700/50 rounded px-2.5 py-1.5 text-xs text-stone-300 focus:outline-none focus:border-stone-600"
            >
              <option value="">Select pipeline...</option>
              {pipelines.map(p => (
                <option key={p.namespace} value={p.namespace}>
                  {p.namespace} {p.namespace === activePipeline ? '(active)' : ''}
                </option>
              ))}
            </select>
          </div>

          <GitCompareArrows size={14} className="text-stone-600 mt-4 shrink-0" />

          <div className="flex-1">
            <label className="text-[10px] text-stone-500 uppercase tracking-wider mb-1 block">Pipeline B</label>
            <select
              value={pipelineB}
              onChange={e => setPipelineB(e.target.value)}
              className="w-full bg-stone-800 border border-stone-700/50 rounded px-2.5 py-1.5 text-xs text-stone-300 focus:outline-none focus:border-stone-600"
            >
              <option value="">Select pipeline...</option>
              {pipelines.map(p => (
                <option key={p.namespace} value={p.namespace}>
                  {p.namespace} {p.namespace === activePipeline ? '(active)' : ''}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Stage tabs */}
        <div className="flex items-center gap-1 px-5 py-2 border-b border-stone-700/30">
          {COMPARABLE_STAGES.map(stage => (
            <button
              key={stage.name}
              onClick={() => setSelectedStage(stage.name)}
              className={`px-3 py-1.5 rounded text-xs transition-colors ${
                selectedStage === stage.name
                  ? 'bg-stone-700/60 text-stone-200'
                  : 'text-stone-500 hover:text-stone-300 hover:bg-stone-800/40'
              }`}
            >
              {stage.label}
            </button>
          ))}
        </div>

        {/* Side-by-side comparison */}
        <div className="flex-1 overflow-auto p-5">
          <div className="flex gap-4 min-h-[300px]">
            <PipelineCard
              pipeline={infoA}
              stage={selectedStage}
              isActive={pipelineA === activePipeline}
              artifactContent={artifactContent}
            />
            <PipelineCard
              pipeline={infoB}
              stage={selectedStage}
              isActive={pipelineB === activePipeline}
              artifactContent={artifactContent}
            />
          </div>

          {/* Note about artifact limitations */}
          <div className="mt-4 px-3 py-2 rounded bg-stone-800/40 border border-stone-700/30">
            <p className="text-[10px] text-stone-500 leading-relaxed">
              Full artifact diff requires switching pipelines. Artifact content is only available for the
              active pipeline (<span className="text-stone-400">{activePipeline}</span>) via WebSocket.
              The comparison above shows metadata for both pipelines, with artifact content displayed
              for the active one when loaded.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
