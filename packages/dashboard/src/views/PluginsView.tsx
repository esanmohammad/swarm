import { useState, useEffect } from 'react';
import {
  Puzzle,
  Download,
  Trash2,
  ToggleLeft,
  ToggleRight,
  Search,
  Package,
  CheckCircle,
} from 'lucide-react';
import type { WsCommand } from '../types';

interface InstalledPlugin {
  name: string;
  type: string;
  version: string;
  enabled: boolean;
  description: string;
}

interface AvailablePlugin {
  name: string;
  type: string;
  version: string;
  description: string;
  downloads: number;
}

interface PluginRegistryData {
  installed: InstalledPlugin[];
  available: AvailablePlugin[];
}

interface PluginsViewProps {
  sendCommand: (cmd: WsCommand) => void;
  pluginRegistry: PluginRegistryData | null;
}

export function PluginsView({ sendCommand, pluginRegistry }: PluginsViewProps) {
  const [activeTab, setActiveTab] = useState<'installed' | 'available'>('installed');
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    sendCommand({ action: 'get-plugins' } as WsCommand);
  }, []);

  const handleInstall = (name: string) => {
    sendCommand({ action: 'install-plugin', name } as WsCommand);
  };

  const handleRemove = (name: string) => {
    sendCommand({ action: 'remove-plugin', name } as WsCommand);
  };

  const handleToggle = (name: string) => {
    // Toggle is conceptually an install-plugin with toggle semantics
    sendCommand({ action: 'install-plugin', name } as WsCommand);
  };

  if (!pluginRegistry) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center">
          <Puzzle size={36} className="text-stone-600 mx-auto mb-3" />
          <p className="text-sm text-stone-400">Loading plugins...</p>
        </div>
      </div>
    );
  }

  const { installed, available } = pluginRegistry;

  const filteredInstalled = installed.filter(p =>
    p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    p.description.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const filteredAvailable = available.filter(p =>
    p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    p.description.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const installedNames = new Set(installed.map(p => p.name));

  return (
    <div className="flex-1 flex flex-col p-6 overflow-auto">
      <div className="max-w-5xl w-full mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Puzzle size={18} className="text-purple-400" />
            <h2 className="text-lg font-semibold text-stone-200">Plugins</h2>
            <span className="text-xs text-stone-500 ml-2">{installed.length} installed</span>
          </div>
        </div>

        {/* Search */}
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-500" />
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Search plugins..."
            className="w-full pl-9 pr-3 py-2 bg-stone-900/60 border border-stone-700/50 rounded-lg text-xs text-stone-200 placeholder-stone-500 focus:border-purple-600 focus:outline-none focus:ring-1 focus:ring-purple-600/30"
          />
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-1 border-b border-stone-700/50 pb-0">
          {(['installed', 'available'] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-3 py-2 text-xs font-medium border-b-2 transition-colors ${
                activeTab === tab
                  ? 'text-purple-300 border-purple-400'
                  : 'text-stone-500 border-transparent hover:text-stone-300'
              }`}
            >
              {tab === 'installed' ? `Installed (${installed.length})` : `Available (${available.length})`}
            </button>
          ))}
        </div>

        {/* Installed tab */}
        {activeTab === 'installed' && (
          <div className="space-y-2">
            {filteredInstalled.length === 0 ? (
              <div className="text-center py-12">
                <Package size={28} className="text-stone-700 mx-auto mb-2" />
                <p className="text-xs text-stone-500">
                  {searchQuery ? 'No installed plugins match your search.' : 'No plugins installed yet.'}
                </p>
              </div>
            ) : (
              filteredInstalled.map(plugin => (
                <div
                  key={plugin.name}
                  className="flex items-center gap-3 p-4 bg-stone-800/40 rounded-lg border border-stone-700/40"
                >
                  <button onClick={() => handleToggle(plugin.name)} className="shrink-0">
                    {plugin.enabled ? (
                      <ToggleRight size={20} className="text-emerald-400" />
                    ) : (
                      <ToggleLeft size={20} className="text-stone-600" />
                    )}
                  </button>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <h4 className={`text-xs font-semibold ${plugin.enabled ? 'text-stone-200' : 'text-stone-500'}`}>
                        {plugin.name}
                      </h4>
                      <span className="text-[10px] text-stone-600">v{plugin.version}</span>
                    </div>
                    <p className="text-[10px] text-stone-500 truncate">{plugin.description}</p>
                    <p className="text-[10px] text-stone-600 mt-0.5">{plugin.type}</p>
                  </div>
                  <button
                    onClick={() => handleRemove(plugin.name)}
                    className="flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium text-red-400 hover:bg-red-500/10 transition-colors shrink-0"
                  >
                    <Trash2 size={10} />
                    Remove
                  </button>
                </div>
              ))
            )}
          </div>
        )}

        {/* Available tab */}
        {activeTab === 'available' && (
          <div className="space-y-2">
            {filteredAvailable.length === 0 ? (
              <div className="text-center py-12">
                <Package size={28} className="text-stone-700 mx-auto mb-2" />
                <p className="text-xs text-stone-500">
                  {searchQuery ? 'No available plugins match your search.' : 'No plugins available.'}
                </p>
              </div>
            ) : (
              filteredAvailable.map(plugin => {
                const isInstalled = installedNames.has(plugin.name);
                return (
                  <div
                    key={plugin.name}
                    className="flex items-center gap-3 p-4 bg-stone-800/40 rounded-lg border border-stone-700/40"
                  >
                    <Puzzle size={16} className="text-purple-400 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <h4 className="text-xs font-semibold text-stone-200">{plugin.name}</h4>
                        <span className="text-[10px] text-stone-600">v{plugin.version}</span>
                      </div>
                      <p className="text-[10px] text-stone-500 truncate">{plugin.description}</p>
                      <div className="flex items-center gap-3 mt-0.5">
                        <span className="text-[10px] text-stone-600">{plugin.type}</span>
                        <span className="text-[10px] text-stone-600">{plugin.downloads} downloads</span>
                      </div>
                    </div>
                    {isInstalled ? (
                      <span className="flex items-center gap-1 px-2 py-1 text-[10px] font-medium text-emerald-400 shrink-0">
                        <CheckCircle size={10} />
                        Installed
                      </span>
                    ) : (
                      <button
                        onClick={() => handleInstall(plugin.name)}
                        className="flex items-center gap-1 px-3 py-1.5 rounded text-[10px] font-medium bg-purple-600/20 text-purple-300 border border-purple-500/30 hover:bg-purple-600/30 transition-colors shrink-0"
                      >
                        <Download size={10} />
                        Install
                      </button>
                    )}
                  </div>
                );
              })
            )}
          </div>
        )}
      </div>
    </div>
  );
}
