import { useState, useEffect } from 'react';
import {
  Gauge,
  CheckCircle,
  AlertTriangle,
  XCircle,
  Plus,
  RefreshCw,
  TrendingUp,
  TrendingDown,
  Minus,
} from 'lucide-react';
import { FeatureGuide } from '../components/FeatureGuide';
import { StateView } from '../components/StateView';
import type { WsCommand } from '../types';

interface SloItem {
  id: string;
  name: string;
  target: string;
  current: string;
  status: 'ok' | 'warning' | 'breach';
  trend: 'improving' | 'degrading' | 'stable';
  errorBudget: { total: number; remaining: number; burnRate: number };
  source: string;
  lastChecked: number;
}

interface SloData {
  slos: SloItem[];
  alerts: Array<{ sloId: string; message: string; severity: string; timestamp: number }>;
}

interface SloViewProps {
  sendCommand: (cmd: WsCommand) => void;
  sloData: SloData | null;
}

function SloStatusIcon({ status }: { status: 'ok' | 'warning' | 'breach' }) {
  if (status === 'ok') return <CheckCircle size={14} className="text-emerald-400" />;
  if (status === 'warning') return <AlertTriangle size={14} className="text-amber-400" />;
  return <XCircle size={14} className="text-red-400" />;
}

function TrendIcon({ trend }: { trend: 'improving' | 'degrading' | 'stable' }) {
  if (trend === 'improving') return <TrendingUp size={12} className="text-emerald-400" />;
  if (trend === 'degrading') return <TrendingDown size={12} className="text-red-400" />;
  return <Minus size={12} className="text-stone-500" />;
}

function ErrorBudgetBar({ pct }: { pct: number }) {
  const color = pct > 50 ? 'bg-emerald-500' : pct > 20 ? 'bg-amber-500' : 'bg-red-500';
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-2 bg-stone-700 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full ${color} transition-all`}
          style={{ width: `${Math.max(0, Math.min(100, pct))}%` }}
        />
      </div>
      <span className="text-[10px] text-stone-400 w-10 text-right">{pct}%</span>
    </div>
  );
}

export function SloView({ sendCommand, sloData }: SloViewProps) {
  const [showAddForm, setShowAddForm] = useState(false);
  const [newName, setNewName] = useState('');
  const [newTarget, setNewTarget] = useState('');
  const [newWindow, setNewWindow] = useState('30d');

  useEffect(() => {
    sendCommand({ action: 'get-slos' } as WsCommand);
  }, []);

  const handleAdd = () => {
    const name = newName.trim();
    const target = parseFloat(newTarget);
    if (!name || isNaN(target)) return;
    sendCommand({ action: 'add-slo', name, target: String(target), source: newWindow } as WsCommand);
    setNewName('');
    setNewTarget('');
    setNewWindow('30d');
    setShowAddForm(false);
  };

  if (!sloData) {
    return (
      <div className="flex-1 flex flex-col p-6 overflow-auto">
        <div className="max-w-5xl w-full mx-auto">
          <div className="flex items-center gap-2 mb-4">
            <Gauge size={18} className="text-emerald-400" />
            <h2 className="text-lg font-semibold text-stone-200">SLO Tracker</h2>
          </div>
          <FeatureGuide
            featureId="slo"
            title="SLO Management"
            description="Define reliability targets for your services. Track error budgets, get alerts when SLOs are burning, and maintain production quality."
            setupSteps={[
              { label: 'Add your first SLO', command: 'swarm slo add' },
            ]}
            cliCommands={[
              { command: 'swarm slo', description: 'List all SLOs and their status' },
              { command: 'swarm slo check', description: 'Check all SLOs against current metrics' },
            ]}
            hasData={false}
          />
          <StateView
            status="empty"
            title="No SLOs defined yet"
            message="SLOs (Service Level Objectives) let you define reliability targets like 99.9% uptime or p99 latency under 200ms. Add one to start tracking error budgets."
          />
        </div>
      </div>
    );
  }

  const { slos } = sloData;
  const redCount = slos.filter(s => s.status === 'breach').length;
  const yellowCount = slos.filter(s => s.status === 'warning').length;
  const overallHealth = redCount > 0 ? 'critical' : yellowCount > 0 ? 'degraded' : 'healthy';
  const healthColor =
    overallHealth === 'healthy'
      ? 'text-emerald-400'
      : overallHealth === 'degraded'
        ? 'text-amber-400'
        : 'text-red-400';

  return (
    <div className="flex-1 flex flex-col p-6 overflow-auto">
      <div className="max-w-5xl w-full mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Gauge size={18} className="text-emerald-400" />
            <h2 className="text-lg font-semibold text-stone-200">SLO Tracker</h2>
            <span className={`text-xs font-medium ml-2 ${healthColor}`}>
              {overallHealth.toUpperCase()}
            </span>
            <FeatureGuide
              featureId="slo"
              title="SLO Management"
              description="Define reliability targets for your services. Track error budgets, get alerts when SLOs are burning, and maintain production quality."
              setupSteps={[
                { label: 'Add your first SLO', command: 'swarm slo add' },
              ]}
              cliCommands={[
                { command: 'swarm slo', description: 'List all SLOs and their status' },
                { command: 'swarm slo check', description: 'Check all SLOs against current metrics' },
              ]}
              hasData={slos.length > 0}
            />
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => sendCommand({ action: 'run-slo-check' } as WsCommand)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium bg-stone-800 text-stone-300 border border-stone-700 hover:bg-stone-700 transition-colors"
            >
              <RefreshCw size={12} />
              Check All
            </button>
            <button
              onClick={() => setShowAddForm(!showAddForm)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium bg-emerald-600/20 text-emerald-300 border border-emerald-500/30 hover:bg-emerald-600/30 transition-colors"
            >
              <Plus size={12} />
              Add SLO
            </button>
          </div>
        </div>

        {/* Add form */}
        {showAddForm && (
          <div className="p-4 rounded-lg bg-stone-800/40 border border-stone-700/40 space-y-3">
            <h3 className="text-xs font-medium text-stone-300">New SLO</h3>
            <div className="grid grid-cols-3 gap-3">
              <input
                type="text"
                value={newName}
                onChange={e => setNewName(e.target.value)}
                placeholder="SLO name..."
                className="px-3 py-2 bg-stone-900/60 border border-stone-700/50 rounded-lg text-xs text-stone-200 placeholder-stone-500 focus:border-emerald-600 focus:outline-none focus:ring-1 focus:ring-emerald-600/30"
              />
              <input
                type="number"
                value={newTarget}
                onChange={e => setNewTarget(e.target.value)}
                placeholder="Target (e.g. 99.9)"
                step="0.1"
                className="px-3 py-2 bg-stone-900/60 border border-stone-700/50 rounded-lg text-xs text-stone-200 placeholder-stone-500 focus:border-emerald-600 focus:outline-none focus:ring-1 focus:ring-emerald-600/30"
              />
              <select
                value={newWindow}
                onChange={e => setNewWindow(e.target.value)}
                className="bg-stone-900 border border-stone-700 rounded-lg px-3 py-2 text-xs text-stone-300"
              >
                <option value="7d">7 days</option>
                <option value="30d">30 days</option>
                <option value="90d">90 days</option>
              </select>
            </div>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setShowAddForm(false)}
                className="px-3 py-1.5 rounded text-xs text-stone-400 hover:text-stone-300 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleAdd}
                className="px-3 py-1.5 rounded text-xs font-medium bg-emerald-600 text-white hover:bg-emerald-500 transition-colors"
              >
                Add
              </button>
            </div>
          </div>
        )}

        {/* SLO cards */}
        {slos.length === 0 ? (
          <StateView
            status="empty"
            title="No SLOs defined yet"
            message="SLOs (Service Level Objectives) let you define reliability targets like 99.9% uptime or p99 latency under 200ms. Click 'Add SLO' above to create one."
            actions={[{ label: 'Add SLO', onClick: () => setShowAddForm(true), variant: 'primary' }]}
          />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {slos.map(slo => (
              <div
                key={slo.id}
                className="bg-stone-800/40 rounded-lg border border-stone-700/40 p-4 space-y-3"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <SloStatusIcon status={slo.status} />
                    <h4 className="text-sm font-semibold text-stone-200">{slo.name}</h4>
                  </div>
                  <TrendIcon trend={slo.trend} />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <p className="text-[10px] text-stone-500 uppercase tracking-wider">Current</p>
                    <p className="text-sm font-medium text-stone-200">{slo.current}</p>
                  </div>
                  <div>
                    <p className="text-[10px] text-stone-500 uppercase tracking-wider">Target</p>
                    <p className="text-sm font-medium text-stone-300">{slo.target}</p>
                  </div>
                </div>

                <div>
                  <p className="text-[10px] text-stone-500 mb-1">Error Budget Remaining</p>
                  <ErrorBudgetBar pct={slo.errorBudget.total > 0 ? Math.round((slo.errorBudget.remaining / slo.errorBudget.total) * 100) : 0} />
                </div>

                <p className="text-[10px] text-stone-500">Source: {slo.source}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
