import { useState, useEffect } from 'react';
import { BookOpen, RefreshCw, Save, Eye } from 'lucide-react';
import type { WsCommand } from '../types';

interface ConventionsViewProps {
  sendCommand: (cmd: WsCommand) => void;
  conventions: string | null;
  conventionsLoading: boolean;
}

export function ConventionsView({ sendCommand, conventions, conventionsLoading }: ConventionsViewProps) {
  const [editing, setEditing] = useState(false);
  const [editContent, setEditContent] = useState('');

  useEffect(() => {
    // Request conventions on mount
    sendCommand({ action: 'get-conventions' } as WsCommand);
  }, []);

  useEffect(() => {
    if (conventions !== null) {
      setEditContent(conventions);
    }
  }, [conventions]);

  const handleLearn = () => {
    sendCommand({ action: 'run-learn', refresh: true } as WsCommand);
  };

  const handleSave = () => {
    sendCommand({ action: 'save-conventions', content: editContent } as WsCommand);
    setEditing(false);
  };

  return (
    <div className="flex-1 flex flex-col p-6 overflow-hidden">
      <div className="max-w-4xl w-full mx-auto flex flex-col flex-1 min-h-0">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <BookOpen size={18} className="text-blue-400" />
            <h2 className="text-lg font-semibold text-stone-200">Project Conventions</h2>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleLearn}
              disabled={conventionsLoading}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium text-stone-300 bg-stone-800/60 hover:bg-stone-700/60 border border-stone-700/40 transition-colors disabled:opacity-50"
            >
              <RefreshCw size={12} className={conventionsLoading ? 'animate-spin' : ''} />
              {conventionsLoading ? 'Scanning...' : conventions ? 'Re-scan' : 'Scan Codebase'}
            </button>
            {conventions && !editing && (
              <button
                onClick={() => setEditing(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium text-stone-300 bg-stone-800/60 hover:bg-stone-700/60 border border-stone-700/40 transition-colors"
              >
                Edit
              </button>
            )}
            {editing && (
              <>
                <button
                  onClick={() => { setEditing(false); setEditContent(conventions || ''); }}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium text-stone-400 hover:text-stone-300 border border-stone-700/40 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSave}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium text-blue-300 bg-blue-600/20 hover:bg-blue-600/30 border border-blue-500/40 transition-colors"
                >
                  <Save size={12} />
                  Save
                </button>
              </>
            )}
          </div>
        </div>

        <p className="text-xs text-stone-500 mb-4">
          Conventions are automatically injected into all pipeline agents as system context.
          {!conventions && ' Click "Scan Codebase" to extract patterns from your project.'}
        </p>

        {/* Content */}
        <div className="flex-1 min-h-0 overflow-auto rounded-lg border border-stone-800/50 bg-stone-900/40">
          {conventions === null && !conventionsLoading ? (
            <div className="flex flex-col items-center justify-center h-full py-16 text-center">
              <BookOpen size={36} className="text-stone-600 mb-3" />
              <p className="text-sm text-stone-400 mb-1">No conventions detected yet</p>
              <p className="text-xs text-stone-500 mb-4 max-w-md">
                Run <code className="text-stone-400 bg-stone-800/60 px-1.5 py-0.5 rounded">swarm learn</code> or
                click "Scan Codebase" to analyze your project's patterns.
              </p>
              <button
                onClick={handleLearn}
                className="flex items-center gap-1.5 px-4 py-2 rounded-md text-xs font-medium text-white bg-blue-600 hover:bg-blue-500 transition-colors"
              >
                <Eye size={12} />
                Scan Codebase
              </button>
            </div>
          ) : conventionsLoading ? (
            <div className="flex items-center justify-center h-full py-16">
              <RefreshCw size={20} className="text-stone-500 animate-spin mr-2" />
              <span className="text-sm text-stone-400">Scanning codebase for conventions...</span>
            </div>
          ) : editing ? (
            <textarea
              value={editContent}
              onChange={(e) => setEditContent(e.target.value)}
              className="w-full h-full p-4 bg-transparent text-xs text-stone-300 font-mono resize-none focus:outline-none"
              spellCheck={false}
            />
          ) : (
            <pre className="p-4 text-xs text-stone-300 font-mono whitespace-pre-wrap">
              {conventions}
            </pre>
          )}
        </div>
      </div>
    </div>
  );
}
