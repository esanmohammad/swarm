import { createBrowserRouter, Navigate } from 'react-router-dom';
import { MainLayout } from './layouts/MainLayout';

// Hub pages (simple, no props needed)
import { WorkflowsHub } from './views/hubs/WorkflowsHub';
import { IntelligenceHub } from './views/hubs/IntelligenceHub';
import { CodebaseHub } from './views/hubs/CodebaseHub';
import { PlanningHub } from './views/hubs/PlanningHub';
import { QualityHub } from './views/hubs/QualityHub';
import { TeamHub } from './views/hubs/TeamHub';
import { OperationsHub } from './views/hubs/OperationsHub';
import { AdvancedHub } from './views/hubs/AdvancedHub';

// Routed view wrappers (pull data from WebSocket context)
import {
  RoutedHome, RoutedPipeline, RoutedLaunch, RoutedResults, RoutedHistory,
  RoutedAgents, RoutedConventions, RoutedMemory, RoutedReviews, RoutedWatch,
  RoutedExplain, RoutedStats, RoutedDeploy, RoutedMigrate, RoutedAutopilot,
  RoutedSecurity, RoutedDeps, RoutedIncident, RoutedHealth, RoutedBenchmark,
  RoutedInbox, RoutedStandup, RoutedJournal, RoutedScope, RoutedContext,
  RoutedPair, RoutedDelegate, RoutedReport, RoutedRetro,
  RoutedSurfaces, RoutedArchReview, RoutedOnboard, RoutedRoadmap,
  RoutedSystem, RoutedSlo, RoutedDebt, RoutedForecast, RoutedCompliance,
  RoutedPlugins,
  RoutedModelSettings,
} from './views/routed';

export const router = createBrowserRouter([
  {
    path: '/',
    element: <MainLayout />,
    children: [
      // Home — command center
      { index: true, element: <RoutedHome /> },

      // Pipeline & core
      { path: 'pipeline', element: <RoutedPipeline /> },
      { path: 'launch', element: <RoutedLaunch /> },
      { path: 'results', element: <RoutedResults /> },
      { path: 'history', element: <RoutedHistory /> },
      { path: 'agents', element: <RoutedAgents /> },

      // Workflows
      { path: 'workflows', element: <WorkflowsHub /> },
      { path: 'workflows/review', element: <RoutedReviews /> },
      { path: 'workflows/autopilot', element: <RoutedAutopilot /> },
      { path: 'workflows/inbox', element: <RoutedInbox /> },
      { path: 'workflows/delegate', element: <RoutedDelegate /> },
      { path: 'workflows/watch', element: <RoutedWatch /> },

      // Intelligence
      { path: 'intelligence', element: <IntelligenceHub /> },
      { path: 'intelligence/stats', element: <RoutedStats /> },
      { path: 'intelligence/health', element: <RoutedHealth /> },
      { path: 'intelligence/forecast', element: <RoutedForecast /> },
      { path: 'intelligence/benchmark', element: <RoutedBenchmark /> },
      { path: 'intelligence/report', element: <RoutedReport /> },

      // Codebase
      { path: 'codebase', element: <CodebaseHub /> },
      { path: 'codebase/context', element: <RoutedContext /> },
      { path: 'codebase/explain', element: <RoutedExplain /> },
      { path: 'codebase/conventions', element: <RoutedConventions /> },
      { path: 'codebase/memory', element: <RoutedMemory /> },
      { path: 'codebase/system', element: <RoutedSystem /> },

      // Planning
      { path: 'planning', element: <PlanningHub /> },
      { path: 'planning/roadmap', element: <RoutedRoadmap /> },
      { path: 'planning/scope', element: <RoutedScope /> },

      // Quality
      { path: 'quality', element: <QualityHub /> },
      { path: 'quality/slo', element: <RoutedSlo /> },
      { path: 'quality/debt', element: <RoutedDebt /> },
      { path: 'quality/security', element: <RoutedSecurity /> },
      { path: 'quality/compliance', element: <RoutedCompliance /> },
      { path: 'quality/architecture', element: <RoutedArchReview /> },

      // Team
      { path: 'team', element: <TeamHub /> },
      { path: 'team/standup', element: <RoutedStandup /> },
      { path: 'team/journal', element: <RoutedJournal /> },
      { path: 'team/retro', element: <RoutedRetro /> },
      { path: 'team/report', element: <RoutedReport /> },
      { path: 'team/pair', element: <RoutedPair /> },

      // Operations
      { path: 'operations', element: <OperationsHub /> },
      { path: 'operations/deploy', element: <RoutedDeploy /> },
      { path: 'operations/migrate', element: <RoutedMigrate /> },
      { path: 'operations/deps', element: <RoutedDeps /> },
      { path: 'operations/incident', element: <RoutedIncident /> },

      // Advanced
      { path: 'advanced', element: <AdvancedHub /> },
      { path: 'advanced/plugins', element: <RoutedPlugins /> },
      { path: 'advanced/surfaces', element: <RoutedSurfaces /> },

      // Settings
      { path: 'settings/onboard', element: <RoutedOnboard /> },
      { path: 'settings/models', element: <RoutedModelSettings /> },

      // Catch-all — redirect to home
      { path: '*', element: <Navigate to="/" replace /> },
    ],
  },
]);
