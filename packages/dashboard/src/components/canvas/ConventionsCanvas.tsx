import { useState, useEffect } from 'react';
import { BookOpen, RefreshCw, Save, Scan } from 'lucide-react';
import type { WsCommand } from '../../types';

interface ConventionsCanvasProps {
  conventions: string | null;
  loading: boolean;
  sendCommand: (cmd: WsCommand) => void;
}

export function ConventionsCanvas({ conventions, loading, sendCommand }: ConventionsCanvasProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(conventions || '');

  useEffect(() => {
    if (conventions != null) setDraft(conventions);
  }, [conventions]);

  useEffect(() => {
    sendCommand({ action: 'get-conventions' });
  }, [sendCommand]);

  return (
    <div className="flex flex-col h-full">
      <div
        className="flex items-center justify-between px-4 py-2.5 shrink-0"
        style={{
          backgroundColor: 'var(--bg-surface)',
          borderBottom: '1px solid var(--border-muted)',
        }}
      >
        <div className="flex items-center gap-2">
          <BookOpen size={14} style={{ color: 'var(--text-secondary)' }} />
          <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
            Coding Conventions
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => sendCommand({ action: 'run-learn' })}
            disabled={loading}
            className="flex items-center gap-1 px-2.5 py-1 rounded text-xs font-medium transition-colors disabled:opacity-40"
            style={{
              backgroundColor: 'var(--accent-muted)',
              color: 'var(--accent)',
            }}
            title="Scan codebase to generate conventions"
          >
            <Scan size={11} className={loading ? 'animate-spin' : ''} />
            {loading ? 'Scanning...' : 'Scan'}
          </button>
          <button
            onClick={() => sendCommand({ action: 'get-conventions' })}
            className="p-1.5 rounded transition-colors"
            style={{ color: 'var(--text-tertiary)' }}
            title="Refresh"
          >
            <RefreshCw size={12} />
          </button>
          {editing && (
            <button
              onClick={() => {
                sendCommand({ action: 'save-conventions', content: draft });
                setEditing(false);
              }}
              className="flex items-center gap-1 px-2 py-1 rounded text-xs font-medium transition-colors"
              style={{
                backgroundColor: 'var(--status-success-bg)',
                color: 'var(--status-success)',
              }}
            >
              <Save size={10} />
              Save
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-auto p-4">
        {loading && !conventions ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-center space-y-2">
              <div
                className="w-6 h-6 border-2 rounded-full animate-spin mx-auto"
                style={{ borderColor: 'var(--border-default)', borderTopColor: 'var(--accent)' }}
              />
              <span className="text-sm" style={{ color: 'var(--text-tertiary)' }}>Scanning codebase...</span>
            </div>
          </div>
        ) : !conventions && !editing ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-center space-y-3 max-w-sm">
              <BookOpen size={32} className="mx-auto opacity-20" style={{ color: 'var(--text-tertiary)' }} />
              <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                No conventions found
              </p>
              <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                Click <strong>Scan</strong> to automatically learn your project's patterns and coding style. Hivemind will follow these when writing code.
              </p>
              <button
                onClick={() => sendCommand({ action: 'run-learn' })}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-md text-xs font-medium transition-colors"
                style={{
                  backgroundColor: 'var(--accent-emphasis)',
                  color: '#fff',
                }}
              >
                <Scan size={12} />
                Scan Codebase
              </button>
            </div>
          </div>
        ) : (
          <textarea
            value={draft}
            onChange={(e) => { setDraft(e.target.value); setEditing(true); }}
            className="w-full h-full bg-transparent text-sm font-code resize-none focus:outline-none leading-relaxed"
            style={{ color: 'var(--text-primary)' }}
            placeholder="Write your project conventions here..."
          />
        )}
      </div>
    </div>
  );
}
