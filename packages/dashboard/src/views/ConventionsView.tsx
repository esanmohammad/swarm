import { useState, useEffect } from 'react';
import { BookOpen, RefreshCw, Save } from 'lucide-react';
import type { WsCommand } from '../types';
import { FeatureGuide } from '../components/FeatureGuide';
import { StateView } from '../components/StateView';

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

        <FeatureGuide
          featureId="conventions"
          title="Conventions"
          description="Swarm learns your project's coding patterns, naming conventions, and style rules by analyzing your codebase. These conventions are then applied when generating code."
          hasData={conventions !== null}
          setupSteps={[
            { label: 'Run swarm learn to scan your codebase', command: 'swarm learn' },
          ]}
          cliCommands={[
            { command: 'swarm learn', description: 'Scan codebase for conventions' },
            { command: 'swarm learn --stack node', description: 'Scan with a specific stack context' },
          ]}
        />

        <p className="text-xs text-stone-500 mb-4">
          Conventions are automatically injected into all pipeline agents as system context.
          {!conventions && ' Click "Scan Codebase" to extract patterns from your project.'}
        </p>

        {/* Content */}
        <div className="flex-1 min-h-0 overflow-auto rounded-lg border border-stone-800/50 bg-stone-900/40">
          {conventions === null && !conventionsLoading ? (
            <StateView
              status="empty"
              title="No conventions learned"
              message="No conventions learned yet. Run 'swarm learn' to analyze your codebase patterns."
              actions={[
                { label: 'Scan Codebase', onClick: handleLearn, variant: 'primary' },
              ]}
            />
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
