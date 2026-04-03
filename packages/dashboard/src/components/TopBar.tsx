import { useState, useEffect } from 'react';
import { DollarSign, Clock, AlertTriangle, Play, ChevronRight, Siren, Square, MessageSquare, RotateCw, CheckCircle, XCircle } from 'lucide-react';
import type { PipelineState, StageName, WsCommand } from '../types';

const COST_PER_STAGE: Record<string, { low: number; high: number }> = {
  opus:   { low: 2,   high: 4 },
  sonnet: { low: 0.5, high: 1.5 },
  haiku:  { low: 0.1, high: 0.3 },
};

function estimateMaydayCost(model: string): { low: number; high: number } {
  const rates = COST_PER_STAGE[model] ?? { low: 1, high: 3 };
  const stages = 6; // 5 stages + fix iterations
  return {
    low:  Math.round(rates.low * stages * 100) / 100,
    high: Math.round(rates.high * stages * 100) / 100,
  };
}

const STAGES: { key: StageName; label: string; artifact: string; runnable: boolean }[] = [
  { key: 'analyze', label: 'analyze', artifact: 'REQUIREMENTS.md', runnable: true },
  { key: 'architect', label: 'architect', artifact: 'SPEC.md', runnable: true },
  { key: 'plan', label: 'plan', artifact: 'TASKS.md', runnable: true },
  { key: 'build', label: 'build', artifact: 'code', runnable: true },
  { key: 'test', label: 'test', artifact: 'TESTPLAN.md', runnable: true },
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

function formatElapsed(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

interface TopBarProps {
  pipeline: PipelineState;
  violationCount: number;
  onRunStage?: (cmd: WsCommand) => void;
}

export function TopBar({ pipeline, violationCount, onRunStage }: TopBarProps) {
  const { agents, totalCost, stages, mayday } = pipeline;
  const [promptInput, setPromptInput] = useState('');
  const [figmaInput, setFigmaInput] = useState('');
  const [baseUrlInput, setBaseUrlInput] = useState('');
  const [authStateInput, setAuthStateInput] = useState('');
  const [showPromptFor, setShowPromptFor] = useState<StageName | null>(null);
  const [showMaydayPrompt, setShowMaydayPrompt] = useState(false);
  const [maydayInput, setMaydayInput] = useState('');
  const [maydayModelInput, setMaydayModelInput] = useState('opus');
  const [maydayMsgInput, setMaydayMsgInput] = useState('');
  const [showMaydayMsg, setShowMaydayMsg] = useState(false);

  const [, setTick] = useState(0);
  const hasRunningStage = Object.values(stages).some((s) => s.status === 'running');
  useEffect(() => {
    if (!hasRunningStage) return;
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [hasRunningStage]);

  const running = agents.filter((a) => a.status === 'running').length;
  const done = agents.filter((a) => a.status === 'done').length;
  const errored = agents.filter((a) => a.status === 'error').length;

  const handleStageClick = (stageKey: StageName) => {
    const s = stages[stageKey];
    if (s.status === 'running') return;

    if (stageKey === 'analyze' || stageKey === 'plan' || stageKey === 'test') {
      setShowPromptFor(stageKey);
      return;
    }

    if (onRunStage) {
      onRunStage({ action: 'run-stage', stage: stageKey as 'architect' | 'build' });
    }
  };

  const handlePromptSubmit = () => {
    if (!showPromptFor) return;

    if (showPromptFor === 'analyze') {
      if (!promptInput.trim()) return;
      if (onRunStage) {
        onRunStage({
          action: 'run-stage',
          stage: 'analyze',
          prompt: promptInput.trim(),
          figmaUrl: figmaInput.trim() || undefined,
        });
      }
    } else if (showPromptFor === 'plan') {
      if (!promptInput.trim()) return;
      if (onRunStage) {
        onRunStage({
          action: 'run-stage',
          stage: 'plan',
          prompt: promptInput.trim(),
        });
      }
    } else if (showPromptFor === 'test') {
      if (onRunStage) {
        onRunStage({
          action: 'run-stage',
          stage: 'test',
          figmaUrl: figmaInput.trim() || undefined,
          baseUrl: baseUrlInput.trim() || undefined,
          authStorageState: authStateInput.trim() || undefined,
        });
      }
    }

    setShowPromptFor(null);
    setPromptInput('');
    setFigmaInput('');
    setBaseUrlInput('');
    setAuthStateInput('');
  };

  return (
    <div className="px-4 py-3 border-b border-stone-800/50 bg-[#0e0c0b]">
      {/* Pipeline stages — terminal-style breadcrumb */}
      <div className="flex items-center gap-0.5 mb-2.5 font-mono">
        <span className="text-stone-400 text-xs mr-1">$</span>
        {STAGES.map((stage, i) => {
          const s = stages[stage.key];
          const isActive = s.status === 'running';
          const isDone = s.status === 'done';
          const isError = s.status === 'error';
          const isSkipped = s.status === 'skipped';
          const canRun = stage.runnable && !isActive && onRunStage;
          const canRerun = isDone && stage.runnable && onRunStage;

          return (
            <div key={stage.key} className="flex items-center">
              <button
                onClick={() => canRun && handleStageClick(stage.key)}
                disabled={!canRun}
                title={isActive ? 'Stage already running' : undefined}
                className={`group flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium transition-all ${
                  isActive
                    ? 'bg-red-950/50 text-red-400 glow-red opacity-70 cursor-not-allowed'
                    : isDone
                      ? 'text-green-500/80 hover:text-green-400'
                      : isError
                        ? 'text-red-600/70'
                        : isSkipped
                          ? 'text-stone-500/50 line-through'
                          : canRun
                            ? 'text-stone-400 hover:text-stone-300 hover:bg-stone-800 cursor-pointer'
                            : 'text-stone-400'
                }`}
              >
                {isActive && <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />}
                {isDone && <span className="text-green-500 text-[10px]">+</span>}
                {isError && <span className="text-red-500 text-[10px]">x</span>}
                {isSkipped && <span className="text-stone-500 text-[10px]">-</span>}
                {stage.label}
                {isActive && s.startedAt && (
                  <span className="text-[10px] text-stone-400 ml-0.5">{formatElapsed(Date.now() - s.startedAt)}</span>
                )}
                {canRun && !isActive && !isDone && (
                  <Play size={8} className="text-stone-400 opacity-0 group-hover:opacity-100 transition-opacity" />
                )}
                {canRerun && (
                  <span
                    className="opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                    onClick={(e) => {
                      e.stopPropagation();
                      onRunStage?.({ action: 'run-stage', stage: stage.key as 'analyze' | 'architect' | 'plan' | 'build' | 'test' });
                    }}
                    title={`Re-run ${stage.label}`}
                  >
                    <RotateCw size={9} className="text-green-500/50 hover:text-green-400" />
                  </span>
                )}
              </button>
              {i < STAGES.length - 1 && (
                <ChevronRight size={10} className="text-stone-500 mx-0.5" />
              )}
            </div>
          );
        })}

        <div className="flex-1" />

        {/* Violations badge */}
        {violationCount > 0 && (
          <div className="flex items-center gap-1 px-2 py-0.5 rounded bg-amber-950/30 border border-amber-900/30">
            <AlertTriangle size={10} className="text-amber-500" />
            <span className="text-xs font-medium text-amber-300">{violationCount}</span>
          </div>
        )}

        {/* MayDay button */}
        {mayday?.active ? (
          <div className="flex items-center gap-2.5">
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-red-950/70 border border-red-700/50 shadow-[0_0_12px_rgba(239,68,68,0.15)]">
              <Siren size={13} className="text-red-400 animate-pulse" />
              <span className="text-xs font-bold text-red-300 uppercase tracking-wider">mayday</span>
              <span className="text-xs text-stone-400 font-medium">
                {mayday.currentStage === 'fix-loop'
                  ? `fix ${mayday.fixIteration}/${mayday.maxFixIterations}`
                  : mayday.currentStage}
              </span>
              {mayday.failureCount != null && mayday.failureCount > 0 && (
                <span className="text-xs font-medium text-red-400">{mayday.failureCount} fail</span>
              )}
            </div>
            <button
              onClick={() => setShowMaydayMsg(!showMaydayMsg)}
              className="p-1.5 rounded text-stone-400 hover:text-amber-300 hover:bg-stone-800/40 transition-colors"
              title="Send guidance to MayDay"
            >
              <MessageSquare size={13} />
            </button>
            <button
              onClick={() => onRunStage?.({ action: 'mayday-stop' })}
              className="p-1.5 rounded text-stone-400 hover:text-red-400 hover:bg-stone-800/40 transition-colors"
              title="Stop MayDay"
            >
              <Square size={13} />
            </button>
          </div>
        ) : (
          <button
            onClick={() => {
              if (mayday?.pausedAt) {
                onRunStage?.({ action: 'run-mayday', prompt: mayday.featureRequest, resume: true });
              } else {
                setShowMaydayPrompt(true);
              }
            }}
            disabled={!onRunStage}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-mono font-bold text-red-400 hover:text-red-300 bg-red-950/40 hover:bg-red-950/60 border border-red-800/40 hover:border-red-700/50 shadow-[0_0_8px_rgba(239,68,68,0.1)] hover:shadow-[0_0_12px_rgba(239,68,68,0.2)] transition-all disabled:opacity-30 uppercase tracking-wider"
            title={mayday?.pausedAt ? 'Resume MayDay' : 'Start MayDay — autonomous end-to-end pipeline'}
          >
            <Siren size={12} />
            {mayday?.pausedAt ? 'resume' : 'mayday'}
          </button>
        )}
      </div>

      {/* MayDay prompt input */}
      {showMaydayPrompt && (
        <div className="mb-3 space-y-2 font-mono p-3 rounded-md bg-red-950/20 border border-red-900/30">
          <div className="flex items-center gap-2">
            <span className="text-red-400 text-sm font-bold">{'!'}</span>
            <input
              type="text"
              value={maydayInput}
              onChange={(e) => setMaydayInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && maydayInput.trim()) {
                  onRunStage?.({ action: 'run-mayday', prompt: maydayInput.trim(), figmaUrl: figmaInput.trim() || undefined, model: maydayModelInput });
                  setShowMaydayPrompt(false);
                  setMaydayInput('');
                  setFigmaInput('');
                }
                if (e.key === 'Escape') { setShowMaydayPrompt(false); setMaydayInput(''); setFigmaInput(''); }
              }}
              placeholder="describe the feature to build end-to-end..."
              className="flex-1 px-2 py-1.5 bg-transparent border-b border-red-800/50 text-sm text-stone-200 placeholder-stone-400 focus:border-red-600 focus:outline-none"
              autoFocus
            />
            <button
              onClick={() => {
                if (!maydayInput.trim()) return;
                onRunStage?.({ action: 'run-mayday', prompt: maydayInput.trim(), figmaUrl: figmaInput.trim() || undefined, model: maydayModelInput });
                setShowMaydayPrompt(false);
                setMaydayInput('');
                setFigmaInput('');
              }}
              disabled={!maydayInput.trim()}
              className="px-3 py-1 text-xs text-red-400 hover:text-red-300 disabled:text-stone-500 font-bold transition-colors"
            >
              [launch]
            </button>
            <button
              onClick={() => { setShowMaydayPrompt(false); setMaydayInput(''); setFigmaInput(''); }}
              className="text-xs text-stone-400 hover:text-stone-300 transition-colors"
            >
              [esc]
            </button>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-stone-400 text-sm">{'~'}</span>
            <span className="text-stone-400 text-xs w-12">model</span>
            <div className="flex items-center gap-1.5">
              {['opus', 'sonnet', 'haiku'].map((m) => (
                <button
                  key={m}
                  onClick={() => setMaydayModelInput(m)}
                  className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                    maydayModelInput === m
                      ? 'bg-red-950/60 text-red-300 border border-red-700/50'
                      : 'text-stone-400 hover:text-stone-300 border border-stone-600/30 hover:border-stone-500/50'
                  }`}
                >
                  {m}
                </button>
              ))}
            </div>
            <span className="text-xs text-stone-400 ml-2">
              Estimated: ~${estimateMaydayCost(maydayModelInput).low.toFixed(2)}-${estimateMaydayCost(maydayModelInput).high.toFixed(2)}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-purple-400 text-sm">{'~'}</span>
            <span className="text-stone-400 text-xs w-12">figma</span>
            <input
              type="text"
              value={figmaInput}
              onChange={(e) => setFigmaInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && maydayInput.trim()) {
                  onRunStage?.({ action: 'run-mayday', prompt: maydayInput.trim(), figmaUrl: figmaInput.trim() || undefined, model: maydayModelInput });
                  setShowMaydayPrompt(false);
                  setMaydayInput('');
                  setFigmaInput('');
                }
              }}
              placeholder="figma.com/design/... (optional)"
              className="flex-1 px-2 py-1.5 bg-transparent border-b border-stone-600/50 text-sm text-stone-300 placeholder-stone-400 focus:border-purple-700 focus:outline-none"
            />
          </div>
        </div>
      )}

      {/* MayDay user message input (while active) */}
      {showMaydayMsg && mayday?.active && (
        <div className="mb-3 font-mono p-2.5 rounded-md bg-amber-950/20 border border-amber-900/30">
          <div className="flex items-center gap-2">
            <span className="text-amber-400 text-sm font-bold">{'>'}</span>
            <input
              type="text"
              value={maydayMsgInput}
              onChange={(e) => setMaydayMsgInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && maydayMsgInput.trim()) {
                  onRunStage?.({ action: 'mayday-input', text: maydayMsgInput.trim() });
                  setMaydayMsgInput('');
                  setShowMaydayMsg(false);
                }
                if (e.key === 'Escape') { setShowMaydayMsg(false); setMaydayMsgInput(''); }
              }}
              placeholder="send guidance to the running mayday pipeline..."
              className="flex-1 px-2 py-1.5 bg-transparent border-b border-amber-800/50 text-sm text-stone-200 placeholder-stone-400 focus:border-amber-600 focus:outline-none"
              autoFocus
            />
            <button
              onClick={() => {
                if (!maydayMsgInput.trim()) return;
                onRunStage?.({ action: 'mayday-input', text: maydayMsgInput.trim() });
                setMaydayMsgInput('');
                setShowMaydayMsg(false);
              }}
              disabled={!maydayMsgInput.trim()}
              className="px-3 py-1 text-xs text-amber-400 hover:text-amber-300 disabled:text-stone-500 font-bold transition-colors"
            >
              [send]
            </button>
            <button
              onClick={() => { setShowMaydayMsg(false); setMaydayMsgInput(''); }}
              className="text-xs text-stone-400 hover:text-stone-300 transition-colors"
            >
              [esc]
            </button>
          </div>
        </div>
      )}

      {/* Approval gate bar */}
      {mayday?.pendingApproval && (
        <div className="mb-3 font-mono p-2.5 rounded-md bg-yellow-950/30 border border-yellow-700/40 flex items-center gap-3">
          <span className="text-yellow-400 text-sm font-bold">!</span>
          <span className="text-xs text-stone-300 flex-1">
            Stage <span className="text-yellow-300 font-bold">{mayday.pendingApproval.stage}</span> complete — approve to continue pipeline
          </span>
          <button
            onClick={() => onRunStage?.({ action: 'mayday-approve', stage: mayday.pendingApproval!.stage })}
            className="flex items-center gap-1 px-3 py-1 rounded text-xs font-bold text-green-400 hover:text-green-300 bg-green-950/40 hover:bg-green-950/60 border border-green-700/40 hover:border-green-600/50 transition-all"
          >
            <CheckCircle size={12} />
            Approve
          </button>
          <button
            onClick={() => onRunStage?.({ action: 'mayday-reject', stage: mayday.pendingApproval!.stage })}
            className="flex items-center gap-1 px-3 py-1 rounded text-xs font-bold text-red-400 hover:text-red-300 bg-red-950/40 hover:bg-red-950/60 border border-red-700/40 hover:border-red-600/50 transition-all"
          >
            <XCircle size={12} />
            Reject
          </button>
        </div>
      )}

      {/* Inline prompt input for analyze */}
      {showPromptFor === 'analyze' && (
        <div className="mb-2.5 space-y-1.5 font-mono">
          <div className="flex items-center gap-2">
            <span className="text-green-600 text-xs">{'>'}</span>
            <input
              type="text"
              value={promptInput}
              onChange={(e) => setPromptInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handlePromptSubmit()}
              placeholder="describe the feature..."
              className="flex-1 px-2 py-1 bg-transparent border-b border-stone-800 text-xs text-stone-300 placeholder-stone-400 focus:border-red-800 focus:outline-none"
              autoFocus
            />
            <button
              onClick={handlePromptSubmit}
              disabled={!promptInput.trim()}
              className="px-2 py-1 text-xs text-green-500 hover:text-green-400 disabled:text-stone-500 font-medium transition-colors"
            >
              [enter]
            </button>
            <button
              onClick={() => { setShowPromptFor(null); setPromptInput(''); setFigmaInput(''); }}
              className="text-xs text-stone-400 hover:text-stone-300 transition-colors"
            >
              [esc]
            </button>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-purple-500 text-xs">{'~'}</span>
            <input
              type="text"
              value={figmaInput}
              onChange={(e) => setFigmaInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handlePromptSubmit()}
              placeholder="figma url (optional)"
              className="flex-1 px-2 py-1 bg-transparent border-b border-stone-800/50 text-xs text-stone-400 placeholder-stone-400 focus:border-purple-800 focus:outline-none"
            />
          </div>
        </div>
      )}

      {/* Inline prompt input for plan */}
      {showPromptFor === 'plan' && (
        <div className="mb-2.5 space-y-1.5 font-mono">
          <div className="flex items-center gap-2">
            <span className="text-blue-500 text-xs">{'>'}</span>
            <input
              type="text"
              value={promptInput}
              onChange={(e) => setPromptInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handlePromptSubmit()}
              placeholder="guidance for task breakdown (e.g. priorities, constraints)..."
              className="flex-1 px-2 py-1 bg-transparent border-b border-stone-800 text-xs text-stone-300 placeholder-stone-400 focus:border-blue-800 focus:outline-none"
              autoFocus
            />
            <button
              onClick={handlePromptSubmit}
              disabled={!promptInput.trim()}
              className="px-2 py-1 text-xs text-green-500 hover:text-green-400 disabled:text-stone-500 font-medium transition-colors"
            >
              [enter]
            </button>
            <button
              onClick={() => { setShowPromptFor(null); setPromptInput(''); }}
              className="text-xs text-stone-400 hover:text-stone-300 transition-colors"
            >
              [esc]
            </button>
          </div>
        </div>
      )}

      {/* Inline test config inputs */}
      {showPromptFor === 'test' && (
        <div className="mb-2.5 space-y-1.5 font-mono">
          <div className="flex items-center gap-2">
            <span className="text-cyan-500 text-xs w-3 text-right">{'>'}</span>
            <span className="text-stone-400 text-xs font-ui w-12">url</span>
            <input
              type="text"
              value={baseUrlInput}
              onChange={(e) => setBaseUrlInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handlePromptSubmit()}
              placeholder="https://app-staging.example.com"
              className="flex-1 px-2 py-1 bg-transparent border-b border-stone-800 text-xs text-stone-300 placeholder-stone-400 focus:border-cyan-800 focus:outline-none"
              autoFocus
            />
            <button
              onClick={handlePromptSubmit}
              className="px-2 py-1 text-[10px] text-green-500 hover:text-green-400 font-medium transition-colors"
            >
              [enter]
            </button>
            <button
              onClick={() => { setShowPromptFor(null); setFigmaInput(''); setBaseUrlInput(''); setAuthStateInput(''); }}
              className="text-xs text-stone-400 hover:text-stone-300 transition-colors"
            >
              [esc]
            </button>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-amber-500 text-xs w-3 text-right">{'~'}</span>
            <span className="text-stone-400 text-xs font-ui w-12">auth</span>
            <input
              type="text"
              value={authStateInput}
              onChange={(e) => setAuthStateInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handlePromptSubmit()}
              placeholder=".auth/storageState.json"
              className="flex-1 px-2 py-1 bg-transparent border-b border-stone-800/50 text-xs text-stone-400 placeholder-stone-400 focus:border-amber-800 focus:outline-none"
            />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-purple-500 text-xs w-3 text-right">{'~'}</span>
            <span className="text-stone-400 text-xs font-ui w-12">figma</span>
            <input
              type="text"
              value={figmaInput}
              onChange={(e) => setFigmaInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handlePromptSubmit()}
              placeholder="figma.com/design/... (optional)"
              className="flex-1 px-2 py-1 bg-transparent border-b border-stone-800/50 text-xs text-stone-400 placeholder-stone-400 focus:border-purple-800 focus:outline-none"
            />
          </div>
        </div>
      )}

      {/* Stats — terminal-style info line */}
      <div className="flex items-center gap-4 text-xs font-mono text-stone-400">
        <span>
          {running > 0 && <span className="text-red-400">{running} running</span>}
          {running > 0 && (done > 0 || errored > 0) && <span className="text-stone-500"> | </span>}
          {done > 0 && <span className="text-green-500">{done} done</span>}
          {done > 0 && errored > 0 && <span className="text-stone-500"> | </span>}
          {errored > 0 && <span className="text-red-500">{errored} err</span>}
          {agents.length === 0 && <span className="text-stone-400">idle</span>}
        </span>

        <span className="text-stone-500">|</span>

        <span className="flex items-center gap-1 text-amber-500">
          <DollarSign size={9} />
          {(totalCost?.totalUsd ?? 0).toFixed(4)}
        </span>

        {(totalCost.inputTokens > 0 || totalCost.outputTokens > 0) && (
          <>
            <span className="text-stone-500">|</span>
            <span className="text-stone-400" title={`${totalCost.inputTokens.toLocaleString()} in / ${totalCost.outputTokens.toLocaleString()} out`}>
              {formatTokens(totalCost.inputTokens)}<span className="text-stone-500">/</span>{formatTokens(totalCost.outputTokens)} tok
            </span>
          </>
        )}

        {totalCost.durationMs > 0 && (
          <>
            <span className="text-stone-500">|</span>
            <span className="flex items-center gap-1 text-stone-400">
              <Clock size={9} />
              {formatDuration(totalCost.durationMs)}
            </span>
          </>
        )}
      </div>
    </div>
  );
}
