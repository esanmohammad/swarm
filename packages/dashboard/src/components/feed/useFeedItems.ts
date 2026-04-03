import { useMemo } from 'react';
import type { PipelineState, HistoryEntry, Agent, StageName } from '../../types';

export interface FeedItemData {
  id: string;
  type: string;
  label: string;
  icon?: string;
  status: 'running' | 'done' | 'error' | 'pending' | 'success';
  group: 'running' | 'today' | 'earlier' | 'tools';
  cost?: number;
  timestamp?: number;
  agentIds?: string[];
  historyEntry?: HistoryEntry;
  agent?: Agent;
}

function isToday(ts: number): boolean {
  const d = new Date(ts);
  const now = new Date();
  return d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
}

const STAGE_ORDER: StageName[] = ['analyze', 'architect', 'plan', 'build', 'test'];

export function useFeedItems(state: PipelineState, historyEntries: HistoryEntry[]): FeedItemData[] {
  return useMemo(() => {
    const items: FeedItemData[] = [];
    const coveredAgentIds = new Set<string>();

    // 1. Active mayday pipeline — always show
    if (state.mayday?.active) {
      const maydayStatus = state.mayday.currentStage === 'complete' ? 'done'
        : state.mayday.error ? 'error'
        : 'running';

      items.push({
        id: 'mayday',
        type: 'pipeline',
        label: state.mayday.featureRequest?.slice(0, 60) || 'Building feature',
        status: maydayStatus as FeedItemData['status'],
        group: maydayStatus === 'running' ? 'running' : 'today',
        cost: state.totalCost?.totalUsd,
        timestamp: state.mayday.startedAt,
        agentIds: state.agents.map((a) => a.id),
      });

      // Mark all agents as covered by mayday
      for (const agent of state.agents) {
        coveredAgentIds.add(agent.id);
      }
      for (const id of state.mayday.fixAgentIds || []) {
        coveredAgentIds.add(id);
      }
    }
    // 2. If no mayday but stages have activity, show as "Pipeline" too
    else {
      const hasStageActivity = STAGE_ORDER.some(
        (s) => state.stages[s]?.status === 'running' || state.stages[s]?.status === 'done' || state.stages[s]?.status === 'error'
      );
      if (hasStageActivity) {
        const isRunning = STAGE_ORDER.some((s) => state.stages[s]?.status === 'running');
        const hasError = STAGE_ORDER.some((s) => state.stages[s]?.status === 'error');
        const pipelineStatus = isRunning ? 'running' : hasError ? 'error' : 'done';

        // Get the earliest start time from stages
        let earliest: number | undefined;
        for (const s of STAGE_ORDER) {
          const st = state.stages[s];
          if (st?.startedAt && (!earliest || st.startedAt < earliest)) {
            earliest = st.startedAt;
          }
        }

        items.push({
          id: 'pipeline',
          type: 'pipeline',
          label: state.projectName || 'Building feature',
          status: pipelineStatus as FeedItemData['status'],
          group: pipelineStatus === 'running' ? 'running' : 'today',
          cost: state.totalCost?.totalUsd,
          timestamp: earliest,
          agentIds: STAGE_ORDER.flatMap((s) => state.stages[s]?.agentIds ?? []),
        });

        // Mark stage agents as covered
        for (const s of STAGE_ORDER) {
          for (const id of state.stages[s]?.agentIds ?? []) {
            coveredAgentIds.add(id);
          }
        }
      }
    }

    // 3. Running agents not covered by pipeline/mayday
    for (const agent of state.agents) {
      if (agent.status === 'running' && !coveredAgentIds.has(agent.id)) {
        items.push({
          id: `agent:${agent.id}`,
          type: agentToActivityType(agent),
          label: agent.name,
          status: 'running',
          group: 'running',
          cost: agent.cost?.totalUsd,
          timestamp: agent.startedAt ?? undefined,
          agent,
        });
        coveredAgentIds.add(agent.id);
      }
    }

    // 4. History entries
    for (const entry of historyEntries) {
      const group = isToday(entry.timestamp) ? 'today' : 'earlier';
      const entryStatus = entry.activityStatus === 'success' ? 'done'
        : entry.activityStatus === 'error' ? 'error'
        : 'done';

      items.push({
        id: `history:${entry.runId}`,
        type: entry.activityType || 'pipeline',
        label: entry.summary || entry.featureRequest || entry.projectName,
        status: entryStatus,
        group,
        cost: entry.totalCost?.totalUsd,
        timestamp: entry.timestamp,
        agentIds: entry.agentIds,
        historyEntry: entry,
      });

      // Mark history agents as covered
      for (const id of entry.agentIds ?? []) {
        coveredAgentIds.add(id);
      }
    }

    // 5. Completed/errored agents not covered anywhere
    for (const agent of state.agents) {
      if ((agent.status === 'done' || agent.status === 'error') && !coveredAgentIds.has(agent.id)) {
        const ts = agent.finishedAt || agent.startedAt || Date.now();
        items.push({
          id: `agent:${agent.id}`,
          type: agentToActivityType(agent),
          label: agent.name,
          status: agent.status === 'done' ? 'done' : 'error',
          group: isToday(ts) ? 'today' : 'earlier',
          cost: agent.cost?.totalUsd,
          timestamp: ts,
          agent,
        });
      }
    }

    // Sort within groups by timestamp descending
    items.sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0));

    return items;
  }, [state, historyEntries]);
}

function agentToActivityType(agent: Agent): string {
  const name = agent.name.toLowerCase();
  if (name.includes('fix')) return 'fix';
  if (name.includes('review') || name.includes('pr')) return 'review';
  if (name.includes('spike')) return 'spike';
  if (name.includes('refactor')) return 'refactor';
  if (name.includes('simplify')) return 'simplify';
  if (name.includes('test')) return 'test-gen';
  return 'pipeline';
}
