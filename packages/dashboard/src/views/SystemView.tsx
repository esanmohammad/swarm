import { useState, useEffect } from 'react';
import {
  Network,
  Server,
  CheckCircle,
  XCircle,
  AlertTriangle,
  Play,
  GitPullRequest,
  RefreshCw,
} from 'lucide-react';
import type { WsCommand } from '../types';

interface ServiceNode {
  name: string;
  repo: string;
  type: string;
  apis: Array<{ path: string; method: string; description: string }>;
  dependencies: string[];
  healthStatus: 'healthy' | 'degraded' | 'unknown';
}

interface CrossRepoPR {
  repo: string;
  prNumber: number;
  title: string;
  status: string;
}

interface SystemGraphData {
  services: ServiceNode[];
  contracts: Array<{ provider: string; consumer: string; type: string; version: string; status: 'compatible' | 'breaking' | 'unknown' }>;
  crossRepoPrs: CrossRepoPR[];
}

interface SystemViewProps {
  sendCommand: (cmd: WsCommand) => void;
  systemGraph: SystemGraphData | null;
}

function HealthBadge({ status }: { status: string }) {
  if (status === 'healthy') {
    return (
      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
        <CheckCircle size={9} /> Healthy
      </span>
    );
  }
  if (status === 'degraded') {
    return (
      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-red-500/20 text-red-300 border border-red-500/30">
        <XCircle size={9} /> Degraded
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-stone-700 text-stone-400 border border-stone-600">
      <AlertTriangle size={9} /> Unknown
    </span>
  );
}

function PRStatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    open: 'bg-green-500/20 text-green-300 border-green-500/30',
    merged: 'bg-violet-500/20 text-violet-300 border-violet-500/30',
    closed: 'bg-stone-700 text-stone-400 border-stone-600',
  };
  return (
    <span className={`inline-flex px-1.5 py-0.5 rounded text-[10px] font-medium border ${styles[status] || styles.closed}`}>
      {status.toUpperCase()}
    </span>
  );
}

export function SystemView({ sendCommand, systemGraph }: SystemViewProps) {
  const [selectedService, setSelectedService] = useState<string | null>(null);

  useEffect(() => {
    sendCommand({ action: 'get-system-graph' } as WsCommand);
  }, []);

  if (!systemGraph) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center">
          <Network size={36} className="text-stone-600 mx-auto mb-3" />
          <p className="text-sm text-stone-400">Loading system graph...</p>
        </div>
      </div>
    );
  }

  const { services, crossRepoPrs } = systemGraph;
  const selected = selectedService ? services.find(s => s.name === selectedService) : null;

  return (
    <div className="flex-1 flex flex-col p-6 overflow-auto">
      <div className="max-w-5xl w-full mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Network size={18} className="text-sky-400" />
            <h2 className="text-lg font-semibold text-stone-200">System Map</h2>
            <span className="text-xs text-stone-500 ml-2">{services.length} services</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => sendCommand({ action: 'run-system-check' } as WsCommand)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium bg-stone-800 text-stone-300 border border-stone-700 hover:bg-stone-700 transition-colors"
            >
              <RefreshCw size={12} />
              Check Contracts
            </button>
            <button
              onClick={() => sendCommand({ action: 'run-system-map' } as WsCommand)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium bg-sky-600/20 text-sky-300 border border-sky-500/30 hover:bg-sky-600/30 transition-colors"
            >
              <Play size={12} />
              Rescan
            </button>
          </div>
        </div>

        {/* Service cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {services.map(svc => (
            <button
              key={svc.name}
              onClick={() => setSelectedService(svc.name === selectedService ? null : svc.name)}
              className={`text-left p-4 rounded-lg border transition-colors ${
                selectedService === svc.name
                  ? 'bg-sky-500/5 border-sky-500/30'
                  : 'bg-stone-800/40 border-stone-700/40 hover:bg-stone-800/60'
              }`}
            >
              <div className="flex items-center gap-2 mb-2">
                <Server size={14} className="text-sky-400" />
                <h4 className="text-xs font-semibold text-stone-200 truncate">{svc.name}</h4>
              </div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-[10px] text-stone-500">{svc.type}</span>
                <HealthBadge status={svc.healthStatus} />
              </div>
              <p className="text-[10px] text-stone-500">{svc.apis.length} APIs</p>
              {svc.dependencies.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-2">
                  {svc.dependencies.map(dep => (
                    <span key={dep} className="text-[10px] px-1.5 py-0.5 rounded bg-stone-700/50 text-stone-500">
                      {dep}
                    </span>
                  ))}
                </div>
              )}
            </button>
          ))}
        </div>

        {/* Selected service detail */}
        {selected && (
          <div className="p-4 rounded-lg bg-stone-800/40 border border-stone-700/40 space-y-3">
            <div className="flex items-center gap-2">
              <Server size={14} className="text-sky-400" />
              <h3 className="text-sm font-semibold text-stone-200">{selected.name}</h3>
              <span className="text-[10px] text-stone-500 font-mono">{selected.repo}</span>
            </div>
            <div>
              <p className="text-[10px] text-stone-500 uppercase tracking-wider mb-2">API Endpoints</p>
              <div className="space-y-1">
                {selected.apis.map((api, i) => (
                  <div key={i} className="flex items-center gap-2 text-xs">
                    <span className="text-[10px] font-mono text-sky-400 w-12 shrink-0">{api.method}</span>
                    <span className="text-stone-300 font-mono">{api.path}</span>
                    <span className="text-stone-500 truncate">{api.description}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Cross-repo PRs */}
        {crossRepoPrs.length > 0 && (
          <div className="space-y-3">
            <div className="flex items-center gap-1.5">
              <GitPullRequest size={14} className="text-violet-400" />
              <h3 className="text-xs font-semibold text-stone-400 uppercase tracking-wider">Cross-Repo PRs</h3>
            </div>
            <div className="space-y-2">
              {crossRepoPrs.map(pr => (
                <div
                  key={`${pr.repo}-${pr.prNumber}`}
                  className="flex items-center gap-3 p-3 bg-stone-800/40 rounded-lg border border-stone-700/40"
                >
                  <PRStatusBadge status={pr.status} />
                  <span className="text-xs text-stone-300 flex-1 truncate">{pr.title}</span>
                  <span className="text-[10px] text-stone-500 font-mono">{pr.repo} #{pr.prNumber}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
