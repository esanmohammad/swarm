import type { PipelineState } from '../../types';
import { useWs } from '../../context/WebSocketContext';
import { EmptyCanvas } from './EmptyCanvas';
import { PipelineCanvas } from './PipelineCanvas';
import { WorkflowCanvas } from './WorkflowCanvas';
import { HistoryCanvas } from './HistoryCanvas';
import { ConventionsCanvas } from './ConventionsCanvas';
import { MemoryCanvas } from './MemoryCanvas';
import { StatsCanvas } from './StatsCanvas';
import { PRReviewCanvas } from './PRReviewCanvas';

interface CanvasProps {
  state: PipelineState;
  ws: ReturnType<typeof useWs>;
  selectedId: string | null;
}

export function Canvas({ state, ws, selectedId }: CanvasProps) {
  // Build Feature (launch form)
  if (selectedId === 'tool:build' || selectedId === null) {
    return (
      <div className="flex-1 min-w-0 overflow-hidden">
        <EmptyCanvas sendCommand={ws.sendCommand} />
      </div>
    );
  }

  // Tool canvases
  if (selectedId === 'tool:pr-reviews') {
    return (
      <div className="flex-1 min-w-0 overflow-hidden">
        <PRReviewCanvas prReviews={ws.prReviews} sendCommand={ws.sendCommand} />
      </div>
    );
  }

  if (selectedId === 'tool:conventions') {
    return (
      <div className="flex-1 min-w-0 overflow-hidden">
        <ConventionsCanvas
          conventions={ws.conventions}
          loading={ws.conventionsLoading}
          sendCommand={ws.sendCommand}
        />
      </div>
    );
  }

  if (selectedId === 'tool:memory') {
    return (
      <div className="flex-1 min-w-0 overflow-hidden">
        <MemoryCanvas memories={ws.memories} sendCommand={ws.sendCommand} />
      </div>
    );
  }

  if (selectedId === 'tool:stats') {
    return (
      <div className="flex-1 min-w-0 overflow-hidden">
        <StatsCanvas stats={ws.stats} historyEntries={ws.historyEntries} state={state} />
      </div>
    );
  }

  // Pipeline view (mayday or manual stages)
  if (selectedId === 'mayday' || selectedId === 'pipeline') {
    return (
      <div className="flex-1 min-w-0 overflow-hidden">
        <PipelineCanvas
          state={state}
          agentOutputs={ws.agentOutputs}
          agentActivities={ws.agentActivities}
          sendCommand={ws.sendCommand}
          artifactContent={ws.artifactContent}
        />
      </div>
    );
  }

  // Agent-based items (running or completed agents still in state)
  if (selectedId?.startsWith('agent:')) {
    const agentId = selectedId.replace('agent:', '');
    const agent = state.agents.find((a) => a.id === agentId);
    if (agent) {
      return (
        <div className="flex-1 min-w-0 overflow-hidden">
          <WorkflowCanvas
            agent={agent}
            agentOutput={ws.agentOutputs.get(agentId) || ''}
            agentActivities={ws.agentActivities.get(agentId) || []}
            sendCommand={ws.sendCommand}
          />
        </div>
      );
    }
  }

  // History items
  if (selectedId?.startsWith('history:')) {
    const runId = selectedId.replace('history:', '');
    const entry = ws.historyEntries.find((h) => h.runId === runId);
    if (entry) {
      // Pipeline-type entries: show pipeline canvas only if it's genuinely a full pipeline
      const isPipeline = entry.activityType === 'pipeline';
      if (isPipeline) {
        // Check if we have agents from this entry in current state
        const hasStageAgents = entry.agentIds && entry.agentIds.length > 1;
        if (hasStageAgents) {
          return (
            <div className="flex-1 min-w-0 overflow-hidden">
              <PipelineCanvas
                state={state}
                agentOutputs={ws.agentOutputs}
                agentActivities={ws.agentActivities}
                sendCommand={ws.sendCommand}
                artifactContent={ws.artifactContent}
              />
            </div>
          );
        }
      }

      // For all other types (fix, review, spike, etc.) or single-agent pipelines:
      // Try to find the agent in state, otherwise show a history detail view
      const agentId = entry.agentIds?.[0];
      const agent = agentId ? state.agents.find((a) => a.id === agentId) : undefined;

      if (agent) {
        return (
          <div className="flex-1 min-w-0 overflow-hidden">
            <WorkflowCanvas
              agent={agent}
              agentOutput={ws.agentOutputs.get(agent.id) || ''}
              agentActivities={ws.agentActivities.get(agent.id) || []}
              sendCommand={ws.sendCommand}
            />
          </div>
        );
      }

      // Agent not in state — show history detail canvas
      return (
        <div className="flex-1 min-w-0 overflow-hidden">
          <HistoryCanvas
            entry={entry}
            agentOutputs={ws.agentOutputs}
            agentActivities={ws.agentActivities}
            sendCommand={ws.sendCommand}
          />
        </div>
      );
    }
  }

  // Nothing selected — show empty canvas / launch form
  return (
    <div className="flex-1 min-w-0 overflow-hidden">
      <EmptyCanvas sendCommand={ws.sendCommand} />
    </div>
  );
}
