import { useState, useEffect } from 'react';
import {
  Shield,
  CheckCircle,
  XCircle,
  AlertTriangle,
  Play,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import type { WsCommand } from '../types';

interface ComplianceCheck {
  id: string;
  requirement: string;
  category: string;
  status: 'pass' | 'fail' | 'partial' | 'not-applicable';
  evidence?: string;
  remediation?: string;
}

interface ComplianceGap {
  requirement: string;
  severity: string;
  remediation: string;
}

interface ComplianceData {
  framework: string;
  overallScore: number;
  checks: ComplianceCheck[];
  gaps: ComplianceGap[];
  lastAudit: number;
}

interface ComplianceViewProps {
  sendCommand: (cmd: WsCommand) => void;
  complianceData: ComplianceData | null;
}

function StatusIcon({ status }: { status: string }) {
  if (status === 'pass') return <CheckCircle size={14} className="text-emerald-400" />;
  if (status === 'fail') return <XCircle size={14} className="text-red-400" />;
  if (status === 'not-applicable') return <AlertTriangle size={14} className="text-stone-500" />;
  return <AlertTriangle size={14} className="text-amber-400" />;
}

function ScoreGauge({ score }: { score: number }) {
  const color = score >= 80 ? 'bg-emerald-500' : score >= 50 ? 'bg-amber-500' : 'bg-red-500';
  const textColor = score >= 80 ? 'text-emerald-400' : score >= 50 ? 'text-amber-400' : 'text-red-400';
  const label = score >= 80 ? 'Compliant' : score >= 50 ? 'Partial' : 'Non-Compliant';
  return (
    <div className="p-4 rounded-lg bg-stone-800/40 border border-stone-700/40 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-stone-500 uppercase tracking-wider">Compliance Score</span>
        <span className={`text-sm font-bold ${textColor}`}>{score}% — {label}</span>
      </div>
      <div className="w-full h-3 bg-stone-700 rounded-full overflow-hidden">
        <div className={`h-full ${color} rounded-full transition-all duration-500`} style={{ width: `${score}%` }} />
      </div>
    </div>
  );
}

export function ComplianceView({ sendCommand, complianceData }: ComplianceViewProps) {
  const [selectedFramework, setSelectedFramework] = useState('');
  const [expandedGaps, setExpandedGaps] = useState<Set<string>>(new Set());

  useEffect(() => {
    sendCommand({ action: 'get-compliance' } as WsCommand);
  }, []);

  useEffect(() => {
    if (complianceData && !selectedFramework) {
      setSelectedFramework(complianceData.framework);
    }
  }, [complianceData]);

  const toggleGap = (id: string) => {
    setExpandedGaps(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleCheck = () => {
    sendCommand({ action: 'run-compliance-check', framework: selectedFramework } as WsCommand);
  };

  if (!complianceData) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center">
          <Shield size={36} className="text-stone-600 mx-auto mb-3" />
          <p className="text-sm text-stone-400">Loading compliance data...</p>
        </div>
      </div>
    );
  }

  const { framework: currentFramework, overallScore, checks, gaps, lastAudit } = complianceData;
  const passCount = checks.filter(r => r.status === 'pass').length;
  const failCount = checks.filter(r => r.status === 'fail').length;

  return (
    <div className="flex-1 flex flex-col p-6 overflow-auto">
      <div className="max-w-5xl w-full mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Shield size={18} className="text-blue-400" />
            <h2 className="text-lg font-semibold text-stone-200">Compliance</h2>
          </div>
          <button
            onClick={handleCheck}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium bg-blue-600/20 text-blue-300 border border-blue-500/30 hover:bg-blue-600/30 transition-colors"
          >
            <Play size={12} />
            Run Check
          </button>
        </div>

        {/* Framework info */}
        <div className="flex items-center gap-3">
          <label className="text-[10px] text-stone-500 uppercase tracking-wider">Framework</label>
          <span className="text-xs text-stone-300">{currentFramework}</span>
          <span className="text-[10px] text-stone-600">
            Last audit: {new Date(lastAudit).toLocaleString()}
          </span>
        </div>

        {/* Score gauge */}
        <ScoreGauge score={overallScore} />

        {/* Stats */}
        <div className="grid grid-cols-3 gap-3">
          <div className="p-3 rounded-lg bg-stone-800/40 border border-stone-700/40 text-center">
            <p className="text-lg font-bold text-stone-200">{checks.length}</p>
            <p className="text-[10px] text-stone-500">Total</p>
          </div>
          <div className="p-3 rounded-lg bg-stone-800/40 border border-stone-700/40 text-center">
            <p className="text-lg font-bold text-emerald-400">{passCount}</p>
            <p className="text-[10px] text-stone-500">Passing</p>
          </div>
          <div className="p-3 rounded-lg bg-stone-800/40 border border-stone-700/40 text-center">
            <p className="text-lg font-bold text-red-400">{failCount}</p>
            <p className="text-[10px] text-stone-500">Failing</p>
          </div>
        </div>

        {/* Requirements list */}
        <div className="space-y-3">
          <h3 className="text-xs font-semibold text-stone-400 uppercase tracking-wider">Checks</h3>
          <div className="space-y-2">
            {checks.map(req => (
              <div
                key={req.id}
                className="flex items-center gap-3 p-3 bg-stone-800/40 rounded-lg border border-stone-700/40"
              >
                <StatusIcon status={req.status} />
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-stone-300">{req.requirement}</p>
                  <p className="text-[10px] text-stone-500 truncate">{req.category}</p>
                </div>
                {req.evidence && (
                  <span className="text-[10px] text-stone-500 shrink-0 max-w-32 truncate">{req.evidence}</span>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Gap analysis */}
        {gaps.length > 0 && (
          <div className="space-y-3">
            <div className="flex items-center gap-1.5">
              <AlertTriangle size={14} className="text-amber-400" />
              <h3 className="text-xs font-semibold text-stone-400 uppercase tracking-wider">Gap Analysis</h3>
            </div>
            <div className="space-y-2">
              {gaps.map((gap, idx) => {
                const gapKey = `${gap.requirement}-${idx}`;
                const expanded = expandedGaps.has(gapKey);
                return (
                  <div
                    key={gapKey}
                    className="bg-stone-800/40 rounded-lg border border-stone-700/40 overflow-hidden"
                  >
                    <button
                      onClick={() => toggleGap(gapKey)}
                      className="w-full flex items-center gap-3 p-3 text-left hover:bg-stone-800/60 transition-colors"
                    >
                      {expanded ? (
                        <ChevronDown size={12} className="text-stone-500" />
                      ) : (
                        <ChevronRight size={12} className="text-stone-500" />
                      )}
                      <span className="text-xs text-stone-300 flex-1">{gap.requirement}</span>
                      <span className="text-[10px] text-stone-500">{gap.severity}</span>
                    </button>
                    {expanded && (
                      <div className="px-4 pb-3 space-y-2 border-t border-stone-700/30">
                        <div className="pt-2">
                          <p className="text-[10px] text-stone-500 uppercase tracking-wider mb-1">Remediation</p>
                          <p className="text-xs text-stone-400">{gap.remediation}</p>
                        </div>
                      </div>
                    )}
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
