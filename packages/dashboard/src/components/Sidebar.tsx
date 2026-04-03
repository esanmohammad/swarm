import { usePersistedState } from '../hooks/usePersistedState';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  Home, Rocket, BarChart3, Clock, Users as AgentsIcon,
  Wrench, GitPullRequest,
  TrendingUp,
  Layers, BookOpen, Brain,
  ChevronRight, ChevronDown, PanelLeftClose, PanelLeft,
  Sparkles
} from 'lucide-react';

interface NavItem {
  path: string;
  label: string;
  icon: typeof Home;
  badge?: string | number;
  badgeColor?: string;
}

interface NavGroup {
  label: string;
  items: NavItem[];
  defaultOpen?: boolean;
}

const PRIMARY_ITEMS: NavItem[] = [
  { path: '/', label: 'Home', icon: Home },
  { path: '/pipeline', label: 'Pipeline', icon: Rocket },
  { path: '/launch', label: 'Launch', icon: Sparkles },
  { path: '/results', label: 'Results', icon: BarChart3 },
  { path: '/history', label: 'History', icon: Clock },
  { path: '/agents', label: 'Agents', icon: AgentsIcon },
];

// v0.1 navigation — only launch-ready features
const NAV_GROUPS: NavGroup[] = [
  {
    label: 'Workflows',
    defaultOpen: true,
    items: [
      { path: '/workflows', label: 'Overview', icon: Wrench },
      { path: '/workflows/review', label: 'Code Review', icon: GitPullRequest },
    ],
  },
  {
    label: 'Intelligence',
    items: [
      { path: '/intelligence', label: 'Overview', icon: TrendingUp },
      { path: '/intelligence/stats', label: 'Stats', icon: TrendingUp },
    ],
  },
  {
    label: 'Codebase',
    items: [
      { path: '/codebase', label: 'Overview', icon: Layers },
      { path: '/codebase/conventions', label: 'Conventions', icon: BookOpen },
      { path: '/codebase/memory', label: 'Memory', icon: Brain },
    ],
  },
];

function SidebarItem({ item, collapsed }: { item: NavItem; collapsed: boolean }) {
  const location = useLocation();
  const navigate = useNavigate();
  const isActive = location.pathname === item.path;

  return (
    <button
      onClick={() => navigate(item.path)}
      className={`flex items-center gap-2 w-full px-2.5 py-1.5 rounded-md text-xs font-medium font-ui transition-colors ${
        isActive
          ? 'bg-stone-800/60 text-stone-200'
          : 'text-stone-400 hover:text-stone-300 hover:bg-stone-800/30'
      }`}
      title={collapsed ? item.label : undefined}
    >
      <item.icon size={14} className="shrink-0" />
      {!collapsed && (
        <>
          <span className="truncate">{item.label}</span>
          {item.badge != null && (
            <span className={`ml-auto text-[10px] font-medium px-1.5 py-0.5 rounded-full ${
              item.badgeColor || 'bg-stone-800 text-stone-400'
            }`}>
              {item.badge}
            </span>
          )}
        </>
      )}
    </button>
  );
}

function SidebarGroup({ group, collapsed }: { group: NavGroup; collapsed: boolean }) {
  const location = useLocation();
  const navigate = useNavigate();
  const isGroupActive = group.items.some(i => location.pathname === i.path || location.pathname.startsWith(i.path + '/'));
  const [open, setOpen] = usePersistedState(`swarm_sidebar_${group.label}`, group.defaultOpen ?? false);

  // Auto-open group if a child is active
  const effectiveOpen = open || isGroupActive;

  if (collapsed) {
    // In collapsed mode, show the first item's icon as representative
    const firstItem = group.items[0];
    return (
      <div className="px-1 py-0.5">
        <button
          onClick={() => navigate(firstItem.path)}
          className={`flex items-center justify-center w-full p-2 rounded-md text-xs font-ui ${
            isGroupActive ? 'bg-stone-800/60 text-stone-200' : 'text-stone-500 hover:text-stone-400 hover:bg-stone-800/30'
          }`}
          title={group.label}
        >
          <firstItem.icon size={14} />
        </button>
      </div>
    );
  }

  return (
    <div className="px-2">
      <button
        onClick={() => setOpen(!effectiveOpen || !open)}
        className="flex items-center gap-1 w-full px-1 py-1.5 text-xs font-semibold font-ui uppercase tracking-wider text-stone-400 hover:text-stone-300 transition-colors"
      >
        {effectiveOpen ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
        <span>{group.label}</span>
      </button>
      {effectiveOpen && (
        <div className="space-y-1 ml-1 mb-2">
          {group.items.map(item => (
            <SidebarItem key={item.path} item={item} collapsed={false} />
          ))}
        </div>
      )}
    </div>
  );
}

export function Sidebar() {
  const [collapsed, setCollapsed] = usePersistedState('swarm_sidebar_collapsed', false);

  return (
    <aside className={`${collapsed ? 'w-12' : 'w-52'} shrink-0 border-r border-stone-800/50 bg-[#0e0c0b] flex flex-col transition-all duration-200 overflow-hidden`}>
      {/* Header */}
      <div className={`flex items-center ${collapsed ? 'justify-center' : 'justify-between'} px-3 py-3 border-b border-stone-800/40`}>
        {!collapsed && <span className="text-sm font-semibold font-ui tracking-wide text-stone-300">swarm</span>}
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="text-stone-600 hover:text-stone-400 transition-colors p-0.5"
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed ? <PanelLeft size={14} /> : <PanelLeftClose size={14} />}
        </button>
      </div>

      {/* Scrollable nav */}
      <nav className="flex-1 overflow-y-auto py-2 space-y-1 scrollbar-thin">
        {/* Primary items */}
        <div className={`${collapsed ? 'px-1' : 'px-2'} space-y-1 pb-2 border-b border-stone-800/30 mb-2`}>
          {PRIMARY_ITEMS.map(item => (
            <SidebarItem key={item.path} item={item} collapsed={collapsed} />
          ))}
        </div>

        {/* Groups */}
        {NAV_GROUPS.map(group => (
          <SidebarGroup key={group.label} group={group} collapsed={collapsed} />
        ))}
      </nav>

      {/* Footer */}
      {!collapsed && (
        <div className="px-3 py-2 border-t border-stone-800/40 text-xs font-ui text-stone-500">
          <div className="flex items-center justify-between">
            <span>Swarm v0.1.0</span>
          </div>
        </div>
      )}
    </aside>
  );
}
