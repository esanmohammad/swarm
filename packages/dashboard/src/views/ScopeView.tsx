import { useState } from 'react';
import {
  Search,
  AlertTriangle,
  HelpCircle,
  CheckCircle,
  Play,
  DollarSign,
  Clock,
  Shield,
  ChevronDown,
} from 'lucide-react';
import { FeatureGuide } from '../components/FeatureGuide';
import { StateView } from '../components/StateView';
import type { WsCommand } from '../types';

interface ScopeAnalysis {
  request: string;
  vaguenessScore: number;
  classification: string;
  riskFactors: string[];
  missingContext: string[];
  questions: string[];
  options: Array<{
    name: string;
    description: string;
    estimatedCost: number;
    estimatedTime: string;
    risk: string;
    tradeoffs: string[];
    recommended: boolean;
  }>;
}

interface ScopeViewProps {
  sendCommand: (cmd: WsCommand) => void;
  scopeAnalysis: ScopeAnalysis | null;
}

function VaguenessMeter({ score }: { score: number }) {
  const color =
    score < 30 ? 'bg-green-500' : score <= 60 ? 'bg-yellow-500' : 'bg-red-500';
  const textColor =
    score < 30 ? 'text-green-400' : score <= 60 ? 'text-yellow-400' : 'text-red-400';
  const label = score < 30 ? 'Clear' : score <= 60 ? 'Somewhat Vague' : 'Very Vague';

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-stone-500 uppercase tracking-wider">Vagueness</span>
        <span className={`text-xs font-medium ${textColor}`}>
          {score}/100 — {label}
        </span>
      </div>
      <div className="w-full h-2 bg-stone-800 rounded-full overflow-hidden">
        <div
          className={`h-full ${color} rounded-full transition-all duration-500`}
          style={{ width: `${score}%` }}
        />
      </div>
    </div>
  );
}

function ClassificationBadge({ classification }: { classification: string }) {
  const styles: Record<string, string> = {
    'clear-small': 'bg-green-500/20 text-green-300 border-green-500/30',
    'clear-large': 'bg-blue-500/20 text-blue-300 border-blue-500/30',
    'ambiguous': 'bg-yellow-500/20 text-yellow-300 border-yellow-500/30',
    'risky': 'bg-red-500/20 text-red-300 border-red-500/30',
  };

  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium border ${
        styles[classification] || 'bg-stone-700 text-stone-300 border-stone-600'
      }`}
    >
      {classification.toUpperCase()}
    </span>
  );
}

function OptionCard({
  option,
  onApprove,
}: {
  option: ScopeAnalysis['options'][number];
  onApprove: () => void;
}) {
  const riskColor =
    option.risk === 'low'
      ? 'text-green-400'
      : option.risk === 'medium'
        ? 'text-yellow-400'
        : 'text-red-400';

  return (
    <div
      className={`flex flex-col p-4 rounded-lg border transition-colors ${
        option.recommended
          ? 'bg-blue-500/5 border-blue-500/30'
          : 'bg-stone-900/40 border-stone-800/40'
      }`}
    >
      <div className="flex items-center gap-2 mb-2">
        <h4 className="text-sm font-semibold text-stone-200">{option.name}</h4>
        {option.recommended && (
          <span className="flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-blue-500/20 text-[9px] font-medium text-blue-300 border border-blue-500/30">
            <CheckCircle size={9} /> RECOMMENDED
          </span>
        )}
      </div>

      <p className="text-[11px] text-stone-400 mb-3">{option.description}</p>

      <div className="grid grid-cols-3 gap-2 mb-3">
        <div className="flex items-center gap-1">
          <DollarSign size={11} className="text-stone-500" />
          <span className="text-xs text-stone-300">${option.estimatedCost.toFixed(2)}</span>
        </div>
        <div className="flex items-center gap-1">
          <Clock size={11} className="text-stone-500" />
          <span className="text-xs text-stone-300">{option.estimatedTime}</span>
        </div>
        <div className="flex items-center gap-1">
          <Shield size={11} className="text-stone-500" />
          <span className={`text-xs ${riskColor}`}>{option.risk}</span>
        </div>
      </div>

      <div className="mb-3 space-y-1">
        {option.tradeoffs.map((t, i) => (
          <div key={i} className="flex items-start gap-1.5">
            <span className="text-stone-600 text-[10px] mt-0.5">•</span>
            <span className="text-[10px] text-stone-500">{t}</span>
          </div>
        ))}
      </div>

      <button
        onClick={onApprove}
        className={`mt-auto flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
          option.recommended
            ? 'bg-blue-600 hover:bg-blue-500 text-white'
            : 'bg-stone-800 hover:bg-stone-700 text-stone-300 border border-stone-700/50'
        }`}
      >
        <Play size={11} />
        Approve & Run Pipeline
      </button>
    </div>
  );
}

export function ScopeView({ sendCommand, scopeAnalysis }: ScopeViewProps) {
  const [request, setRequest] = useState('');
  const [historyOpen, setHistoryOpen] = useState(false);

  const handleAnalyze = () => {
    const trimmed = request.trim();
    if (!trimmed) return;
    sendCommand({ action: 'run-scope', request: trimmed } as WsCommand);
  };

  const handleApprove = (_optionIndex: number) => {
    if (!scopeAnalysis) return;
    sendCommand({
      action: 'run-scope',
      request: scopeAnalysis.request,
    } as WsCommand);
  };

  return (
    <div className="flex-1 flex flex-col p-6 overflow-auto">
      <div className="max-w-5xl w-full mx-auto flex flex-col flex-1 min-h-0">
        {/* Header */}
        <div className="flex items-center gap-2 mb-4">
          <Search size={18} className="text-purple-400" />
          <h2 className="text-lg font-semibold text-stone-200">Scope & Negotiate</h2>
          <FeatureGuide
            featureId="scope"
            title="Scope Analysis"
            description="Analyze feature requests for feasibility, complexity, effort estimation, and risk. Get multiple implementation options ranked by effort."
            cliCommands={[{ command: 'swarm scope "Add SSO support"', description: 'Analyze a feature request' }]}
            hasData={!!scopeAnalysis}
          />
        </div>

        {/* Request input */}
        <div className="flex gap-2 mb-6">
          <input
            type="text"
            value={request}
            onChange={(e) => setRequest(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleAnalyze();
            }}
            placeholder="Describe what you want to build..."
            className="flex-1 px-3 py-2 bg-stone-900/60 border border-stone-700/50 rounded-lg text-xs text-stone-200 placeholder-stone-500 focus:border-purple-600 focus:outline-none focus:ring-1 focus:ring-purple-600/30"
          />
          <button
            onClick={handleAnalyze}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-medium text-white bg-purple-600 hover:bg-purple-500 transition-colors shrink-0"
          >
            <Search size={12} />
            Analyze
          </button>
        </div>

        {/* Empty state */}
        {!scopeAnalysis && (
          <StateView
            status="empty"
            title="No Scope Analysis"
            message="No scope analysis yet. Describe a feature to analyze its complexity and effort."
          />
        )}

        {/* Analysis results */}
        {scopeAnalysis && (
          <div className="space-y-5">
            {/* Vagueness + classification row */}
            <div className="p-4 rounded-lg bg-stone-900/40 border border-stone-800/40 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs text-stone-400">
                  Request: <span className="text-stone-200">{scopeAnalysis.request}</span>
                </span>
                <ClassificationBadge classification={scopeAnalysis.classification} />
              </div>
              <VaguenessMeter score={scopeAnalysis.vaguenessScore} />
            </div>

            {/* Risk factors */}
            {scopeAnalysis.riskFactors.length > 0 && (
              <div className="p-4 rounded-lg bg-red-500/5 border border-red-500/20">
                <div className="flex items-center gap-1.5 mb-2">
                  <AlertTriangle size={14} className="text-red-400" />
                  <h3 className="text-xs font-semibold text-red-300 uppercase tracking-wider">
                    Risk Factors
                  </h3>
                </div>
                <div className="space-y-1.5">
                  {scopeAnalysis.riskFactors.map((factor, i) => (
                    <div key={i} className="flex items-start gap-2">
                      <span className="text-red-500 text-[10px] mt-0.5">•</span>
                      <span className="text-xs text-red-300/80">{factor}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Clarifying questions */}
            {scopeAnalysis.questions.length > 0 && (
              <div className="p-4 rounded-lg bg-stone-900/40 border border-stone-800/40">
                <div className="flex items-center gap-1.5 mb-2">
                  <HelpCircle size={14} className="text-cyan-400" />
                  <h3 className="text-xs font-semibold text-cyan-300 uppercase tracking-wider">
                    Clarifying Questions
                  </h3>
                </div>
                <div className="space-y-1.5">
                  {scopeAnalysis.questions.map((q, i) => (
                    <div key={i} className="flex items-start gap-2">
                      <span className="text-cyan-500 text-xs font-medium mt-px">{i + 1}.</span>
                      <span className="text-xs text-stone-300">{q}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Missing context */}
            {scopeAnalysis.missingContext.length > 0 && (
              <div className="p-4 rounded-lg bg-stone-900/40 border border-stone-800/40">
                <div className="flex items-center gap-1.5 mb-2">
                  <AlertTriangle size={14} className="text-yellow-400" />
                  <h3 className="text-xs font-semibold text-yellow-300 uppercase tracking-wider">
                    Missing Context
                  </h3>
                </div>
                <div className="space-y-1.5">
                  {scopeAnalysis.missingContext.map((item, i) => (
                    <div key={i} className="flex items-start gap-2">
                      <span className="text-yellow-500 text-[10px] mt-0.5">•</span>
                      <span className="text-xs text-stone-400">{item}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Options comparison */}
            <div>
              <h3 className="text-xs font-semibold text-stone-400 uppercase tracking-wider mb-3">
                Implementation Options
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                {scopeAnalysis.options.map((opt, i) => (
                  <OptionCard key={opt.name} option={opt} onApprove={() => handleApprove(i)} />
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Scope history (collapsed) */}
        <div className="mt-6 border-t border-stone-800/40 pt-4">
          <button
            onClick={() => setHistoryOpen(!historyOpen)}
            className="flex items-center gap-1.5 text-xs text-stone-500 hover:text-stone-400 transition-colors"
          >
            <ChevronDown
              size={12}
              className={`transition-transform ${historyOpen ? 'rotate-180' : ''}`}
            />
            Scope History
          </button>
          {historyOpen && (
            <div className="mt-3 p-3 rounded-lg bg-stone-900/30 border border-stone-800/30">
              <p className="text-[10px] text-stone-600 italic">
                No previous scope analyses in this session.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
