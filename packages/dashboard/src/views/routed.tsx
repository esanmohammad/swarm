/**
 * Router wrapper components.
 * Each wrapper pulls data from WebSocketContext and passes it as props
 * to the existing view components (which still accept props).
 * This avoids rewriting every view at once.
 */
import { useState } from 'react';
import { useWs } from '../context/WebSocketContext';
import { useOnboarding } from '../hooks/useOnboarding';

// Views
import { HomeView } from './HomeView';
import { PipelineView } from './PipelineView';
import { LaunchView } from './LaunchView';
import { ResultsView } from './ResultsView';
import { HistoryView } from '../components/HistoryView';
import { AgentsView } from './AgentsView';
import { ConventionsView } from './ConventionsView';
import { MemoryView } from './MemoryView';
import { PRReviewsView } from './PRReviewsView';
import { WatchView } from './WatchView';
import { ExplainView } from './ExplainView';
import { StatsView } from './StatsView';
import { DeployView } from './DeployView';
import { MigrateView } from './MigrateView';
import { AutopilotView } from './AutopilotView';
import { SecurityView } from './SecurityView';
import { DepsView } from './DepsView';
import { IncidentView } from './IncidentView';
import { HealthView } from './HealthView';
import { BenchmarkView } from './BenchmarkView';
import { InboxView } from './InboxView';
import { StandupView } from './StandupView';
import { JournalView } from './JournalView';
import { ScopeView } from './ScopeView';
import { ContextView } from './ContextView';
import { PairView } from './PairView';
import { DelegateView } from './DelegateView';
import { ReportView } from './ReportView';
import { TeamView } from './TeamView';
import { RetroView } from './RetroView';
import { SurfacesView } from './SurfacesView';
import { ArchReviewView } from './ArchReviewView';
import { OnboardView } from './OnboardView';
import { RoadmapView } from './RoadmapView';
import { SystemView } from './SystemView';
import { SloView } from './SloView';
import { DebtView } from './DebtView';
import { ForecastView } from './ForecastView';
import { ComplianceView } from './ComplianceView';
import { PluginsView } from './PluginsView';
import { ModelSettingsView } from './ModelSettingsView';
import { SpawnDialog } from '../components/SpawnDialog';

// --- Home ---
export function RoutedHome() {
  const { state, sendCommand, agentOutputs, agentActivities, historyEntries } = useWs();
  return (
    <HomeView
      sendCommand={sendCommand}
      state={state}
      agentOutputs={agentOutputs}
      agentActivities={agentActivities}
      historyEntries={historyEntries}
    />
  );
}

// --- Pipeline ---
export function RoutedPipeline() {
  const { state, sendCommand, agentOutputs, agentActivities, violations, artifactContent } = useWs();
  const { currentStep, advanceStep, completeOnboarding } = useOnboarding();
  if (!state) return null;
  return (
    <PipelineView
      pipeline={state}
      sendCommand={sendCommand}
      agentOutputs={agentOutputs}
      agentActivities={agentActivities}
      violations={violations}
      artifactContent={artifactContent}
      onboardingStep={currentStep}
      onDismissOnboarding={() => {
        if (currentStep === 'done') completeOnboarding();
        else advanceStep(null);
      }}
    />
  );
}

// --- Launch ---
export function RoutedLaunch() {
  const { sendCommand, historyEntries } = useWs();
  // LaunchView expects onNavigate with specific views, but we're using router now.
  // We'll use a no-op or redirect approach.
  return (
    <LaunchView
      sendCommand={sendCommand}
      historyEntries={historyEntries}
      onNavigate={() => {}}
    />
  );
}

// --- Results ---
export function RoutedResults() {
  const { state, agentActivities } = useWs();
  if (!state) return null;
  return (
    <ResultsView
      pipeline={state}
      agentActivities={agentActivities}
      onNavigate={() => {}}
    />
  );
}

// --- History ---
export function RoutedHistory() {
  const { historyEntries, sendCommand } = useWs();
  return <HistoryView entries={historyEntries} sendCommand={sendCommand} />;
}

// --- Agents ---
export function RoutedAgents() {
  const { state, agentOutputs, sendCommand } = useWs();
  const [showSpawn, setShowSpawn] = useState(false);
  if (!state) return null;
  return (
    <>
      <AgentsView
        agents={state.agents}
        agentOutputs={agentOutputs}
        sendCommand={sendCommand}
        onSpawnAgent={() => setShowSpawn(true)}
      />
      {showSpawn && <SpawnDialog onSpawn={sendCommand} onClose={() => setShowSpawn(false)} />}
    </>
  );
}

// --- Conventions ---
export function RoutedConventions() {
  const { sendCommand, conventions, conventionsLoading } = useWs();
  return <ConventionsView sendCommand={sendCommand} conventions={conventions} conventionsLoading={conventionsLoading} />;
}

// --- Memory ---
export function RoutedMemory() {
  const { sendCommand, memories } = useWs();
  return <MemoryView sendCommand={sendCommand} memories={memories} />;
}

// --- PR Reviews ---
export function RoutedReviews() {
  const { sendCommand, prReviews, state, agentOutputs, agentActivities } = useWs();
  return (
    <PRReviewsView
      sendCommand={sendCommand}
      reviews={prReviews}
      agents={state?.agents}
      agentOutputs={agentOutputs}
      agentActivities={agentActivities}
    />
  );
}

// --- Watch ---
export function RoutedWatch() {
  const { sendCommand, watchResults } = useWs();
  return <WatchView sendCommand={sendCommand} watchResults={watchResults} />;
}

// --- Explain ---
export function RoutedExplain() {
  const { sendCommand, state, agentOutputs } = useWs();
  if (!state) return null;
  return <ExplainView sendCommand={sendCommand} agents={state.agents} agentOutputs={agentOutputs} />;
}

// --- Stats ---
export function RoutedStats() {
  const { sendCommand, stats } = useWs();
  return <StatsView sendCommand={sendCommand} stats={stats} />;
}

// --- Deploy ---
export function RoutedDeploy() {
  const { sendCommand, deployResult } = useWs();
  return <DeployView sendCommand={sendCommand} deployResult={deployResult} />;
}

// --- Migrate ---
export function RoutedMigrate() {
  const { sendCommand, state, agentOutputs } = useWs();
  if (!state) return null;
  return <MigrateView sendCommand={sendCommand} agents={state.agents} agentOutputs={agentOutputs} />;
}

// --- Autopilot ---
export function RoutedAutopilot() {
  const { sendCommand, autopilotState } = useWs();
  return <AutopilotView sendCommand={sendCommand} autopilotState={autopilotState} />;
}

// --- Security ---
export function RoutedSecurity() {
  const { sendCommand } = useWs();
  return <SecurityView sendCommand={sendCommand} />;
}

// --- Dependencies ---
export function RoutedDeps() {
  const { sendCommand } = useWs();
  return <DepsView sendCommand={sendCommand} />;
}

// --- Incident ---
export function RoutedIncident() {
  const { sendCommand } = useWs();
  return <IncidentView sendCommand={sendCommand} />;
}

// --- Health ---
export function RoutedHealth() {
  const { sendCommand, healthReport } = useWs();
  return <HealthView sendCommand={sendCommand} healthReport={healthReport} />;
}

// --- Benchmark ---
export function RoutedBenchmark() {
  const { sendCommand } = useWs();
  return <BenchmarkView sendCommand={sendCommand} />;
}

// --- Inbox ---
export function RoutedInbox() {
  const { sendCommand, inboxState } = useWs();
  return <InboxView sendCommand={sendCommand} inboxState={inboxState} />;
}

// --- Standup ---
export function RoutedStandup() {
  const { sendCommand, standupReport } = useWs();
  return <StandupView sendCommand={sendCommand} standupReport={standupReport} />;
}

// --- Journal ---
export function RoutedJournal() {
  const { sendCommand, journalData } = useWs();
  return <JournalView sendCommand={sendCommand} journalData={journalData} />;
}

// --- Scope ---
export function RoutedScope() {
  const { sendCommand, scopeAnalysis } = useWs();
  return <ScopeView sendCommand={sendCommand} scopeAnalysis={scopeAnalysis} />;
}

// --- Context ---
export function RoutedContext() {
  const { sendCommand, contextIndex } = useWs();
  return <ContextView sendCommand={sendCommand} contextIndex={contextIndex} />;
}

// --- Pair ---
export function RoutedPair() {
  const { sendCommand, pairSession } = useWs();
  return <PairView sendCommand={sendCommand} pairSession={pairSession} />;
}

// --- Delegate ---
export function RoutedDelegate() {
  const { sendCommand, delegateState } = useWs();
  return <DelegateView sendCommand={sendCommand} delegateState={delegateState} />;
}

// --- Report ---
export function RoutedReport() {
  const { sendCommand, reportData } = useWs();
  return <ReportView sendCommand={sendCommand} reportData={reportData} />;
}

// --- Team ---
export function RoutedTeam() {
  const { sendCommand, teamActivity } = useWs();
  return <TeamView sendCommand={sendCommand} teamActivity={teamActivity} />;
}

// --- Retro ---
export function RoutedRetro() {
  const { sendCommand, retroReport } = useWs();
  return <RetroView sendCommand={sendCommand} retroReport={retroReport} />;
}

// --- Surfaces ---
export function RoutedSurfaces() {
  const { sendCommand, surfacesState } = useWs();
  return <SurfacesView sendCommand={sendCommand} surfacesState={surfacesState} />;
}

// --- Architecture Review ---
export function RoutedArchReview() {
  const { sendCommand, archReview } = useWs();
  return <ArchReviewView sendCommand={sendCommand} archReview={archReview} />;
}

// --- Onboard ---
export function RoutedOnboard() {
  const { sendCommand, onboardData } = useWs();
  return <OnboardView sendCommand={sendCommand} onboardData={onboardData} />;
}

// --- Roadmap ---
export function RoutedRoadmap() {
  const { sendCommand, roadmapData } = useWs();
  return <RoadmapView sendCommand={sendCommand} roadmapData={roadmapData} />;
}

// --- System ---
export function RoutedSystem() {
  const { sendCommand, systemGraph } = useWs();
  return <SystemView sendCommand={sendCommand} systemGraph={systemGraph} />;
}

// --- SLO ---
export function RoutedSlo() {
  const { sendCommand, sloData } = useWs();
  return <SloView sendCommand={sendCommand} sloData={sloData} />;
}

// --- Debt ---
export function RoutedDebt() {
  const { sendCommand, debtData } = useWs();
  return <DebtView sendCommand={sendCommand} debtData={debtData} />;
}

// --- Forecast ---
export function RoutedForecast() {
  const { sendCommand, forecastData } = useWs();
  return <ForecastView sendCommand={sendCommand} forecastData={forecastData} />;
}

// --- Compliance ---
export function RoutedCompliance() {
  const { sendCommand, complianceData } = useWs();
  return <ComplianceView sendCommand={sendCommand} complianceData={complianceData} />;
}

// --- Plugins ---
export function RoutedPlugins() {
  const { sendCommand, pluginRegistry } = useWs();
  return <PluginsView sendCommand={sendCommand} pluginRegistry={pluginRegistry} />;
}

// --- Model Settings ---
export function RoutedModelSettings() {
  const { sendCommand, modelConfig, availableModels, providerStatus } = useWs();
  return (
    <ModelSettingsView
      sendCommand={sendCommand}
      modelConfig={modelConfig ?? null}
      availableModels={availableModels ?? null}
      providerStatus={providerStatus ?? null}
    />
  );
}
