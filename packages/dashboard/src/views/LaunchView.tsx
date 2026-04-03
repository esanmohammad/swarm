import { useState } from 'react';
import { Play, ChevronDown, ChevronUp, Wrench, Search, FileSearch, Shuffle, Sparkles } from 'lucide-react';
import type { WsCommand, HistoryEntry, StageName } from '../types';

const COST_ESTIMATES: Record<string, { low: number; high: number }> = {
  opus:   { low: 2,   high: 4 },
  sonnet: { low: 0.5, high: 1.5 },
  haiku:  { low: 0.1, high: 0.3 },
};

function estimateCost(model: string, isLean = false): string {
  if (isLean) {
    const haikuRates = COST_ESTIMATES['haiku'];
    const engineerRates = COST_ESTIMATES[model] ?? { low: 1, high: 3 };
    // 4 haiku stages + 2 engineer stages
    const low = haikuRates.low * 4 + engineerRates.low * 2;
    const high = haikuRates.high * 4 + engineerRates.high * 2;
    return `$${low.toFixed(2)}–$${high.toFixed(2)}`;
  }
  const rates = COST_ESTIMATES[model] ?? { low: 1, high: 3 };
  const stages = 6;
  return `$${(rates.low * stages).toFixed(2)}–$${(rates.high * stages).toFixed(2)}`;
}

const STATUS_DOT: Record<string, string> = {
  done: 'bg-green-500',
  error: 'bg-red-500',
  skipped: 'bg-stone-600',
  pending: 'bg-stone-700',
};

const STAGE_ORDER: StageName[] = ['analyze', 'architect', 'plan', 'build', 'test', 'evaluate'];

interface LaunchViewProps {
  sendCommand: (cmd: WsCommand) => void;
  historyEntries: HistoryEntry[];
  onNavigate: (view: 'results' | 'history') => void;
}

export function LaunchView({ sendCommand, historyEntries, onNavigate }: LaunchViewProps) {
  const [prompt, setPrompt] = useState('');
  const [model, setModel] = useState('sonnet');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [figmaUrl, setFigmaUrl] = useState('');
  const [budget, setBudget] = useState('5');
  const [lean, setLean] = useState(false);

  const [activePreset, setActivePreset] = useState<string | null>(null);

  const handleLaunch = () => {
    if (!prompt.trim()) return;
    sendCommand({
      action: 'run-mayday',
      prompt: prompt.trim(),
      model,
      figmaUrl: figmaUrl.trim() || undefined,
      lean: lean || undefined,
    });
    setPrompt('');
  };

  const handlePreset = (preset: string) => {
    if (!prompt.trim()) return;
    setActivePreset(null);
    switch (preset) {
      case 'fix': {
        // Detect "#123" pattern as GitHub issue reference
        const issueMatch = prompt.trim().match(/^#?(\d+)$/);
        if (issueMatch) {
          sendCommand({ action: 'run-fix', issue: issueMatch[1], model });
        } else {
          sendCommand({ action: 'run-fix', prompt: prompt.trim(), model });
        }
        break;
      }
      case 'spike':
        sendCommand({ action: 'run-spike', prompt: prompt.trim(), model: 'haiku' });
        break;
      case 'review':
        sendCommand({ action: 'run-review', model });
        break;
      case 'refactor':
        sendCommand({ action: 'run-refactor', prompt: prompt.trim(), model });
        break;
      case 'simplify':
        sendCommand({ action: 'run-simplify', model: 'haiku' });
        break;
    }
    setPrompt('');
  };

  return (
    <div className="flex-1 flex items-center justify-center p-8">
      <div className="max-w-2xl w-full space-y-8">
        {/* Hero */}
        <div className="text-center space-y-3">
          <h2 className="text-2xl font-semibold text-stone-200">
            What do you want to build?
          </h2>
          <p className="text-sm text-stone-400 max-w-md mx-auto">
            Describe a feature and Swarm will analyze, architect, plan, build, and test it automatically.
          </p>
        </div>

        {/* Input */}
        <div className="space-y-3">
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && prompt.trim()) {
                handleLaunch();
              }
            }}
            placeholder="Add a login page with JWT authentication and refresh tokens..."
            rows={3}
            className="w-full px-4 py-3 bg-stone-900/60 border border-stone-700/50 rounded-lg text-sm text-stone-200 placeholder-stone-500 focus:border-blue-600 focus:outline-none focus:ring-1 focus:ring-blue-600/30 resize-none"
            autoFocus
          />

          {/* Model picker + cost estimate */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              {[
                { id: 'sonnet', hint: 'balanced' },
                { id: 'opus', hint: 'best quality' },
                { id: 'haiku', hint: 'fast & cheap' },
              ].map((m) => (
                <button
                  key={m.id}
                  onClick={() => setModel(m.id)}
                  className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                    model === m.id
                      ? 'bg-blue-600/20 text-blue-300 border border-blue-500/40'
                      : 'text-stone-400 hover:text-stone-300 border border-stone-700/40 hover:border-stone-600/50'
                  }`}
                  title={m.hint}
                >
                  {m.id}
                  {model === m.id && <span className="text-[10px] text-blue-400/60 ml-1">{m.hint}</span>}
                </button>
              ))}
              <button
                onClick={() => setLean(!lean)}
                className={`px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors border ${
                  lean
                    ? 'bg-green-600/15 text-green-300 border-green-500/40'
                    : 'text-stone-400 border-stone-700/40 hover:text-stone-300 hover:border-stone-600/50'
                }`}
                title="Lean mode: haiku for docs stages, save ~70% cost"
              >
                lean
              </button>
              <span className="text-xs text-stone-500 ml-2">
                Est. ~{estimateCost(model, lean)}
              </span>
            </div>

            <button
              onClick={() => setShowAdvanced(!showAdvanced)}
              className="flex items-center gap-1 text-xs text-stone-500 hover:text-stone-400 transition-colors"
            >
              Advanced
              {showAdvanced ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
            </button>
          </div>

          {/* Advanced options */}
          {showAdvanced && (
            <div className="space-y-3 p-3 rounded-lg bg-stone-900/40 border border-stone-800/40">
              <div>
                <label className="text-xs text-stone-500 block mb-1">Budget (USD)</label>
                <div className="flex items-center gap-2">
                  <input
                    type="range"
                    min="1"
                    max="50"
                    value={budget === 'none' ? 50 : parseInt(budget) || 5}
                    onChange={(e) => setBudget(e.target.value === '50' ? 'none' : e.target.value)}
                    className="flex-1 accent-blue-500"
                  />
                  <span className="text-xs text-stone-300 font-mono w-12 text-right">
                    {budget === 'none' ? 'none' : `$${budget}`}
                  </span>
                </div>
                <p className="text-[10px] text-stone-500 mt-1">Pipeline stops if budget is reached. No surprise charges.</p>
              </div>
              <div>
                <label className="text-xs text-stone-500 block mb-1">Figma URL (optional)</label>
                <input
                  type="text"
                  value={figmaUrl}
                  onChange={(e) => setFigmaUrl(e.target.value)}
                  placeholder="figma.com/design/..."
                  className="w-full px-3 py-1.5 bg-transparent border border-stone-700/40 rounded text-xs text-stone-300 placeholder-stone-500 focus:border-blue-600 focus:outline-none"
                />
              </div>
            </div>
          )}

          {/* Launch button */}
          <button
            onClick={handleLaunch}
            disabled={!prompt.trim()}
            className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-lg text-sm font-semibold text-white bg-blue-600 hover:bg-blue-500 disabled:bg-stone-800 disabled:text-stone-500 transition-colors"
          >
            <Play size={16} />
            Build it
          </button>

          {/* Quick actions — preset workflows */}
          <div className="flex items-center gap-2 pt-1">
            <span className="text-[10px] text-stone-500 uppercase tracking-wider shrink-0">or</span>
            <div className="flex flex-wrap gap-1.5">
              {[
                { id: 'fix', label: 'Fix bug', icon: Wrench, hint: 'Direct engineer fix', needsPrompt: true },
                { id: 'spike', label: 'Spike', icon: Search, hint: 'Quick investigation', needsPrompt: true },
                { id: 'review', label: 'Review', icon: FileSearch, hint: 'Review git changes', needsPrompt: false },
                { id: 'refactor', label: 'Refactor', icon: Shuffle, hint: 'Analyze + restructure', needsPrompt: true },
                { id: 'simplify', label: 'Simplify', icon: Sparkles, hint: 'Clean up changes', needsPrompt: false },
              ].map((p) => (
                <button
                  key={p.id}
                  onClick={() => {
                    if (p.needsPrompt && !prompt.trim()) {
                      setActivePreset(p.id);
                      return;
                    }
                    handlePreset(p.id);
                  }}
                  disabled={p.needsPrompt && !prompt.trim() && activePreset !== p.id}
                  className={`flex items-center gap-1 px-2.5 py-1.5 rounded-md text-[11px] font-medium transition-colors border ${
                    activePreset === p.id
                      ? 'bg-amber-600/15 text-amber-300 border-amber-500/40'
                      : p.needsPrompt && !prompt.trim()
                        ? 'text-stone-600 border-stone-800/40 cursor-not-allowed'
                        : 'text-stone-400 border-stone-700/40 hover:text-stone-300 hover:border-stone-600/50'
                  }`}
                  title={p.hint + (p.needsPrompt ? ' (describe in box above)' : '')}
                >
                  <p.icon size={11} />
                  {p.label}
                </button>
              ))}
            </div>
          </div>
          {activePreset && (
            <p className="text-[10px] text-amber-400/70">
              Describe what to {activePreset} in the text box above, then click the button again.
            </p>
          )}
        </div>

        {/* Recent runs */}
        {historyEntries.length > 0 && (
          <div className="space-y-3 pt-4 border-t border-stone-800/40">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-medium text-stone-400 uppercase tracking-wider">Recent runs</h3>
              <button
                onClick={() => onNavigate('history')}
                className="text-xs text-stone-500 hover:text-stone-400 transition-colors"
              >
                View all
              </button>
            </div>
            <div className="space-y-2">
              {historyEntries.slice(0, 5).map((entry) => {
                const hasError = Object.values(entry.stagesSummary).some((s) => s === 'error');
                const allDone = Object.values(entry.stagesSummary).every((s) => s === 'done' || s === 'skipped');
                return (
                  <div
                    key={entry.runId}
                    className="flex items-center gap-3 px-3 py-2 rounded-lg bg-stone-900/30 border border-stone-800/30 hover:border-stone-700/40 transition-colors cursor-pointer"
                    onClick={() => onNavigate('results')}
                  >
                    <div className={`w-2 h-2 rounded-full ${hasError ? 'bg-red-500' : allDone ? 'bg-green-500' : 'bg-stone-600'}`} />
                    <span className="text-xs text-stone-300 truncate flex-1">
                      {entry.featureRequest || entry.projectName}
                    </span>
                    <div className="flex items-center gap-1">
                      {STAGE_ORDER.filter(s => s !== 'evaluate').map((stage) => (
                        <span
                          key={stage}
                          className={`w-1.5 h-1.5 rounded-full ${STATUS_DOT[entry.stagesSummary[stage]] ?? STATUS_DOT.pending}`}
                          title={`${stage}: ${entry.stagesSummary[stage]}`}
                        />
                      ))}
                    </div>
                    <span className="text-[10px] text-stone-500 font-mono tabular-nums">
                      ${entry.totalCost.totalUsd.toFixed(2)}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
