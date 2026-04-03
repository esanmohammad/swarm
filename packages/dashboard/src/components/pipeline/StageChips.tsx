import { FileText, Blocks, ListChecks, Code2, TestTube2, Wrench } from 'lucide-react';
import type { StageState, StageName, MaydayState } from '../../types';

const STAGES: { name: StageName; label: string; description: string; icon: typeof FileText }[] = [
  { name: 'analyze', label: 'Requirements', description: 'Understanding what to build', icon: FileText },
  { name: 'architect', label: 'Design', description: 'Planning the architecture', icon: Blocks },
  { name: 'plan', label: 'Tasks', description: 'Breaking into work items', icon: ListChecks },
  { name: 'build', label: 'Code', description: 'Writing the implementation', icon: Code2 },
  { name: 'test', label: 'Test', description: 'Validating with tests', icon: TestTube2 },
];

const STATUS_STYLES: Record<string, { bg: string; color: string; border: string }> = {
  running: { bg: 'var(--status-running-bg)', color: 'var(--status-running)', border: 'var(--border-active)' },
  done: { bg: 'var(--status-success-bg)', color: 'var(--status-success)', border: 'var(--border-muted)' },
  error: { bg: 'var(--status-error-bg)', color: 'var(--status-error)', border: 'var(--border-muted)' },
  pending: { bg: 'transparent', color: 'var(--text-disabled)', border: 'var(--border-muted)' },
  skipped: { bg: 'transparent', color: 'var(--text-disabled)', border: 'var(--border-muted)' },
};

interface StageChipsProps {
  stages: Record<StageName, StageState>;
  activeStage: StageName;
  onSelectStage: (stage: StageName) => void;
  mayday?: MaydayState;
}

export function StageChips({ stages, activeStage, onSelectStage, mayday }: StageChipsProps) {
  return (
    <div
      className="flex items-center gap-1 px-4 py-2 shrink-0 overflow-x-auto"
      style={{ backgroundColor: 'var(--bg-surface)', borderBottom: '1px solid var(--border-muted)' }}
    >
      {STAGES.map((stage, i) => {
        const stageState = stages[stage.name];
        const status = stageState?.status ?? 'pending';
        const styles = STATUS_STYLES[status] ?? STATUS_STYLES.pending;
        const isActive = stage.name === activeStage;
        const Icon = stage.icon;

        return (
          <div key={stage.name} className="flex items-center">
            <button
              onClick={() => onSelectStage(stage.name)}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-all"
              style={{
                backgroundColor: isActive ? styles.bg : 'transparent',
                color: isActive ? styles.color : status === 'pending' ? 'var(--text-disabled)' : styles.color,
                border: isActive ? `1px solid ${styles.border}` : '1px solid transparent',
              }}
              title={stage.description}
            >
              {status === 'running' ? (
                <span className="w-2 h-2 rounded-full animate-pulse" style={{ backgroundColor: styles.color }} />
              ) : (
                <Icon size={11} />
              )}
              {stage.label}
              {stageState?.stageCost != null && stageState.stageCost > 0 && (
                <span className="text-[10px] font-code tabular-nums opacity-60">
                  ${stageState.stageCost.toFixed(2)}
                </span>
              )}
            </button>
            {i < STAGES.length - 1 && (
              <span className="mx-0.5" style={{ color: 'var(--text-disabled)' }}>›</span>
            )}
          </div>
        );
      })}

      {mayday?.currentStage === 'fix-loop' && (
        <>
          <span className="mx-0.5" style={{ color: 'var(--text-disabled)' }}>›</span>
          <span
            className="flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium"
            style={{
              backgroundColor: 'var(--status-warning-bg)',
              color: 'var(--status-warning)',
              border: '1px solid var(--border-muted)',
            }}
          >
            <Wrench size={11} />
            Fixing #{mayday.fixIteration}
          </span>
        </>
      )}
    </div>
  );
}
