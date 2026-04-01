import { useState, useEffect } from 'react';
import { Check, X, Loader2, Circle, Square, MessageSquare, CheckCircle, XCircle } from 'lucide-react';
import type { PipelineState, StageName, WsCommand, AgentActivity, GuardrailViolation } from '../types';
import { OutputStream } from '../components/OutputStream';

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
}

export function PipelineView({ pipeline, sendCommand, agentOutputs, agentActivities, violations }: PipelineViewProps) {
  const { stages, agents, totalCost, mayday } = pipeline;
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [showGuidance, setShowGuidance] = useState(false);
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
      <div className="px-6 py-4 border-b border-stone-800/50 bg-[#0e0c0b]">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-1">
            {STAGES.map((stage, i) => {
              const s = stages[stage.key];
              const isActive = s.status === 'running';
              const isDone = s.status === 'done';
              const isError = s.status === 'error';
              const isSkipped = s.status === 'skipped';

              return (
                <div key={stage.key} className="flex items-center">
                  <div
                    className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
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
                  >
                    {isActive && <Loader2 size={12} className="animate-spin" />}
                    {isDone && <Check size={12} />}
                    {isError && <X size={12} />}
                    {!isActive && !isDone && !isError && <Circle size={10} className={isSkipped ? 'text-stone-600' : ''} />}
                    <span>{stage.label}</span>
                    {isDone && s.startedAt && (
                      <span className="text-[10px] text-stone-500 font-mono">
                        {formatElapsed((stages[stage.key] as { startedAt?: number }).startedAt
                          ? Date.now() - (stages[stage.key] as { startedAt?: number }).startedAt!
                          : 0
                        )}
                      </span>
                    )}
                    {isActive && s.startedAt && (
                      <span className="text-[10px] text-blue-400/70 font-mono">
                        {formatElapsed(Date.now() - s.startedAt)}
                      </span>
                    )}
                  </div>
                  {i < STAGES.length - 1 && (
                    <div className={`w-6 h-px mx-1 ${isDone ? 'bg-green-600/40' : 'bg-stone-800'}`} />
                  )}
                </div>
              );
            })}
          </div>

          {/* Cost + time */}
          <div className="flex items-center gap-4 text-xs text-stone-400 font-mono">
            <span className="text-amber-400">${(totalCost?.totalUsd ?? 0).toFixed(2)}</span>
            {totalCost.durationMs > 0 && (
              <span>{formatElapsed(totalCost.durationMs)}</span>
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

      {/* Main content: agent output */}
      <div className="flex flex-1 overflow-hidden">
        {/* Agent sidebar (only if multiple agents) */}
        {agents.length > 1 && (
          <div className="w-56 border-r border-stone-800/50 overflow-y-auto bg-[#0e0c0b]">
            <div className="px-3 py-2 text-[10px] text-stone-500 uppercase tracking-wider font-medium">
              Agents ({agents.length})
            </div>
            {agents.map((agent) => (
              <button
                key={agent.id}
                onClick={() => setSelectedAgentId(agent.id)}
                className={`w-full text-left px-3 py-2 text-xs transition-colors ${
                  agent.id === selectedAgentId
                    ? 'bg-stone-800/50 text-stone-200'
                    : 'text-stone-400 hover:bg-stone-800/20 hover:text-stone-300'
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className={`w-1.5 h-1.5 rounded-full ${
                    agent.status === 'running' ? 'bg-blue-400 animate-pulse' :
                    agent.status === 'done' ? 'bg-green-500' :
                    agent.status === 'error' ? 'bg-red-500' : 'bg-stone-600'
                  }`} />
                  <span className="truncate">{agent.name}</span>
                </div>
                {agent.status === 'running' && agent.startedAt && (
                  <div className="text-[10px] text-stone-500 mt-0.5 ml-3.5 font-mono">
                    {formatElapsed(Date.now() - agent.startedAt)}
                  </div>
                )}
              </button>
            ))}
          </div>
        )}

        {/* Output stream */}
        <div className="flex-1 overflow-hidden">
          <OutputStream
            agent={selectedAgent}
            liveOutput={selectedAgentId ? agentOutputs.get(selectedAgentId) || '' : ''}
            activities={selectedAgentId ? agentActivities.get(selectedAgentId) || [] : []}
            onSendInput={(agentId, text) => sendCommand({ action: 'send-input', agentId, text })}
          />
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
