import { useState, useMemo } from 'react';
import { Square, CheckCircle2, XCircle, AlertTriangle, RotateCcw } from 'lucide-react';
import { StageChips } from '../pipeline/StageChips';
import { AgentTabs } from '../pipeline/AgentTabs';
import { OutputPanel } from '../output/OutputPanel';
import { GuardrailAlerts } from '../GuardrailAlerts';
import type { PipelineState, StageName, AgentActivity, WsCommand } from '../../types';

interface PipelineCanvasProps {
  state: PipelineState;
  agentOutputs: Map<string, string>;
  agentActivities: Map<string, AgentActivity[]>;
  sendCommand: (cmd: WsCommand) => void;
  artifactContent: Map<StageName, string>;
}

const STAGE_ORDER: StageName[] = ['analyze', 'architect', 'plan', 'build', 'validate', 'ship'];

export function PipelineCanvas({ state, agentOutputs, agentActivities, sendCommand }: PipelineCanvasProps) {
  const [selectedStage, setSelectedStage] = useState<StageName | null>(null);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);

  const mayday = state.mayday;
  const isRunning = mayday?.active && mayday.currentStage !== 'complete' && !mayday.error;
  const isComplete = mayday?.currentStage === 'complete';
  const isError = mayday?.error != null;
  const pendingApproval = mayday?.pendingApproval;

  // Detect stopped/paused state: mayday exists but is not active, not complete, no error
  // OR any stage has errored
  const hasStageError = STAGE_ORDER.some((s) => state.stages[s]?.status === 'error');
  const isStopped = !isRunning && !isComplete && !isError && (
    (mayday && !mayday.active && mayday.currentStage !== 'complete') || hasStageError
  );
  // Can resume if there's a feature request and pipeline is stopped, errored, or complete
  const canResume = !!mayday?.featureRequest && (isStopped || isError || isComplete);

  // Compute total cost from best available source
  const totalCost = state.totalCost?.totalUsd > 0
    ? state.totalCost.totalUsd
    : (() => {
        // Try agent costs first
        const agentCost = state.agents.reduce((sum, a) => sum + (a.cost?.totalUsd ?? 0), 0);
        if (agentCost > 0) return agentCost;
        // Fall back to stage costs
        return STAGE_ORDER.reduce((sum, s) => sum + (state.stages[s]?.stageCost ?? 0), 0);
      })();

  // Determine active stage
  const activeStage = useMemo(() => {
    if (selectedStage) return selectedStage;
    for (const stage of STAGE_ORDER) {
      if (state.stages[stage]?.status === 'running') return stage;
    }
    let last: StageName | null = null;
    for (const stage of STAGE_ORDER) {
      if (state.stages[stage]?.status === 'done' || state.stages[stage]?.status === 'error') {
        last = stage;
      }
    }
    return last ?? 'analyze';
  }, [state.stages, selectedStage]);

  // Agents for current stage
  const stageAgents = useMemo(() => {
    const stageState = state.stages[activeStage];
    if (!stageState) return [];
    return stageState.agentIds
      .map((id) => state.agents.find((a) => a.id === id))
      .filter(Boolean) as typeof state.agents;
  }, [state, activeStage]);

  // Fix agents
  const fixAgents = useMemo(() => {
    if (!mayday?.fixAgentIds) return [];
    return mayday.fixAgentIds
      .map((id) => state.agents.find((a) => a.id === id))
      .filter(Boolean) as typeof state.agents;
  }, [state, mayday]);

  const allAgents = activeStage === 'build' ? [...stageAgents, ...fixAgents] : stageAgents;

  const currentAgent = useMemo(() => {
    if (selectedAgentId) return allAgents.find((a) => a.id === selectedAgentId) ?? allAgents[0];
    return allAgents.find((a) => a.status === 'running') ?? allAgents[0];
  }, [allAgents, selectedAgentId]);

  const currentOutput = currentAgent ? (agentOutputs.get(currentAgent.id) || '') : '';
  const currentActivities = currentAgent ? (agentActivities.get(currentAgent.id) || []) : [];

  // Stage progress
  const completedStages = STAGE_ORDER.filter((s) => state.stages[s]?.status === 'done').length;
  const runningStageIdx = STAGE_ORDER.findIndex((s) => state.stages[s]?.status === 'running');
  const currentStageNum = runningStageIdx >= 0 ? runningStageIdx + 1 : completedStages;
  const STAGE_LABELS: Record<string, string> = { analyze: 'Requirements', architect: 'Design', plan: 'Tasks', build: 'Code', validate: 'Validate', ship: 'Ship' };
  const currentStageName = runningStageIdx >= 0 ? STAGE_LABELS[STAGE_ORDER[runningStageIdx]] : null;

  return (
    <div className="flex flex-col h-full">
      {/* Control bar */}
      <div
        className="flex items-center justify-between px-4 py-2 shrink-0"
        style={{ backgroundColor: 'var(--bg-surface)', borderBottom: '1px solid var(--border-muted)' }}
      >
        {/* Status */}
        <div className="flex items-center gap-2">
          {isRunning && (
            <span className="flex items-center gap-1.5 text-xs font-medium" style={{ color: 'var(--status-running)' }}>
              <span className="w-2 h-2 rounded-full animate-pulse" style={{ backgroundColor: 'var(--status-running)' }} />
              {currentStageName ? `${currentStageName}` : 'Building'}
              <span className="font-normal" style={{ color: 'var(--text-tertiary)' }}>
                step {currentStageNum} of {STAGE_ORDER.length}
              </span>
            </span>
          )}
          {isComplete && (
            <span className="flex items-center gap-1.5 text-xs font-medium" style={{ color: 'var(--status-success)' }}>
              <CheckCircle2 size={12} />
              Complete
            </span>
          )}
          {(isError || (isStopped && hasStageError)) && (
            <span className="flex items-center gap-1.5 text-xs font-medium" style={{ color: 'var(--status-error)' }}>
              <XCircle size={12} />
              Failed
              {mayday?.error ? (
                <span className="font-normal" style={{ color: 'var(--text-tertiary)' }}>
                  — {mayday.error.slice(0, 80)}
                </span>
              ) : hasStageError ? (
                <span className="font-normal" style={{ color: 'var(--text-tertiary)' }}>
                  — {STAGE_LABELS[STAGE_ORDER.find((s) => state.stages[s]?.status === 'error') || ''] || 'Stage'} step failed
                </span>
              ) : null}
            </span>
          )}
          {isStopped && !hasStageError && (
            <span className="flex items-center gap-1.5 text-xs font-medium" style={{ color: 'var(--status-warning)' }}>
              <Square size={12} />
              Stopped
              <span className="font-normal" style={{ color: 'var(--text-tertiary)' }}>
                at {STAGE_LABELS[mayday?.currentStage as string] || mayday?.currentStage || 'unknown'} step
              </span>
            </span>
          )}
          {!isRunning && !isComplete && !isError && !isStopped && (
            <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
              {state.projectName || 'Build'}
            </span>
          )}

          {/* Cost */}
          {totalCost > 0 && (
            <span className="text-xs font-code tabular-nums" style={{ color: 'var(--text-secondary)' }}>
              ${totalCost.toFixed(2)}
            </span>
          )}
          {completedStages > 0 && (
            <span className="text-[10px]" style={{ color: 'var(--text-disabled)' }}>
              {completedStages}/{STAGE_ORDER.length} steps done
            </span>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2">
          {/* Approval required */}
          {pendingApproval && (
            <>
              <span className="flex items-center gap-1 text-xs" style={{ color: 'var(--status-warning)' }}>
                <AlertTriangle size={11} />
                Waiting for approval
              </span>
              <button
                onClick={() => sendCommand({ action: 'mayday-approve', stage: pendingApproval.stage })}
                className="flex items-center gap-1 px-2.5 py-1 rounded text-xs font-medium transition-colors"
                style={{ backgroundColor: 'var(--status-success-bg)', color: 'var(--status-success)', border: '1px solid var(--border-muted)' }}
              >
                <CheckCircle2 size={10} />
                Approve
              </button>
              <button
                onClick={() => sendCommand({ action: 'mayday-reject', stage: pendingApproval.stage })}
                className="flex items-center gap-1 px-2.5 py-1 rounded text-xs font-medium transition-colors"
                style={{ backgroundColor: 'var(--status-error-bg)', color: 'var(--status-error)', border: '1px solid var(--border-muted)' }}
              >
                <XCircle size={10} />
                Reject
              </button>
            </>
          )}

          {/* Stop */}
          {isRunning && (
            <button
              onClick={() => sendCommand({ action: 'mayday-stop' })}
              className="flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium transition-colors"
              style={{ backgroundColor: 'var(--status-error-bg)', color: 'var(--status-error)', border: '1px solid var(--border-muted)' }}
            >
              <Square size={10} />
              Stop
            </button>
          )}

          {/* Resume / Retry — visible for stopped, errored, or completed pipelines */}
          {canResume && (
            <button
              onClick={() => {
                let fromStage: StageName | undefined;
                for (const s of STAGE_ORDER) {
                  const st = state.stages[s];
                  if (st?.status === 'error') { fromStage = s; break; }
                  if (st?.status === 'pending' || st?.status === 'running') { fromStage = s; break; }
                }
                sendCommand({
                  action: 'run-mayday',
                  prompt: mayday!.featureRequest,
                  resume: true,
                  fromStage,
                });
              }}
              className="flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium transition-colors"
              style={{ backgroundColor: 'var(--accent-muted)', color: 'var(--accent)', border: '1px solid var(--border-muted)' }}
            >
              <RotateCcw size={10} />
              {hasStageError || isError ? 'Retry from Failed Step' : isComplete ? 'Run Again' : 'Resume'}
            </button>
          )}
        </div>
      </div>

      {/* Stage chips */}
      <StageChips
        stages={state.stages}
        activeStage={activeStage}
        onSelectStage={(s) => { setSelectedStage(s); setSelectedAgentId(null); }}
        mayday={mayday}
      />

      {/* Guardrail violations */}
      {state.violations.length > 0 && (
        <GuardrailAlerts violations={state.violations} />
      )}

      {/* Agent tabs */}
      {allAgents.length > 0 && (
        <AgentTabs
          agents={allAgents}
          selectedId={currentAgent?.id ?? null}
          onSelect={setSelectedAgentId}
        />
      )}

      {/* Output panel */}
      <div className="flex-1 min-h-0">
        <OutputPanel
          agent={currentAgent ?? null}
          liveOutput={currentOutput}
          activities={currentActivities}
          onSendInput={(agentId, text) => {
            sendCommand({ action: 'send-input', agentId, text });
          }}
        />
      </div>
    </div>
  );
}
