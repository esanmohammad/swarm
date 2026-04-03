import { useEffect, useMemo } from 'react';
import { PanelLeftClose, PanelLeft } from 'lucide-react';
import { useFeedStore, setFeedItemIds } from '../../store/feed-store';
import { FeedSection } from './FeedSection';
import { FeedItem } from './FeedItem';
import { useFeedItems } from './useFeedItems';
import type { PipelineState, HistoryEntry, Agent } from '../../types';

interface FeedProps {
  state: PipelineState;
  historyEntries: HistoryEntry[];
  agentOutputs: Map<string, string>;
  onKillAgent: (agent: Agent) => void;
}

const TOOL_ITEMS = [
  { id: 'tool:build', label: 'Build Feature', icon: 'pipeline' },
  { id: 'tool:pr-reviews', label: 'PR Reviews', icon: 'review' },
  { id: 'tool:conventions', label: 'Coding Conventions', icon: 'conventions' },
  { id: 'tool:memory', label: 'Project Memory', icon: 'memory' },
  { id: 'tool:stats', label: 'Usage & Costs', icon: 'stats' },
];

export function Feed({ state, historyEntries }: FeedProps) {
  const { selectedId, select, toggleSection, isSectionCollapsed, sidebarCollapsed, toggleSidebar } = useFeedStore();
  const items = useFeedItems(state, historyEntries);

  const running = items.filter((i) => i.status === 'running');
  const today = items.filter((i) => i.status !== 'running' && i.group === 'today');
  const earlier = items.filter((i) => i.status !== 'running' && i.group === 'earlier');

  // Register all visible item IDs for keyboard navigation
  const allVisibleIds = useMemo(() => {
    const ids: string[] = [];
    if (!isSectionCollapsed('running')) running.forEach((i) => ids.push(i.id));
    if (!isSectionCollapsed('today')) today.forEach((i) => ids.push(i.id));
    if (!isSectionCollapsed('earlier')) earlier.forEach((i) => ids.push(i.id));
    if (!isSectionCollapsed('tools')) TOOL_ITEMS.forEach((t) => ids.push(t.id));
    return ids;
  }, [running, today, earlier, isSectionCollapsed]);

  useEffect(() => {
    setFeedItemIds(allVisibleIds);
  }, [allVisibleIds]);

  // Collapsed sidebar — just show toggle button
  if (sidebarCollapsed) {
    return (
      <div
        className="w-10 shrink-0 flex flex-col items-center pt-2 border-r"
        style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-muted)' }}
      >
        <button
          onClick={toggleSidebar}
          className="p-1.5 rounded transition-colors"
          style={{ color: 'var(--text-tertiary)' }}
          title="Expand sidebar"
        >
          <PanelLeft size={14} />
        </button>
        {running.length > 0 && (
          <div className="mt-2">
            <span className="w-2 h-2 rounded-full block animate-pulse" style={{ backgroundColor: 'var(--status-running)' }} />
          </div>
        )}
      </div>
    );
  }

  return (
    <div
      className="w-[280px] shrink-0 flex flex-col border-r overflow-hidden"
      style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-muted)' }}
    >
      {/* Collapse button */}
      <div className="flex items-center justify-end px-2 py-1 shrink-0">
        <button
          onClick={toggleSidebar}
          className="p-1 rounded transition-colors"
          style={{ color: 'var(--text-disabled)' }}
          title="Collapse sidebar"
        >
          <PanelLeftClose size={13} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* In Progress */}
        {running.length > 0 && (
          <FeedSection
            label="In Progress"
            count={running.length}
            collapsed={isSectionCollapsed('running')}
            onToggle={() => toggleSection('running')}
            dotColor="var(--status-running)"
          >
            {running.map((item) => (
              <FeedItem key={item.id} item={item} selected={selectedId === item.id} onSelect={() => select(item.id)} />
            ))}
          </FeedSection>
        )}

        {/* Today */}
        {today.length > 0 && (
          <FeedSection
            label="Today"
            count={today.length}
            collapsed={isSectionCollapsed('today')}
            onToggle={() => toggleSection('today')}
          >
            {today.map((item) => (
              <FeedItem key={item.id} item={item} selected={selectedId === item.id} onSelect={() => select(item.id)} />
            ))}
          </FeedSection>
        )}

        {/* Earlier */}
        {earlier.length > 0 && (
          <FeedSection
            label="Earlier"
            count={earlier.length}
            collapsed={isSectionCollapsed('earlier')}
            onToggle={() => toggleSection('earlier')}
          >
            {earlier.map((item) => (
              <FeedItem key={item.id} item={item} selected={selectedId === item.id} onSelect={() => select(item.id)} />
            ))}
          </FeedSection>
        )}

        {/* Workspace */}
        <FeedSection
          label="Workspace"
          collapsed={isSectionCollapsed('tools')}
          onToggle={() => toggleSection('tools')}
        >
          {TOOL_ITEMS.map((tool) => (
            <FeedItem
              key={tool.id}
              item={{ id: tool.id, type: 'tool', label: tool.label, icon: tool.icon, status: 'done', group: 'tools' }}
              selected={selectedId === tool.id || (tool.id === 'tool:build' && selectedId === null)}
              onSelect={() => select(tool.id)}
            />
          ))}
        </FeedSection>
      </div>
    </div>
  );
}
