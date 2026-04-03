import { useState } from 'react';
import { Loader2, CheckCircle, XCircle, Clock, DollarSign, X, ChevronDown, ChevronUp } from 'lucide-react';
import type { ActionState, ActionStatus } from '../hooks/useAction';

interface ActionProgressProps {
  state: ActionState;
  onCancel?: () => void;
  onRetry?: () => void;
  onDismiss?: () => void;
  actions?: Array<{ label: string; onClick: () => void; href?: string }>;
  compact?: boolean;
}

function formatElapsed(ms: number): string {
  if (ms < 1000) return '<1s';
  if (ms < 60000) return `${Math.round(ms / 1000)}s`;
  return `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`;
}

export function ActionProgress({ state, onCancel, onRetry, onDismiss, actions, compact }: ActionProgressProps) {
  const [expanded, setExpanded] = useState(false);

  if (state.status === 'idle') return null;

  const statusConfig: Record<ActionStatus, { icon: typeof Loader2; color: string; bgColor: string; borderColor: string }> = {
    idle: { icon: Clock, color: 'text-stone-400', bgColor: 'bg-stone-900/50', borderColor: 'border-stone-800/50' },
    pending: { icon: Loader2, color: 'text-blue-400', bgColor: 'bg-blue-950/30', borderColor: 'border-blue-800/30' },
    running: { icon: Loader2, color: 'text-blue-400', bgColor: 'bg-blue-950/30', borderColor: 'border-blue-800/30' },
    success: { icon: CheckCircle, color: 'text-green-400', bgColor: 'bg-green-950/30', borderColor: 'border-green-800/30' },
    error: { icon: XCircle, color: 'text-red-400', bgColor: 'bg-red-950/30', borderColor: 'border-red-800/30' },
  };

  const config = statusConfig[state.status];
  const Icon = config.icon;
  const isActive = state.status === 'pending' || state.status === 'running';

  if (compact) {
    return (
      <div className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-xs ${config.bgColor} border ${config.borderColor}`}>
        <Icon size={12} className={`${config.color} ${isActive ? 'animate-spin' : ''}`} />
        <span className={config.color}>{state.message}</span>
        {isActive && <span className="text-stone-500">{formatElapsed(state.elapsed)}</span>}
        {state.cost > 0 && <span className="text-amber-400">${state.cost.toFixed(2)}</span>}
        {isActive && onCancel && (
          <button onClick={onCancel} className="ml-auto text-stone-500 hover:text-stone-300"><X size={12} /></button>
        )}
      </div>
    );
  }

  return (
    <div className={`rounded-lg border ${config.borderColor} ${config.bgColor} overflow-hidden`}>
      <div className="px-4 py-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Icon size={16} className={`${config.color} ${isActive ? 'animate-spin' : ''}`} />
            <span className={`text-sm font-medium ${config.color}`}>{state.message}</span>
          </div>
          <div className="flex items-center gap-3">
            {isActive && (
              <div className="flex items-center gap-2 text-xs text-stone-500">
                <Clock size={11} />
                <span>{formatElapsed(state.elapsed)}</span>
              </div>
            )}
            {state.cost > 0 && (
              <div className="flex items-center gap-1 text-xs text-amber-400">
                <DollarSign size={11} />
                <span>${state.cost.toFixed(2)}</span>
              </div>
            )}
            {isActive && onCancel && (
              <button onClick={onCancel} className="text-xs text-stone-500 hover:text-stone-300 px-2 py-1 rounded hover:bg-stone-800/50">Cancel</button>
            )}
            {state.status === 'error' && onRetry && (
              <button onClick={onRetry} className="text-xs text-blue-400 hover:text-blue-300 px-2 py-1 rounded hover:bg-stone-800/50">Retry</button>
            )}
            {!isActive && onDismiss && (
              <button onClick={onDismiss} className="text-stone-500 hover:text-stone-300"><X size={14} /></button>
            )}
          </div>
        </div>

        {/* Progress bar */}
        {isActive && (
          <div className="mt-2 h-1 bg-stone-800 rounded-full overflow-hidden">
            {state.progress != null ? (
              <div className="h-full bg-blue-500 rounded-full transition-all duration-300" style={{ width: `${state.progress}%` }} />
            ) : (
              <div className="h-full bg-blue-500/50 rounded-full animate-pulse w-full" />
            )}
          </div>
        )}

        {/* Detail text */}
        {state.detail && (
          <p className="mt-2 text-xs text-stone-500">{state.detail}</p>
        )}

        {/* Error details */}
        {state.error && (
          <div className="mt-2">
            <button onClick={() => setExpanded(!expanded)} className="flex items-center gap-1 text-xs text-stone-500 hover:text-stone-400">
              {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
              Error details
            </button>
            {expanded && (
              <pre className="mt-1 text-xs text-red-400/80 bg-red-950/20 rounded p-2 overflow-x-auto whitespace-pre-wrap">{state.error}</pre>
            )}
          </div>
        )}

        {/* Action links */}
        {!isActive && actions && actions.length > 0 && (
          <div className="mt-3 flex items-center gap-2">
            {actions.map((action) => (
              action.href ? (
                <a key={action.label} href={action.href} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-400 hover:text-blue-300 px-2 py-1 rounded hover:bg-stone-800/50">{action.label}</a>
              ) : (
                <button key={action.label} onClick={action.onClick} className="text-xs text-blue-400 hover:text-blue-300 px-2 py-1 rounded hover:bg-stone-800/50">{action.label}</button>
              )
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
