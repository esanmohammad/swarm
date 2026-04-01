import { useState, useEffect } from 'react';
import { Check, X, Loader2, Circle, Square, MessageSquare, CheckCircle, XCircle, Trash2, RotateCw } from 'lucide-react';
import type { PipelineState, StageName, WsCommand, AgentActivity, GuardrailViolation } from '../types';
import { OutputStream } from '../components/OutputStream';
import { usePersistedState } from '../hooks/usePersistedState';
import { OnboardingTooltip } from '../components/OnboardingTooltip';
import { ArtifactPreview, ArtifactButton } from '../components/ArtifactPreview';
import type { OnboardingStep } from '../hooks/useOnboarding';

const STAGES: { key: StageName; label: string }[] = [
  { key: 'analyze', label: 'Analyze' },
  { key: 'architect', label: 'Architect' },
  { key: 'plan', label: 'Plan' },
  { key: 'build', label: 'Build' },
  { key: 'test', label: 'Test' },
];

function formatElapsed(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

interface PipelineViewProps {
  pipeline: PipelineState;
  sendCommand: (cmd: WsCommand) => void;
  agentOutputs: Map<string, string>;
  agentActivities: Map<string, AgentActivity[]>;
  violations: GuardrailViolation[];
  artifactContent?: Map<StageName, string>;
  onboardingStep?: OnboardingStep;
  onDismissOnboarding?: () => void;
}

export function PipelineView({ pipeline, sendCommand, agentOutputs, agentActivities, violations, artifactContent, onboardingStep, onDismissOnboarding }: PipelineViewProps) {
  const { stages, agents, totalCost, mayday } = pipeline;
  const [selectedAgentId, setSelectedAgentId] = usePersistedState<string | null>('swarm_selected_agent', null);
  const [showGuidance, setShowGuidance] = useState(false);
  const [previewStage, setPreviewStage] = useState<StageName | null>(null);
  const [guidanceText, setGuidanceText] = useState('');

  // Live elapsed timer
  const [, setTick] = useState(0);
  const hasRunning = Object.values(stages).some((s) => s.status === 'running');
  useEffect(() => {
    if (!hasRunning) return;
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [hasRunning]);

  // Auto-select first running agent
  useEffect(() => {
    if (!selectedAgentId || !agents.find((a) => a.id === selectedAgentId)) {
      const running = agents.find((a) => a.status === 'running');
      if (running) setSelectedAgentId(running.id);
      else if (agents.length > 0) setSelectedAgentId(agents[agents.length - 1].id);
    }
  }, [agents, selectedAgentId]);

  const selectedAgent = agents.find((a) => a.id === selectedAgentId) ?? null;

  const handleSendGuidance = () => {
    if (!guidanceText.trim()) return;
    sendCommand({ action: 'mayday-input', text: guidanceText.trim() });
    setGuidanceText('');
    setShowGuidance(false);
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Pipeline stepper */}
      <div className="px-3 sm:px-6 py-3 sm:py-4 border-b border-stone-800/50 bg-[#0e0c0b]">
        <div className="flex items-center justify-between mb-3 gap-2">
          <div className="flex items-center gap-0.5 sm:gap-1 overflow-x-auto" role="list" aria-label="Pipeline stages">
            {STAGES.map((stage, i) => {
              const s = stages[stage.key];
              const isActive = s.status === 'running';
              const isDone = s.status === 'done';
              const isError = s.status === 'error';
              const isSkipped = s.status === 'skipped';
              const statusLabel = isActive ? 'running' : isDone ? 'done' : isError ? 'error' : isSkipped ? 'skipped' : 'pending';

              return (
                <div key={stage.key} className="flex items-center shrink-0" role="listitem">
                  <div
                    className={`group relative flex items-center gap-1 sm:gap-2 px-2 sm:px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                      isActive
                        ? 'bg-blue-600/15 text-blue-300 border border-blue-500/30'
                        : isDone
                          ? 'text-green-400'
                          : isError
                            ? 'text-red-400'
                            : isSkipped
                              ? 'text-stone-600'
                              : 'text-stone-500'
                    }`}
                    aria-label={`${stage.label}: ${statusLabel}`}
                  >
                    {isActive && <Loader2 size={12} className="animate-spin" aria-hidden="true" />}
                    {isDone && <Check size={12} aria-hidden="true" />}
                    {isError && <X size={12} aria-hidden="true" />}
                    {!isActive && !isDone && !isError && <Circle size={10} className={isSkipped ? 'text-stone-600' : ''} aria-hidden="true" />}
                    <span>{stage.label}</span>
                    {isDone && s.startedAt && (
                      <span className="text-[10px] text-stone-500 font-mono hidden sm:inline">
                        {formatElapsed((stages[stage.key] as { startedAt?: number }).startedAt
                          ? Date.now() - (stages[stage.key] as { startedAt?: number }).startedAt!
                          : 0
                        )}
                      </span>
                    )}
                    {isActive && s.startedAt && (
                      <span className="text-[10px] text-blue-400/70 font-mono hidden sm:inline">
                        {formatElapsed(Date.now() - s.startedAt)}
                      </span>
                    )}
                    {isDone && (
                      <ArtifactButton
                        stage={stage.key}
                        onClick={() => {
                          sendCommand({ action: 'get-artifact', stage: stage.key });
                          setPreviewStage(previewStage === stage.key ? null : stage.key);
                        }}
                      />
                    )}

                    {/* Restart from stage (on hover for done/error stages) */}
                    {(isDone || isError) && !mayday?.active && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          sendCommand({ action: 'run-stage', stage: stage.key as 'analyze' | 'architect' | 'plan' | 'build' | 'test' });
                        }}
                        className="hidden group-hover:flex items-center gap-0.5 px-1 py-0.5 rounded text-[9px] text-stone-400 hover:text-blue-300 hover:bg-blue-600/10 transition-colors"
                        aria-label={`Re-run ${stage.label} stage`}
                        title={`Re-run ${stage.label}`}
                      >
                        <RotateCw size={8} />
                      </button>
                    )}
                  </div>
                  {i < STAGES.length - 1 && (
                    <div className={`w-3 sm:w-6 h-px mx-0.5 sm:mx-1 ${isDone ? 'bg-green-600/40' : 'bg-stone-800'}`} aria-hidden="true" />
                  )}
                </div>
              );
            })}
          </div>

          {/* Cost + time */}
          <div className="flex items-center gap-2 sm:gap-4 text-xs text-stone-400 font-mono shrink-0" aria-label="Pipeline cost and duration">
            <span className="text-amber-400">${(totalCost?.totalUsd ?? 0).toFixed(2)}</span>
            {totalCost.durationMs > 0 && (
              <span className="hidden sm:inline">{formatElapsed(totalCost.durationMs)}</span>
            )}
          </div>
        </div>

        {/* Approval gate */}
        {mayday?.pendingApproval && (
          <div className="flex items-center gap-3 p-3 rounded-lg bg-amber-950/20 border border-amber-800/30">
            <span className="text-xs text-stone-300 flex-1">
              Stage <span className="text-amber-300 font-semibold">{mayday.pendingApproval.stage}</span> complete — approve to continue
            </span>
            <button
              onClick={() => sendCommand({ action: 'mayday-approve', stage: mayday.pendingApproval!.stage })}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium text-green-300 bg-green-600/15 hover:bg-green-600/25 border border-green-500/30 transition-colors"
            >
              <CheckCircle size={13} /> Approve
            </button>
            <button
              onClick={() => sendCommand({ action: 'mayday-reject', stage: mayday.pendingApproval!.stage })}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium text-red-300 bg-red-600/15 hover:bg-red-600/25 border border-red-500/30 transition-colors"
            >
              <XCircle size={13} /> Reject
            </button>
          </div>
        )}

        {/* Guidance input */}
        {showGuidance && mayday?.active && (
          <div className="flex items-center gap-2 mt-3">
            <input
              type="text"
              value={guidanceText}
              onChange={(e) => setGuidanceText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSendGuidance();
                if (e.key === 'Escape') { setShowGuidance(false); setGuidanceText(''); }
              }}
              placeholder="Send guidance to the running pipeline..."
              className="flex-1 px-3 py-1.5 bg-stone-900/60 border border-stone-700/40 rounded text-xs text-stone-200 placeholder-stone-500 focus:border-blue-600 focus:outline-none"
              autoFocus
            />
            <button
              onClick={handleSendGuidance}
              disabled={!guidanceText.trim()}
              className="px-3 py-1.5 text-xs font-medium text-blue-300 hover:text-blue-200 disabled:text-stone-600 transition-colors"
            >
              Send
            </button>
          </div>
        )}
      </div>

      {/* Artifact preview panel */}
      {previewStage && artifactContent?.get(previewStage) && (
        <div className="px-4 py-2 border-b border-stone-800/50">
          <ArtifactPreview
            stage={previewStage}
            content={artifactContent.get(previewStage)!}
            onClose={() => setPreviewStage(null)}
          />
        </div>
      )}

      {/* Main content: agent output */}
      <div className="flex flex-1 overflow-hidden flex-col md:flex-row">
        {/* Agent sidebar — dropdown on mobile, sidebar on desktop */}
        {agents.length > 1 && (
          <>
            {/* Mobile: dropdown select */}
            <div className="md:hidden flex items-center gap-2 px-3 py-2 border-b border-stone-800/50 bg-[#0e0c0b]">
              <label htmlFor="agent-select" className="text-[10px] text-stone-500 uppercase tracking-wider font-medium shrink-0">Agent:</label>
              <select
                id="agent-select"
                value={selectedAgentId || ''}
                onChange={(e) => setSelectedAgentId(e.target.value)}
                className="flex-1 px-2 py-1.5 bg-[#0c0a09] border border-stone-800/50 rounded text-xs text-stone-300 focus:border-stone-600 focus:outline-none"
                aria-label="Select agent"
              >
                {agents.map((agent) => (
                  <option key={agent.id} value={agent.id}>
                    {agent.status === 'running' ? '● ' : agent.status === 'done' ? '✓ ' : agent.status === 'error' ? '✗ ' : '○ '}
                    {agent.name}
                  </option>
                ))}
              </select>
              {agents.some(a => a.status === 'running') && (
                <button
                  onClick={() => agents.filter(a => a.status === 'running').forEach(a => sendCommand({ action: 'kill', agentId: a.id }))}
                  className="text-[9px] text-red-500/60 hover:text-red-400 transition-colors flex items-center gap-0.5 shrink-0 min-h-[36px] px-2"
                  aria-label="Stop all running agents"
                >
                  <Trash2 size={9} />
                  Stop all
                </button>
              )}
            </div>

            {/* Desktop: sidebar */}
            <div className="hidden md:block w-56 border-r border-stone-800/50 overflow-y-auto bg-[#0e0c0b]" role="listbox" aria-label="Agent list">
              <div className="flex items-center justify-between px-3 py-2">
                <span className="text-[10px] text-stone-500 uppercase tracking-wider font-medium">
                  Agents ({agents.length})
                </span>
                {agents.some(a => a.status === 'running') && (
                  <button
                    onClick={() => agents.filter(a => a.status === 'running').forEach(a => sendCommand({ action: 'kill', agentId: a.id }))}
                    className="text-[9px] text-red-500/60 hover:text-red-400 transition-colors flex items-center gap-0.5"
                    aria-label="Stop all running agents"
                  >
                    <Trash2 size={9} />
                    Stop all
                  </button>
                )}
              </div>
              {agents.map((agent) => {
                const statusLabel = agent.status === 'running' ? 'running' : agent.status === 'done' ? 'done' : agent.status === 'error' ? 'error' : 'pending';
                return (
                  <button
                    key={agent.id}
                    onClick={() => setSelectedAgentId(agent.id)}
                    role="option"
                    aria-selected={agent.id === selectedAgentId}
                    aria-label={`${agent.name} — ${statusLabel}`}
                    className={`w-full text-left px-3 py-2 text-xs transition-colors ${
                      agent.id === selectedAgentId
                        ? 'bg-stone-800/50 text-stone-200'
                        : 'text-stone-400 hover:bg-stone-800/20 hover:text-stone-300'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                          agent.status === 'running' ? 'bg-blue-400 animate-pulse' :
                          agent.status === 'done' ? 'bg-green-500' :
                          agent.status === 'error' ? 'bg-red-500' : 'bg-stone-600'
                        }`}
                        aria-hidden="true"
                      />
                      <span className="truncate">{agent.name}</span>
                    </div>
                    {agent.status === 'running' && agent.startedAt && (
                      <div className="text-[10px] text-stone-500 mt-0.5 ml-3.5 font-mono">
                        {formatElapsed(Date.now() - agent.startedAt)}
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </>
        )}

        {/* Output stream */}
        <div className="flex-1 overflow-hidden relative">
          <OutputStream
            agent={selectedAgent}
            liveOutput={selectedAgentId ? agentOutputs.get(selectedAgentId) || '' : ''}
            activities={selectedAgentId ? agentActivities.get(selectedAgentId) || [] : []}
            onSendInput={(agentId, text) => sendCommand({ action: 'send-input', agentId, text })}
          />

          {/* Onboarding tooltips */}
          {onboardingStep === 'analyzing' && onDismissOnboarding && (
            <div className="absolute top-4 left-1/2 -translate-x-1/2 z-30">
              <OnboardingTooltip
                title="The Analyst is working"
                description="It's gathering requirements and writing REQUIREMENTS.md. You can type in the input bar below to answer questions or add context."
                onDismiss={onDismissOnboarding}
                position="bottom"
              />
            </div>
          )}
          {onboardingStep === 'stage-complete' && onDismissOnboarding && (
            <div className="absolute top-4 left-1/2 -translate-x-1/2 z-30">
              <OnboardingTooltip
                title="Stage complete!"
                description="You can review the output before the next stage starts. Each stage builds on the previous one's artifact."
                onDismiss={onDismissOnboarding}
                position="bottom"
              />
            </div>
          )}
          {onboardingStep === 'building' && onDismissOnboarding && (
            <div className="absolute top-4 left-4 z-30">
              <OnboardingTooltip
                title="Engineers working in parallel"
                description="Multiple engineer agents are implementing tasks simultaneously. Click an agent in the sidebar to watch its progress."
                onDismiss={onDismissOnboarding}
                position="bottom"
              />
            </div>
          )}
          {onboardingStep === 'done' && onDismissOnboarding && (
            <div className="absolute top-4 left-1/2 -translate-x-1/2 z-30">
              <OnboardingTooltip
                title="Pipeline complete!"
                description="Check the Results tab to see all file changes, test results, and total cost breakdown."
                onDismiss={onDismissOnboarding}
                position="bottom"
              />
            </div>
          )}
        </div>
      </div>

      {/* Bottom bar */}
      <div className="flex items-center justify-between px-4 py-2 border-t border-stone-800/50 bg-[#0e0c0b]">
        <div className="flex items-center gap-3 text-xs text-stone-400">
          {mayday?.active && (
            <>
              {mayday.currentStage === 'fix-loop' && (
                <span className="text-amber-400">Fix iteration {mayday.fixIteration}/{mayday.maxFixIterations}</span>
              )}
              {mayday.failureCount != null && mayday.failureCount > 0 && (
                <span className="text-red-400">{mayday.failureCount} test failures</span>
              )}
            </>
          )}
          {violations.length > 0 && (
            <span className="text-amber-400">{violations.length} guardrail violation{violations.length > 1 ? 's' : ''}</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {mayday?.active && (
            <>
              <button
                onClick={() => setShowGuidance(!showGuidance)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs text-stone-400 hover:text-stone-300 bg-stone-800/40 hover:bg-stone-800/60 transition-colors"
              >
                <MessageSquare size={12} /> Guidance
              </button>
              <button
                onClick={() => sendCommand({ action: 'mayday-stop' })}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs text-red-400 hover:text-red-300 bg-red-950/30 hover:bg-red-950/50 transition-colors"
              >
                <Square size={12} /> Stop
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
