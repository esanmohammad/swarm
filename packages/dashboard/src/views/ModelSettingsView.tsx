import { useState, useMemo, useEffect } from 'react';
import { Cpu, AlertTriangle, ChevronDown, ChevronUp, ArrowUpDown, Check, X, Play, Loader2, Plus } from 'lucide-react';
import type { WsCommand, ModelInfo, ProviderStatus, ModelConfig } from '../types';
import { FeatureGuide } from '../components/FeatureGuide';
import { ModelPicker } from '../components/ModelPicker';
import { ProviderCard } from '../components/ProviderCard';
import { CostEstimator } from '../components/CostEstimator';
import { useAction } from '../hooks/useAction';

interface ModelSettingsViewProps {
  sendCommand: (cmd: WsCommand) => void;
  modelConfig: ModelConfig | null;
  availableModels: ModelInfo[] | null;
  providerStatus: ProviderStatus[] | null;
}

const STAGES = [
  { key: 'analyst', label: 'Analyst', description: 'Requirements gathering', needsTools: false },
  { key: 'architect', label: 'Architect', description: 'System design', needsTools: false },
  { key: 'lead', label: 'Lead', description: 'Task breakdown', needsTools: false },
  { key: 'engineer', label: 'Engineer', description: 'Code implementation', needsTools: true },
  { key: 'tester', label: 'Tester', description: 'Test generation', needsTools: true },
] as const;

const DEFAULT_PROVIDERS = [
  { name: 'Anthropic', showUrl: false, showMode: true },
  { name: 'OpenAI', showUrl: false, showMode: false },
  { name: 'Google', showUrl: false, showMode: false },
  { name: 'Ollama', showUrl: true, showMode: false },
];

type SortKey = 'provider' | 'name' | 'contextWindow' | 'tier' | 'costPer1MInput' | 'costPer1MOutput';

export function ModelSettingsView({ sendCommand, modelConfig, availableModels, providerStatus }: ModelSettingsViewProps) {
  const [sortKey, setSortKey] = useState<SortKey>('provider');
  const [sortAsc, setSortAsc] = useState(true);
  const [providerFilter, setProviderFilter] = useState<string>('all');
  const [showAddProvider, setShowAddProvider] = useState(false);
  const [newProviderName, setNewProviderName] = useState('');
  const [expandedSection, setExpandedSection] = useState<string | null>('stages');

  const testAction = useAction(sendCommand);

  // Fetch initial data
  useEffect(() => {
    sendCommand({ action: 'get-model-config' });
    sendCommand({ action: 'list-models' });
    sendCommand({ action: 'list-providers' });
  }, [sendCommand]);

  const models = availableModels ?? [];
  const config = modelConfig;
  const providers = providerStatus ?? [];

  const stageModels = config?.stageModels ?? {};

  // Get unique provider names
  const providerNames = useMemo(() => {
    const names = new Set(models.map(m => m.provider));
    providers.forEach(p => names.add(p.name));
    return Array.from(names);
  }, [models, providers]);

  // Sorted & filtered models table
  const sortedModels = useMemo(() => {
    let filtered = [...models];
    if (providerFilter !== 'all') {
      filtered = filtered.filter(m => m.provider === providerFilter);
    }
    filtered.sort((a, b) => {
      const aVal = a[sortKey];
      const bVal = b[sortKey];
      if (typeof aVal === 'string' && typeof bVal === 'string') {
        return sortAsc ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
      }
      return sortAsc ? (aVal as number) - (bVal as number) : (bVal as number) - (aVal as number);
    });
    return filtered;
  }, [models, sortKey, sortAsc, providerFilter]);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) setSortAsc(!sortAsc);
    else { setSortKey(key); setSortAsc(true); }
  };

  const handleStageModelChange = (stage: string, model: string) => {
    sendCommand({ action: 'set-model-config', stage, model });
  };

  const handleTestModel = (model: string) => {
    testAction.execute({ action: 'test-model', model }, `Testing ${model}...`);
  };

  const toggleSection = (section: string) => {
    setExpandedSection(expandedSection === section ? null : section);
  };

  const formatCtx = (n: number) => n >= 1000000 ? `${(n / 1000000).toFixed(1)}M` : n >= 1000 ? `${Math.round(n / 1000)}K` : `${n}`;
  const formatCost = (n: number) => n === 0 ? 'Free' : `$${n.toFixed(2)}`;

  const hasData = models.length > 0 || providers.length > 0 || config != null;

  return (
    <div className="flex-1 flex flex-col p-6 overflow-hidden">
      <div className="max-w-5xl w-full mx-auto flex flex-col flex-1 min-h-0">
        {/* Header */}
        <div className="flex items-center gap-2 mb-4">
          <Cpu size={18} className="text-blue-400" />
          <h2 className="text-lg font-semibold text-stone-200">Models & Providers</h2>
          <FeatureGuide
            featureId="model-settings"
            title="Models & Providers"
            description="Configure which AI models to use for each pipeline stage. Assign cost-effective models to text-only stages (Analyst, Architect, Lead) and more capable models to stages requiring tool use (Engineer, Tester)."
            setupSteps={[
              { label: 'Configure at least one provider API key' },
              { label: 'Assign models to pipeline stages' },
              { label: 'Test connections to verify setup' },
            ]}
            cliCommands={[
              { command: 'swarm config model --stage engineer --model sonnet', description: 'Set stage model' },
              { command: 'swarm config providers', description: 'List configured providers' },
            ]}
            hasData={hasData}
          />
        </div>

        <p className="text-xs text-stone-500 mb-6">
          Configure AI model providers and assign models to pipeline stages for optimal cost and performance.
        </p>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto space-y-4 pr-1 scrollbar-thin">

          {/* Section 1: Per-Stage Model Assignment */}
          <div className="rounded-lg border border-stone-800/40 bg-stone-900/30 overflow-hidden">
            <button
              onClick={() => toggleSection('stages')}
              className="flex items-center justify-between w-full px-4 py-3 text-left"
            >
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-medium text-stone-300">Per-Stage Model Assignment</h3>
                <span className="text-[10px] text-stone-600">Configure which model runs each stage</span>
              </div>
              {expandedSection === 'stages' ? <ChevronUp size={14} className="text-stone-500" /> : <ChevronDown size={14} className="text-stone-500" />}
            </button>

            {expandedSection === 'stages' && (
              <div className="px-4 pb-4 space-y-3">
                <p className="text-[10px] text-stone-500 leading-relaxed">
                  Analyst, Architect, and Lead only generate text — any model works. Engineer and Tester need tool calling support.
                </p>

                <div className="space-y-2">
                  {STAGES.map(stage => {
                    const currentModel = stageModels[stage.key] || config?.defaultModel || '';
                    const model = models.find(m => m.id === currentModel || m.fullId === currentModel);
                    const isTierWarning = stage.needsTools && model && model.tier === 1;

                    return (
                      <div
                        key={stage.key}
                        className="flex items-center gap-3 p-3 rounded-lg bg-stone-800/30 border border-stone-800/30"
                      >
                        {/* Stage info */}
                        <div className="w-28 shrink-0">
                          <div className="text-xs font-medium text-stone-300">{stage.label}</div>
                          <div className="text-[10px] text-stone-600">{stage.description}</div>
                        </div>

                        {/* Model picker */}
                        <ModelPicker
                          value={currentModel}
                          onChange={(m) => handleStageModelChange(stage.key, m)}
                          models={models}
                          minTier={stage.needsTools ? 2 : undefined}
                          className="flex-1"
                        />

                        {/* Capability badges */}
                        {model && (
                          <div className="flex items-center gap-1 shrink-0">
                            <span className="px-1.5 py-0.5 rounded text-[9px] font-medium bg-stone-800 text-stone-500">
                              text
                            </span>
                            {model.supportsTools && (
                              <span className="px-1.5 py-0.5 rounded text-[9px] font-medium bg-blue-900/40 text-blue-400">
                                tools
                              </span>
                            )}
                            {model.supportsStreaming && (
                              <span className="px-1.5 py-0.5 rounded text-[9px] font-medium bg-green-900/40 text-green-400">
                                stream
                              </span>
                            )}
                          </div>
                        )}

                        {/* Test button */}
                        <button
                          onClick={() => handleTestModel(currentModel)}
                          disabled={!currentModel || testAction.state.status === 'running'}
                          className="shrink-0 flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium text-stone-400 bg-stone-800/60 border border-stone-700/40 hover:bg-stone-700/60 disabled:text-stone-600 transition-colors"
                        >
                          {testAction.state.status === 'running' ? <Loader2 size={10} className="animate-spin" /> : <Play size={10} />}
                          Test
                        </button>

                        {/* Tier warning */}
                        {isTierWarning && (
                          <div className="shrink-0" title="Tier 1 models may not support tool calling required for this stage">
                            <AlertTriangle size={14} className="text-amber-400" />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* Section 2: Providers */}
          <div className="rounded-lg border border-stone-800/40 bg-stone-900/30 overflow-hidden">
            <button
              onClick={() => toggleSection('providers')}
              className="flex items-center justify-between w-full px-4 py-3 text-left"
            >
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-medium text-stone-300">Providers</h3>
                <span className="text-[10px] text-stone-600">
                  {providers.filter(p => p.connected).length}/{providers.length} connected
                </span>
              </div>
              {expandedSection === 'providers' ? <ChevronUp size={14} className="text-stone-500" /> : <ChevronDown size={14} className="text-stone-500" />}
            </button>

            {expandedSection === 'providers' && (
              <div className="px-4 pb-4 space-y-3">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {DEFAULT_PROVIDERS.map(dp => {
                    const status = providers.find(p => p.name === dp.name) ?? {
                      name: dp.name,
                      configured: false,
                      connected: false,
                      modelsAvailable: 0,
                    };
                    return (
                      <ProviderCard
                        key={dp.name}
                        name={dp.name}
                        status={status}
                        onTest={() => sendCommand({ action: 'test-provider', provider: dp.name })}
                        onSaveKey={(key) => sendCommand({ action: 'save-provider-key', provider: dp.name, apiKey: key })}
                        onSaveUrl={dp.showUrl ? (url) => sendCommand({ action: 'save-provider-url', provider: dp.name, baseUrl: url }) : undefined}
                        showUrlInput={dp.showUrl}
                        showModeToggle={dp.showMode}
                      />
                    );
                  })}

                  {/* Custom providers */}
                  {providers
                    .filter(p => !DEFAULT_PROVIDERS.some(dp => dp.name === p.name))
                    .map(p => (
                      <ProviderCard
                        key={p.name}
                        name={p.name}
                        status={p}
                        onTest={() => sendCommand({ action: 'test-provider', provider: p.name })}
                        onSaveKey={(key) => sendCommand({ action: 'save-provider-key', provider: p.name, apiKey: key })}
                        onSaveUrl={(url) => sendCommand({ action: 'save-provider-url', provider: p.name, baseUrl: url })}
                        showUrlInput
                      />
                    ))}
                </div>

                {/* Add custom provider */}
                {showAddProvider ? (
                  <div className="flex items-center gap-2 p-3 rounded-lg bg-stone-800/30 border border-stone-800/40">
                    <input
                      autoFocus
                      value={newProviderName}
                      onChange={e => setNewProviderName(e.target.value)}
                      placeholder="Provider name..."
                      className="flex-1 px-3 py-1.5 rounded-md text-xs bg-stone-800/60 border border-stone-700/50 text-stone-300 placeholder:text-stone-600 outline-none"
                    />
                    <button
                      onClick={() => {
                        if (newProviderName.trim()) {
                          sendCommand({ action: 'save-provider-url', provider: newProviderName.trim(), baseUrl: '' });
                          setNewProviderName('');
                          setShowAddProvider(false);
                        }
                      }}
                      disabled={!newProviderName.trim()}
                      className="px-3 py-1.5 rounded-md text-xs font-medium bg-blue-600 hover:bg-blue-500 text-white disabled:bg-stone-700 disabled:text-stone-500 transition-colors"
                    >
                      Add
                    </button>
                    <button
                      onClick={() => { setShowAddProvider(false); setNewProviderName(''); }}
                      className="p-1.5 rounded text-stone-500 hover:text-stone-400"
                    >
                      <X size={12} />
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setShowAddProvider(true)}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs text-stone-500 hover:text-stone-400 border border-dashed border-stone-700/40 hover:border-stone-600/40 transition-colors w-full justify-center"
                  >
                    <Plus size={12} />
                    Add Custom Provider
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Section 3: Available Models Table */}
          <div className="rounded-lg border border-stone-800/40 bg-stone-900/30 overflow-hidden">
            <button
              onClick={() => toggleSection('models')}
              className="flex items-center justify-between w-full px-4 py-3 text-left"
            >
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-medium text-stone-300">Available Models</h3>
                <span className="text-[10px] text-stone-600">{models.length} models</span>
              </div>
              {expandedSection === 'models' ? <ChevronUp size={14} className="text-stone-500" /> : <ChevronDown size={14} className="text-stone-500" />}
            </button>

            {expandedSection === 'models' && (
              <div className="px-4 pb-4">
                {/* Filter */}
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-[10px] text-stone-500">Filter:</span>
                  <button
                    onClick={() => setProviderFilter('all')}
                    className={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors ${
                      providerFilter === 'all'
                        ? 'bg-blue-600/30 text-blue-300'
                        : 'bg-stone-800/60 text-stone-500 hover:text-stone-400'
                    }`}
                  >
                    All
                  </button>
                  {providerNames.map(name => (
                    <button
                      key={name}
                      onClick={() => setProviderFilter(name)}
                      className={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors ${
                        providerFilter === name
                          ? 'bg-blue-600/30 text-blue-300'
                          : 'bg-stone-800/60 text-stone-500 hover:text-stone-400'
                      }`}
                    >
                      {name}
                    </button>
                  ))}
                </div>

                {/* Table */}
                {sortedModels.length === 0 ? (
                  <div className="py-8 text-center text-xs text-stone-600">
                    No models available. Configure a provider to discover models.
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-stone-800/40">
                          {([
                            ['provider', 'Provider'],
                            ['name', 'Model'],
                            ['contextWindow', 'Context'],
                            ['tier', 'Tier'],
                            ['costPer1MInput', 'Input/1M'],
                            ['costPer1MOutput', 'Output/1M'],
                          ] as [SortKey, string][]).map(([key, label]) => (
                            <th
                              key={key}
                              onClick={() => handleSort(key)}
                              className="px-2 py-2 text-left font-medium text-stone-500 cursor-pointer hover:text-stone-400 select-none"
                            >
                              <span className="inline-flex items-center gap-1">
                                {label}
                                {sortKey === key && (
                                  <ArrowUpDown size={10} className="text-blue-400" />
                                )}
                              </span>
                            </th>
                          ))}
                          <th className="px-2 py-2 text-left font-medium text-stone-500">Tools</th>
                        </tr>
                      </thead>
                      <tbody>
                        {sortedModels.map(m => (
                          <tr
                            key={m.fullId}
                            className="border-b border-stone-800/20 hover:bg-stone-800/20 cursor-pointer transition-colors"
                            onClick={() => {
                              // Find first unassigned stage or default to engineer
                              const unassigned = STAGES.find(s => !stageModels[s.key]);
                              const targetStage = unassigned?.key ?? 'engineer';
                              handleStageModelChange(targetStage, m.id);
                            }}
                            title="Click to assign to a stage"
                          >
                            <td className="px-2 py-2 text-stone-500">{m.provider}</td>
                            <td className="px-2 py-2 text-stone-300 font-medium">{m.name}</td>
                            <td className="px-2 py-2 text-stone-500">{formatCtx(m.contextWindow)}</td>
                            <td className="px-2 py-2">
                              <span className={`px-1.5 py-0.5 rounded text-[9px] font-medium ${
                                m.tier === 3 ? 'bg-blue-900/50 text-blue-400' :
                                m.tier === 2 ? 'bg-amber-900/50 text-amber-400' :
                                'bg-stone-700 text-stone-400'
                              }`}>
                                T{m.tier}
                              </span>
                            </td>
                            <td className="px-2 py-2 text-stone-500">{formatCost(m.costPer1MInput)}</td>
                            <td className="px-2 py-2 text-stone-500">{formatCost(m.costPer1MOutput)}</td>
                            <td className="px-2 py-2">
                              {m.supportsTools ? (
                                <Check size={12} className="text-green-500" />
                              ) : (
                                <X size={12} className="text-stone-600" />
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Section 4: Cost Comparison */}
          {models.length > 0 && Object.keys(stageModels).length > 0 && (
            <CostEstimator stageModels={stageModels} models={models} />
          )}
        </div>
      </div>
    </div>
  );
}
