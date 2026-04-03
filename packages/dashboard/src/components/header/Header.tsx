import { Command, Wifi, WifiOff } from 'lucide-react';

interface HeaderProps {
  projectName?: string;
  totalCost?: number;
  connected: boolean;
  onOpenPalette: () => void;
}

export function Header({ projectName, totalCost, connected, onOpenPalette }: HeaderProps) {
  return (
    <header
      className="h-11 flex items-center justify-between px-4 border-b font-ui shrink-0"
      style={{ backgroundColor: 'var(--bg-surface)', borderColor: 'var(--border-muted)' }}
    >
      {/* Left: Logo + project */}
      <div className="flex items-center gap-2.5">
        <div className="flex items-center gap-2">
          <div
            className="w-5 h-5 rounded flex items-center justify-center text-[10px] font-bold"
            style={{ backgroundColor: 'var(--accent-muted)', color: 'var(--accent)' }}
          >
            H
          </div>
          <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
            Hivemind
          </span>
        </div>
        {projectName && (
          <>
            <span style={{ color: 'var(--text-disabled)' }}>/</span>
            <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>
              {projectName}
            </span>
          </>
        )}
      </div>

      {/* Right */}
      <div className="flex items-center gap-3">
        {/* Command palette */}
        <button
          onClick={onOpenPalette}
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs transition-colors"
          style={{
            backgroundColor: 'var(--bg-subtle)',
            color: 'var(--text-tertiary)',
            border: '1px solid var(--border-muted)',
          }}
          title="Command palette (Cmd+K)"
        >
          <Command size={11} />
          <span>K</span>
        </button>

        {/* Cost */}
        {totalCost != null && totalCost > 0 && (
          <span className="text-xs tabular-nums font-code" style={{ color: 'var(--text-secondary)' }}>
            ${totalCost.toFixed(2)}
          </span>
        )}

        {/* Connection */}
        <div className="flex items-center gap-1.5" title={connected ? 'Connected' : 'Reconnecting...'}>
          {connected ? (
            <Wifi size={12} style={{ color: 'var(--status-success)' }} />
          ) : (
            <WifiOff size={12} style={{ color: 'var(--status-error)' }} />
          )}
          <span
            className="w-1.5 h-1.5 rounded-full"
            style={{ backgroundColor: connected ? 'var(--status-success)' : 'var(--status-error)' }}
          />
        </div>
      </div>
    </header>
  );
}
