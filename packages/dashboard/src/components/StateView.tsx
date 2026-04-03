import { Loader2, AlertCircle, Inbox, CheckCircle, RefreshCw, Copy, Check } from 'lucide-react';
import { useState } from 'react';

type ViewStatus = 'loading' | 'error' | 'empty' | 'success';

interface StateViewAction {
  label: string;
  onClick: () => void;
  variant?: 'primary' | 'secondary';
}

interface StateViewProps {
  status: ViewStatus;
  title?: string;
  message?: string;
  detail?: string;
  timestamp?: number;
  actions?: StateViewAction[];
  onRetry?: () => void;
  compact?: boolean;
  children?: React.ReactNode;
}

function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return `${Math.floor(diff / 86400000)}d ago`;
}

export function StateView({ status, title, message, detail, timestamp, actions, onRetry, compact, children }: StateViewProps) {
  const [copied, setCopied] = useState(false);

  const copyError = () => {
    if (detail) {
      navigator.clipboard.writeText(detail);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  if (compact) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-stone-900/40 border border-stone-800/40">
        {status === 'loading' && <Loader2 size={14} className="text-blue-400 animate-spin" />}
        {status === 'error' && <AlertCircle size={14} className="text-red-400" />}
        {status === 'empty' && <Inbox size={14} className="text-stone-500" />}
        {status === 'success' && <CheckCircle size={14} className="text-green-400" />}
        <span className="text-xs text-stone-400">{message || title}</span>
        {timestamp && <span className="text-[10px] text-stone-600 ml-auto">{timeAgo(timestamp)}</span>}
        {onRetry && status === 'error' && (
          <button onClick={onRetry} className="text-stone-500 hover:text-stone-400 ml-1"><RefreshCw size={12} /></button>
        )}
      </div>
    );
  }

  return (
    <div className="flex-1 flex items-center justify-center p-8">
      <div className="text-center max-w-sm">
        {status === 'loading' && (
          <>
            <Loader2 size={32} className="text-blue-400 animate-spin mx-auto mb-3" />
            <h3 className="text-sm font-medium text-stone-300 mb-1">{title || 'Loading...'}</h3>
            {message && <p className="text-xs text-stone-500">{message}</p>}
          </>
        )}

        {status === 'error' && (
          <>
            <AlertCircle size={32} className="text-red-400 mx-auto mb-3" />
            <h3 className="text-sm font-medium text-red-400 mb-1">{title || 'Something went wrong'}</h3>
            {message && <p className="text-xs text-stone-400 mb-2">{message}</p>}
            {detail && (
              <div className="mt-2 mb-3 text-left">
                <pre className="text-[10px] text-red-400/70 bg-red-950/20 rounded-md p-2 overflow-x-auto whitespace-pre-wrap max-h-32">{detail}</pre>
                <button onClick={copyError} className="mt-1 flex items-center gap-1 text-[10px] text-stone-500 hover:text-stone-400">
                  {copied ? <Check size={10} className="text-green-400" /> : <Copy size={10} />}
                  Copy error
                </button>
              </div>
            )}
            <div className="flex items-center justify-center gap-2 mt-3">
              {onRetry && (
                <button onClick={onRetry} className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-blue-400 hover:text-blue-300 bg-blue-950/30 hover:bg-blue-950/50 border border-blue-800/30 rounded-md transition-colors">
                  <RefreshCw size={12} /> Retry
                </button>
              )}
              {actions?.map(a => (
                <button key={a.label} onClick={a.onClick} className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                  a.variant === 'primary'
                    ? 'text-stone-200 bg-stone-800 hover:bg-stone-700'
                    : 'text-stone-400 hover:text-stone-300 hover:bg-stone-800/50'
                }`}>
                  {a.label}
                </button>
              ))}
            </div>
          </>
        )}

        {status === 'empty' && (
          <>
            <Inbox size={32} className="text-stone-600 mx-auto mb-3" />
            <h3 className="text-sm font-medium text-stone-400 mb-1">{title || 'No data yet'}</h3>
            {message && <p className="text-xs text-stone-500 mb-3">{message}</p>}
            {children}
            {actions && actions.length > 0 && (
              <div className="flex items-center justify-center gap-2 mt-3">
                {actions.map(a => (
                  <button key={a.label} onClick={a.onClick} className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                    a.variant === 'primary'
                      ? 'text-stone-200 bg-stone-800 hover:bg-stone-700 border border-stone-700'
                      : 'text-stone-400 hover:text-stone-300 hover:bg-stone-800/50'
                  }`}>
                    {a.label}
                  </button>
                ))}
              </div>
            )}
          </>
        )}

        {status === 'success' && (
          <>
            <CheckCircle size={32} className="text-green-400 mx-auto mb-3" />
            <h3 className="text-sm font-medium text-green-400 mb-1">{title || 'Complete'}</h3>
            {message && <p className="text-xs text-stone-400">{message}</p>}
            {timestamp && <p className="text-[10px] text-stone-600 mt-1">Checked {timeAgo(timestamp)}</p>}
            {children}
            {actions && actions.length > 0 && (
              <div className="flex items-center justify-center gap-2 mt-3">
                {actions.map(a => (
                  <button key={a.label} onClick={a.onClick} className="px-3 py-1.5 text-xs font-medium text-stone-400 hover:text-stone-300 hover:bg-stone-800/50 rounded-md transition-colors">
                    {a.label}
                  </button>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
