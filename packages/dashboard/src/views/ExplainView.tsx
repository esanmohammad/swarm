import { useState, useEffect, useRef } from 'react';
import { HelpCircle, Play, FileText, FolderOpen, MessageCircle, Loader2 } from 'lucide-react';
import type { WsCommand, Agent } from '../types';
import { FeatureGuide } from '../components/FeatureGuide';

interface ExplainViewProps {
  sendCommand: (cmd: WsCommand) => void;
  agents: Agent[];
  agentOutputs: Map<string, string>;
}

export function ExplainView({ sendCommand, agents, agentOutputs }: ExplainViewProps) {
  const [query, setQuery] = useState('');
  const [depth, setDepth] = useState<'shallow' | 'medium' | 'deep'>('medium');
  const [diagram, setDiagram] = useState(false);
  const outputRef = useRef<HTMLDivElement>(null);

  // Find explain agent
  const explainAgent = agents.find(a => a.name.startsWith('explain-'));
  const isRunning = explainAgent?.status === 'running';
  const output = explainAgent ? agentOutputs.get(explainAgent.id) || '' : '';

  // Auto-scroll output
  useEffect(() => {
    if (outputRef.current && isRunning) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [output, isRunning]);

  const handleExplain = (target?: string) => {
    sendCommand({
      action: 'run-explain',
      target: target || query.trim() || undefined,
      depth,
      diagram,
      model: 'haiku',
    } as WsCommand);
  };

  const presets = [
    { label: 'Full Overview', icon: FileText, target: undefined, hint: 'Architecture, patterns, entry points' },
    { label: 'src/', icon: FolderOpen, target: 'src/', hint: 'Main source directory' },
    { label: 'package.json', icon: FileText, target: 'package.json', hint: 'Dependencies and scripts' },
  ];

  return (
    <div className="flex-1 flex flex-col p-6 overflow-hidden">
      <div className="max-w-4xl w-full mx-auto flex flex-col flex-1 min-h-0">
        {/* Header */}
        <div className="flex items-center gap-2 mb-4">
          <HelpCircle size={18} className="text-teal-400" />
          <h2 className="text-lg font-semibold text-stone-200">Explain Codebase</h2>
        </div>

        <FeatureGuide
          featureId="explain"
          title="Explain"
          description="Ask questions about your codebase and get AI-powered answers with file references. Like having a senior developer who knows every file."
          hasData={!!output}
          cliCommands={[
            { command: 'swarm explain "How does auth work?"', description: 'Ask a question about your codebase' },
          ]}
        />

        {/* Query input */}
        <div className="space-y-3 mb-4">
          <div className="flex gap-2">
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (query.trim() || true)) handleExplain();
              }}
              placeholder="Ask a question, enter a file/dir path, or leave empty for full overview..."
              className="flex-1 px-3 py-2 bg-stone-900/60 border border-stone-700/50 rounded-lg text-xs text-stone-200 placeholder-stone-500 focus:border-blue-600 focus:outline-none focus:ring-1 focus:ring-blue-600/30"
            />
            <button
              onClick={() => handleExplain()}
              disabled={isRunning}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-medium text-white bg-blue-600 hover:bg-blue-500 disabled:bg-stone-700 disabled:text-stone-500 transition-colors shrink-0"
            >
              {isRunning ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />}
              {isRunning ? 'Explaining...' : 'Explain'}
            </button>
          </div>

          {/* Options */}
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] text-stone-500">Depth:</span>
              {(['shallow', 'medium', 'deep'] as const).map(d => (
                <button
                  key={d}
                  onClick={() => setDepth(d)}
                  className={`px-2 py-0.5 rounded text-[10px] font-medium border transition-colors ${
                    depth === d
                      ? 'bg-blue-600/20 text-blue-300 border-blue-500/40'
                      : 'text-stone-400 border-stone-700/40 hover:border-stone-600/50'
                  }`}
                >
                  {d}
                </button>
              ))}
            </div>
            <label className="flex items-center gap-1.5 text-[10px] text-stone-400 cursor-pointer">
              <input
                type="checkbox"
                checked={diagram}
                onChange={(e) => setDiagram(e.target.checked)}
                className="rounded border-stone-600 bg-stone-800 text-blue-500"
              />
              Mermaid diagrams
            </label>
          </div>
        </div>

        {/* Output area or presets */}
        {output ? (
          <div
            ref={outputRef}
            className="flex-1 min-h-0 overflow-auto rounded-lg border border-stone-800/50 bg-stone-900/40 p-4"
          >
            {isRunning && (
              <div className="flex items-center gap-2 mb-3 text-xs text-stone-400">
                <Loader2 size={12} className="animate-spin" />
                Analyzing codebase...
              </div>
            )}
            <div className="prose prose-invert prose-sm max-w-none">
              <pre className="whitespace-pre-wrap text-xs text-stone-300 font-mono leading-relaxed">
                {output}
              </pre>
            </div>
            {explainAgent?.status === 'done' && (
              <div className="mt-4 pt-3 border-t border-stone-800/40 text-[10px] text-stone-500">
                Cost: ${explainAgent.cost.totalUsd.toFixed(2)} | Model: {explainAgent.model}
              </div>
            )}
          </div>
        ) : (
          <div className="flex-1 flex flex-col">
            {/* Quick presets */}
            <div className="mb-6">
              <h3 className="text-xs font-medium text-stone-400 uppercase tracking-wider mb-2">Quick Explain</h3>
              <div className="grid grid-cols-3 gap-2">
                {presets.map(p => (
                  <button
                    key={p.label}
                    onClick={() => handleExplain(p.target)}
                    disabled={isRunning}
                    className="flex items-center gap-2 p-3 rounded-lg bg-stone-900/40 border border-stone-800/40 hover:border-stone-700/40 transition-colors text-left disabled:opacity-50"
                  >
                    <p.icon size={14} className="text-stone-400 shrink-0" />
                    <div>
                      <div className="text-xs font-medium text-stone-200">{p.label}</div>
                      <div className="text-[10px] text-stone-500">{p.hint}</div>
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* Example questions */}
            <div>
              <h3 className="text-xs font-medium text-stone-400 uppercase tracking-wider mb-2">Example Questions</h3>
              <div className="space-y-1.5">
                {[
                  'How does authentication work?',
                  'What is the data flow for API requests?',
                  'How are tests organized?',
                  'What are the key design patterns used?',
                ].map(q => (
                  <button
                    key={q}
                    onClick={() => { setQuery(q); handleExplain(q); }}
                    disabled={isRunning}
                    className="flex items-center gap-2 w-full p-2 rounded-lg hover:bg-stone-900/40 transition-colors text-left disabled:opacity-50"
                  >
                    <MessageCircle size={12} className="text-stone-500 shrink-0" />
                    <span className="text-xs text-stone-300">{q}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
