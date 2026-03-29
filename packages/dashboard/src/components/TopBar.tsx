import { useState } from 'react';
import { DollarSign, Clock, AlertTriangle, Play, ChevronRight } from 'lucide-react';
import type { PipelineState, StageName, WsCommand } from '../types';

const STAGES: { key: StageName; label: string; artifact: string; runnable: boolean }[] = [
  { key: 'analyze', label: 'analyze', artifact: 'REQUIREMENTS.md', runnable: true },
  { key: 'architect', label: 'architect', artifact: 'SPEC.md', runnable: true },
  { key: 'plan', label: 'plan', artifact: 'TASKS.md', runnable: true },
  { key: 'build', label: 'build', artifact: 'code', runnable: true },
  { key: 'evaluate', label: 'eval', artifact: 'report', runnable: false },
];

function formatTokens(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
  return `${(n / 1_000_000).toFixed(2)}M`;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(0)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

interface TopBarProps {
  pipeline: PipelineState;
  violationCount: number;
  onRunStage?: (cmd: WsCommand) => void;
}

export function TopBar({ pipeline, violationCount, onRunStage }: TopBarProps) {
  const { agents, totalCost, stages } = pipeline;
  const [promptInput, setPromptInput] = useState('');
  const [showPromptFor, setShowPromptFor] = useState<StageName | null>(null);

  const running = agents.filter((a) => a.status === 'running').length;
  const done = agents.filter((a) => a.status === 'done').length;
  const errored = agents.filter((a) => a.status === 'error').length;

  const handleStageClick = (stageKey: StageName) => {
    const s = stages[stageKey];
    if (s.status === 'running') return;

    if (stageKey === 'analyze') {
      setShowPromptFor('analyze');
      return;
    }

    if (onRunStage) {
      onRunStage({ action: 'run-stage', stage: stageKey as 'architect' | 'plan' | 'build' });
    }
  };

  const handlePromptSubmit = () => {
    if (!showPromptFor || !promptInput.trim()) return;
    if (onRunStage) {
      onRunStage({ action: 'run-stage', stage: showPromptFor as 'analyze', prompt: promptInput.trim() });
    }
    setShowPromptFor(null);
    setPromptInput('');
  };

  return (
    <div className="px-4 py-3 border-b border-stone-800/50 bg-[#0e0c0b]">
      {/* Pipeline stages — terminal-style breadcrumb */}
      <div className="flex items-center gap-0.5 mb-2.5 font-mono">
        <span className="text-stone-600 text-xs mr-1">$</span>
        {STAGES.map((stage, i) => {
          const s = stages[stage.key];
          const isActive = s.status === 'running';
          const isDone = s.status === 'done';
          const isError = s.status === 'error';
          const canRun = stage.runnable && !isActive && onRunStage;

          return (
            <div key={stage.key} className="flex items-center">
              <button
                onClick={() => canRun && handleStageClick(stage.key)}
                disabled={!canRun}
                className={`group flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium transition-all ${
                  isActive
                    ? 'bg-red-950/50 text-red-400 glow-red'
                    : isDone
                      ? 'text-green-500/80 hover:text-green-400'
                      : isError
                        ? 'text-red-600/70'
                        : canRun
                          ? 'text-stone-500 hover:text-stone-300 hover:bg-stone-800/30 cursor-pointer'
                          : 'text-stone-600'
                }`}
              >
                {isActive && <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />}
                {isDone && <span className="text-green-600 text-[10px]">+</span>}
                {isError && <span className="text-red-600 text-[10px]">x</span>}
                {stage.label}
                {canRun && !isActive && (
                  <Play size={8} className="text-stone-700 opacity-0 group-hover:opacity-100 transition-opacity" />
                )}
              </button>
              {i < STAGES.length - 1 && (
                <ChevronRight size={10} className="text-stone-700 mx-0.5" />
              )}
            </div>
          );
        })}

        <div className="flex-1" />

        {/* Violations badge */}
        {violationCount > 0 && (
          <div className="flex items-center gap-1 px-2 py-0.5 rounded bg-amber-950/30 border border-amber-900/30">
            <AlertTriangle size={10} className="text-amber-500" />
            <span className="text-[10px] font-medium text-amber-400">{violationCount}</span>
          </div>
        )}
      </div>

      {/* Inline prompt input for analyze */}
      {showPromptFor === 'analyze' && (
        <div className="mb-2.5 flex items-center gap-2 font-mono">
          <span className="text-green-600 text-xs">{'>'}</span>
          <input
            type="text"
            value={promptInput}
            onChange={(e) => setPromptInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handlePromptSubmit()}
            placeholder="describe the feature..."
            className="flex-1 px-2 py-1 bg-transparent border-b border-stone-800 text-xs text-stone-300 placeholder-stone-600 focus:border-red-800 focus:outline-none"
            autoFocus
          />
          <button
            onClick={handlePromptSubmit}
            disabled={!promptInput.trim()}
            className="px-2 py-1 text-[10px] text-green-500 hover:text-green-400 disabled:text-stone-700 font-medium transition-colors"
          >
            [enter]
          </button>
          <button
            onClick={() => { setShowPromptFor(null); setPromptInput(''); }}
            className="text-[10px] text-stone-600 hover:text-stone-400 transition-colors"
          >
            [esc]
          </button>
        </div>
      )}

      {/* Stats — terminal-style info line */}
      <div className="flex items-center gap-4 text-[10px] font-mono text-stone-500">
        <span>
          {running > 0 && <span className="text-red-400">{running} running</span>}
          {running > 0 && (done > 0 || errored > 0) && <span className="text-stone-700"> | </span>}
          {done > 0 && <span className="text-green-600">{done} done</span>}
          {done > 0 && errored > 0 && <span className="text-stone-700"> | </span>}
          {errored > 0 && <span className="text-red-600">{errored} err</span>}
          {agents.length === 0 && <span className="text-stone-600">idle</span>}
        </span>

        <span className="text-stone-700">|</span>

        <span className="flex items-center gap-1 text-amber-600">
          <DollarSign size={9} />
          {totalCost.totalUsd.toFixed(4)}
        </span>

        {(totalCost.inputTokens > 0 || totalCost.outputTokens > 0) && (
          <>
            <span className="text-stone-700">|</span>
            <span className="text-stone-500" title={`${totalCost.inputTokens.toLocaleString()} in / ${totalCost.outputTokens.toLocaleString()} out`}>
              {formatTokens(totalCost.inputTokens)}<span className="text-stone-700">/</span>{formatTokens(totalCost.outputTokens)} tok
            </span>
          </>
        )}

        {totalCost.durationMs > 0 && (
          <>
            <span className="text-stone-700">|</span>
            <span className="flex items-center gap-1 text-stone-500">
              <Clock size={9} />
              {formatDuration(totalCost.durationMs)}
            </span>
          </>
        )}
      </div>
    </div>
  );
}
