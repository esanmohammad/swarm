import { Wifi, WifiOff, Sun, Moon, Monitor, UserPlus, GitCompareArrows, Search } from 'lucide-react';
import { useTheme } from '../hooks/useTheme';

interface NewTopBarProps {
  connected: boolean;
  totalCost?: number;
  projectName?: string;
  pipelinesCount: number;
  onSpawnAgent: () => void;
  onComparePipelines: () => void;
  onOpenPalette: () => void;
}

export function NewTopBar({
  connected,
  totalCost,
  projectName,
  pipelinesCount,
  onSpawnAgent,
  onComparePipelines,
  onOpenPalette,
}: NewTopBarProps) {
  const { theme, cycleTheme } = useTheme();

  return (
    <header className="flex items-center justify-between px-4 py-2 border-b border-stone-800/50 bg-[#0e0c0b]">
      <div className="flex items-center gap-3 min-w-0">
        {projectName && (
          <span className="text-xs text-stone-500 truncate">{projectName}</span>
        )}
      </div>

      <div className="flex items-center gap-1.5 sm:gap-2.5 shrink-0">
        {/* Command palette shortcut */}
        <button
          onClick={onOpenPalette}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs text-stone-500 hover:text-stone-300 hover:bg-stone-800/40 border border-stone-800/40 transition-colors"
          title="Command palette (Cmd+K)"
        >
          <Search size={12} />
          <span className="hidden md:inline text-stone-600">Cmd+K</span>
        </button>

        {/* Compare */}
        {pipelinesCount > 1 && (
          <button
            onClick={onComparePipelines}
            className="flex items-center gap-1.5 px-2 py-1.5 rounded-md text-xs text-stone-500 hover:text-stone-300 hover:bg-stone-800/40 transition-colors"
            title="Compare pipelines"
          >
            <GitCompareArrows size={13} />
          </button>
        )}

        {/* Spawn agent */}
        <button
          onClick={onSpawnAgent}
          className="flex items-center gap-1.5 px-2 py-1.5 rounded-md text-xs text-stone-500 hover:text-stone-300 hover:bg-stone-800/40 transition-colors"
          title="Spawn agent (Cmd+Shift+K)"
        >
          <UserPlus size={13} />
        </button>

        {/* Cost */}
        {totalCost != null && totalCost > 0 && (
          <span className="text-xs text-amber-400 font-mono">${totalCost.toFixed(2)}</span>
        )}

        {/* Theme */}
        <button
          onClick={cycleTheme}
          className="p-1.5 rounded-md text-stone-500 hover:text-stone-300 hover:bg-stone-800/40 transition-colors"
          title={`Theme: ${theme}`}
        >
          {theme === 'dark' ? <Moon size={13} /> : theme === 'light' ? <Sun size={13} /> : <Monitor size={13} />}
        </button>

        {/* Connection */}
        <div className="flex items-center gap-1.5" role="status">
          {connected ? (
            <Wifi size={12} className="text-green-500" />
          ) : (
            <WifiOff size={12} className="text-red-500" />
          )}
          <span className={`text-[10px] font-medium hidden sm:inline ${connected ? 'text-green-500' : 'text-red-500'}`}>
            {connected ? 'connected' : 'offline'}
          </span>
        </div>
      </div>
    </header>
  );
}
