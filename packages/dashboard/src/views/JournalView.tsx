import { useState, useEffect } from 'react';
import {
  BookOpen,
  CheckCircle,
  XCircle,
  Clock,
  Brain,
  BarChart3,
  ToggleLeft,
  ToggleRight,
  Filter,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import { FeatureGuide } from '../components/FeatureGuide';
import { StateView } from '../components/StateView';
import type { WsCommand } from '../types';

interface JournalData {
  decisions: Array<{
    id: string;
    timestamp: number;
    type: string;
    context: string;
    decision: string;
    reasoning: string;
    confidence: number;
    alternatives?: string[];
    outcome?: string;
    outcomeDetail?: string;
  }>;
  rules: Array<{
    id: string;
    rule: string;
    enabled: boolean;
    appliesTo: string[];
  }>;
  calibration?: {
    totalDecisions: number;
    accuracyByType: Array<{ type: string; accuracy: number; total: number }>;
    recommendations: string[];
  };
}

interface JournalViewProps {
  sendCommand: (cmd: WsCommand) => void;
  journalData: JournalData | null;
}

const DECISION_TYPES = [
  'auto-merge',
  'confidence-gate',
  'review-verdict',
  'fix-approach',
  'skip-item',
  'model-choice',
  'scope-decision',
  'retry-decision',
];

const OUTCOME_OPTIONS = ['success', 'failure', 'pending'] as const;

function OutcomeIcon({ outcome }: { outcome?: string }) {
  if (outcome === 'success') return <CheckCircle size={14} className="text-emerald-400" />;
  if (outcome === 'failure') return <XCircle size={14} className="text-red-400" />;
  return <Clock size={14} className="text-stone-500" />;
}

function ConfidenceMeter({ confidence }: { confidence: number }) {
  const pct = Math.round(confidence * 100);
  const color = confidence >= 0.8 ? 'bg-emerald-500' : confidence >= 0.6 ? 'bg-amber-500' : 'bg-red-500';
  return (
    <div className="flex items-center gap-1.5">
      <div className="w-16 h-1.5 bg-stone-700 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-[10px] text-stone-400 w-7 text-right">{pct}%</span>
    </div>
  );
}

export function JournalView({ sendCommand, journalData }: JournalViewProps) {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [outcomeFilter, setOutcomeFilter] = useState<string>('all');
  const [showFilters, setShowFilters] = useState(false);
  const [activeTab, setActiveTab] = useState<'decisions' | 'accuracy' | 'rules'>('decisions');

  useEffect(() => {
    sendCommand({ action: 'get-journal' } as WsCommand);
  }, []);

  const toggleExpand = (id: string) => {
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  if (!journalData) {
    return (
      <div className="flex-1 flex flex-col p-6 overflow-auto">
        <div className="max-w-5xl w-full mx-auto space-y-6">
          <div className="flex items-center gap-2">
            <BookOpen size={18} className="text-violet-400" />
            <h2 className="text-lg font-semibold text-stone-200">Decision Journal</h2>
            <FeatureGuide
              featureId="journal"
              title="Decision Journal"
              description="Track architectural decisions, their rationale, and outcomes over time. Helps teams understand why things were built a certain way."
              cliCommands={[
                { command: 'swarm journal', description: 'View the decision journal' },
                { command: 'swarm journal add', description: 'Record a new decision' },
              ]}
              hasData={false}
            />
          </div>
          <StateView
            status="empty"
            title="No decisions recorded yet"
            message="Add decisions to track architectural choices, their rationale, and outcomes over time."
            actions={[
              { label: 'Analyze', onClick: () => sendCommand({ action: 'run-journal-analyze' } as WsCommand), variant: 'primary' },
            ]}
          />
        </div>
      </div>
    );
  }

  const { decisions, rules, calibration } = journalData;

  // Apply filters
  const filtered = decisions.filter(d => {
    if (typeFilter !== 'all' && d.type !== typeFilter) return false;
    if (outcomeFilter !== 'all') {
      if (outcomeFilter === 'pending' && d.outcome && d.outcome !== 'pending') return false;
      if (outcomeFilter !== 'pending' && d.outcome !== outcomeFilter) return false;
    }
    return true;
  });

  return (
    <div className="flex-1 flex flex-col p-6 overflow-auto">
      <div className="max-w-5xl w-full mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <BookOpen size={18} className="text-violet-400" />
            <h2 className="text-lg font-semibold text-stone-200">Decision Journal</h2>
            <span className="text-xs text-stone-500 ml-2">{decisions.length} decisions</span>
            <FeatureGuide
              featureId="journal"
              title="Decision Journal"
              description="Track architectural decisions, their rationale, and outcomes over time. Helps teams understand why things were built a certain way."
              cliCommands={[
                { command: 'swarm journal', description: 'View the decision journal' },
                { command: 'swarm journal add', description: 'Record a new decision' },
              ]}
              hasData={true}
            />
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => sendCommand({ action: 'run-journal-analyze' } as WsCommand)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium bg-violet-600/20 text-violet-300 border border-violet-500/30 hover:bg-violet-600/30 transition-colors"
            >
              <Brain size={12} />
              Analyze
            </button>
            <button
              onClick={() => sendCommand({ action: 'run-journal-calibrate' } as WsCommand)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium bg-amber-600/20 text-amber-300 border border-amber-500/30 hover:bg-amber-600/30 transition-colors"
            >
              <BarChart3 size={12} />
              Calibrate
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-1 border-b border-stone-700/50 pb-0">
          {(['decisions', 'accuracy', 'rules'] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-3 py-2 text-xs font-medium border-b-2 transition-colors ${
                activeTab === tab
                  ? 'text-violet-300 border-violet-400'
                  : 'text-stone-500 border-transparent hover:text-stone-300'
              }`}
            >
              {tab === 'decisions' ? 'Decisions' : tab === 'accuracy' ? 'Accuracy' : 'Rules'}
            </button>
          ))}
        </div>

        {/* Decisions Tab */}
        {activeTab === 'decisions' && (
          <div className="space-y-3">
            {/* Filters */}
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowFilters(!showFilters)}
                className="flex items-center gap-1 text-xs text-stone-400 hover:text-stone-300 transition-colors"
              >
                <Filter size={12} />
                Filters
                {showFilters ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
              </button>
              {(typeFilter !== 'all' || outcomeFilter !== 'all') && (
                <button
                  onClick={() => { setTypeFilter('all'); setOutcomeFilter('all'); }}
                  className="text-[10px] text-stone-500 hover:text-stone-400"
                >
                  Clear filters
                </button>
              )}
            </div>

            {showFilters && (
              <div className="flex items-center gap-4 p-3 bg-stone-800/50 rounded-lg border border-stone-700/40">
                <div>
                  <label className="text-[10px] text-stone-500 uppercase tracking-wider block mb-1">Type</label>
                  <select
                    value={typeFilter}
                    onChange={e => setTypeFilter(e.target.value)}
                    className="bg-stone-900 border border-stone-700 rounded px-2 py-1 text-xs text-stone-300"
                  >
                    <option value="all">All types</option>
                    {DECISION_TYPES.map(t => (
                      <option key={t} value={t}>{t}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-[10px] text-stone-500 uppercase tracking-wider block mb-1">Outcome</label>
                  <select
                    value={outcomeFilter}
                    onChange={e => setOutcomeFilter(e.target.value)}
                    className="bg-stone-900 border border-stone-700 rounded px-2 py-1 text-xs text-stone-300"
                  >
                    <option value="all">All outcomes</option>
                    {OUTCOME_OPTIONS.map(o => (
                      <option key={o} value={o}>{o}</option>
                    ))}
                  </select>
                </div>
              </div>
            )}

            {/* Decision list */}
            {filtered.length === 0 ? (
              <div className="text-center py-8">
                <BookOpen size={28} className="text-stone-700 mx-auto mb-2" />
                <p className="text-xs text-stone-500">No decisions match the current filters.</p>
              </div>
            ) : (
              filtered.map(d => {
                const expanded = expandedIds.has(d.id);
                return (
                  <div
                    key={d.id}
                    className="bg-stone-800/40 rounded-lg border border-stone-700/40 overflow-hidden"
                  >
                    <button
                      onClick={() => toggleExpand(d.id)}
                      className="w-full flex items-center gap-3 p-3 text-left hover:bg-stone-800/60 transition-colors"
                    >
                      <OutcomeIcon outcome={d.outcome} />
                      {expanded ? <ChevronDown size={12} className="text-stone-500" /> : <ChevronRight size={12} className="text-stone-500" />}
                      <span className="text-[10px] text-stone-500 w-24 shrink-0">
                        {new Date(d.timestamp).toLocaleString()}
                      </span>
                      <span className="text-[10px] font-medium text-violet-400 w-28 shrink-0">
                        {d.type}
                      </span>
                      <span className="text-xs text-stone-300 flex-1 truncate">
                        {d.decision}
                      </span>
                      <ConfidenceMeter confidence={d.confidence} />
                    </button>

                    {expanded && (
                      <div className="px-4 pb-3 space-y-2 border-t border-stone-700/30">
                        <div className="pt-2">
                          <p className="text-[10px] text-stone-500 uppercase tracking-wider mb-1">Context</p>
                          <p className="text-xs text-stone-400">{d.context}</p>
                        </div>
                        <div>
                          <p className="text-[10px] text-stone-500 uppercase tracking-wider mb-1">Reasoning</p>
                          <p className="text-xs text-stone-400">{d.reasoning}</p>
                        </div>
                        {d.alternatives && d.alternatives.length > 0 && (
                          <div>
                            <p className="text-[10px] text-stone-500 uppercase tracking-wider mb-1">Alternatives Considered</p>
                            <ul className="space-y-0.5">
                              {d.alternatives.map((alt, i) => (
                                <li key={i} className="text-xs text-stone-500 flex items-center gap-1.5">
                                  <span className="w-1 h-1 rounded-full bg-stone-600" />
                                  {alt}
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                        {d.outcomeDetail && (
                          <div>
                            <p className="text-[10px] text-stone-500 uppercase tracking-wider mb-1">Outcome Detail</p>
                            <p className="text-xs text-stone-400">{d.outcomeDetail}</p>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        )}

        {/* Accuracy Tab */}
        {activeTab === 'accuracy' && (
          <div className="space-y-4">
            {calibration && calibration.accuracyByType.length > 0 ? (
              <>
                <div className="bg-stone-800/40 rounded-lg border border-stone-700/40 p-4">
                  <h3 className="text-xs font-medium text-stone-300 mb-3 flex items-center gap-1.5">
                    <BarChart3 size={14} className="text-amber-400" />
                    Accuracy by Decision Type
                  </h3>
                  <div className="space-y-2.5">
                    {calibration.accuracyByType.map(entry => {
                      const pct = Math.round(entry.accuracy * 100);
                      const barColor = entry.accuracy >= 0.8
                        ? 'bg-emerald-500'
                        : entry.accuracy >= 0.6
                          ? 'bg-amber-500'
                          : 'bg-red-500';
                      return (
                        <div key={entry.type} className="flex items-center gap-3">
                          <span className="text-xs text-stone-400 w-32 shrink-0">{entry.type}</span>
                          <div className="flex-1 h-4 bg-stone-700/50 rounded overflow-hidden">
                            <div
                              className={`h-full ${barColor} rounded transition-all`}
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                          <span className="text-xs text-stone-400 w-16 text-right">
                            {pct}% <span className="text-stone-600">({entry.total})</span>
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {calibration.recommendations.length > 0 && (
                  <div className="bg-stone-800/40 rounded-lg border border-stone-700/40 p-4">
                    <h3 className="text-xs font-medium text-stone-300 mb-2">Recommendations</h3>
                    <ul className="space-y-1.5">
                      {calibration.recommendations.map((r, i) => (
                        <li key={i} className="text-xs text-stone-400 flex items-start gap-2">
                          <span className="text-amber-400 mt-0.5 shrink-0">&#8594;</span>
                          {r}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </>
            ) : (
              <div className="text-center py-12">
                <BarChart3 size={28} className="text-stone-700 mx-auto mb-2" />
                <p className="text-xs text-stone-500">No calibration data yet.</p>
                <p className="text-xs text-stone-600 mt-1">Click "Calibrate" to generate accuracy analysis.</p>
              </div>
            )}
          </div>
        )}

        {/* Rules Tab */}
        {activeTab === 'rules' && (
          <div className="space-y-3">
            {rules.length === 0 ? (
              <div className="text-center py-12">
                <Brain size={28} className="text-stone-700 mx-auto mb-2" />
                <p className="text-xs text-stone-500">No rules generated yet.</p>
                <p className="text-xs text-stone-600 mt-1">Click "Analyze" to generate rules from decision outcomes.</p>
              </div>
            ) : (
              rules.map(rule => (
                <div
                  key={rule.id}
                  className="bg-stone-800/40 rounded-lg border border-stone-700/40 p-3 flex items-start gap-3"
                >
                  <button
                    onClick={() =>
                      sendCommand({
                        action: 'run-journal-analyze',
                      } as WsCommand)
                    }
                    className="mt-0.5 shrink-0"
                  >
                    {rule.enabled ? (
                      <ToggleRight size={18} className="text-emerald-400" />
                    ) : (
                      <ToggleLeft size={18} className="text-stone-600" />
                    )}
                  </button>
                  <div className="flex-1 min-w-0">
                    <p className={`text-xs ${rule.enabled ? 'text-stone-300' : 'text-stone-500'}`}>
                      {rule.rule}
                    </p>
                    <div className="flex items-center gap-2 mt-1">
                      {rule.appliesTo.map(t => (
                        <span
                          key={t}
                          className="text-[10px] px-1.5 py-0.5 rounded bg-stone-700/50 text-stone-500"
                        >
                          {t}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}
