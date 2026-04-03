#!/usr/bin/env node

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { Command } from 'commander';
import chalk from 'chalk';
import { registerInit } from '../src/commands/init.js';
import { registerAnalyze } from '../src/commands/analyze.js';
import { registerArchitect } from '../src/commands/architect.js';
import { registerPlan } from '../src/commands/plan.js';
import { registerBuild } from '../src/commands/build.js';
import { registerTest } from '../src/commands/test.js';
import { registerEvaluate } from '../src/commands/evaluate.js';
import { registerStatus } from '../src/commands/status.js';
import { registerAgent } from '../src/commands/agent.js';
import { registerDashboard } from '../src/commands/dashboard.js';
import { registerMayday } from '../src/commands/mayday.js';
import { registerDoctor } from '../src/commands/doctor.js';
import { registerRecover } from '../src/commands/recover.js';
import { registerAudit } from '../src/commands/audit.js';
import { registerPlugin } from '../src/commands/plugin.js';
import { registerTelemetry } from '../src/commands/telemetry.js';
import { registerPipeline } from '../src/commands/pipeline.js';
import { registerFix } from '../src/commands/fix.js';
import { registerSpike } from '../src/commands/spike.js';
import { registerReview } from '../src/commands/review.js';
import { registerRefactor } from '../src/commands/refactor.js';
import { registerSimplify } from '../src/commands/simplify.js';
import { registerTestGen } from '../src/commands/test-gen.js';
import { registerCi } from '../src/commands/ci.js';
import { registerLearn } from '../src/commands/learn.js';
import { registerMemory } from '../src/commands/memory.js';
import { registerBabysitPrs } from '../src/commands/babysit-prs.js';
import { registerWatch } from '../src/commands/watch.js';
import { registerExplain } from '../src/commands/explain.js';
import { registerStats } from '../src/commands/stats.js';
import { registerDeploy } from '../src/commands/deploy.js';
import { registerMigrate } from '../src/commands/migrate.js';
import { registerServer } from '../src/commands/server.js';
import { registerAutopilot } from '../src/commands/autopilot.js';
import { registerDeps } from '../src/commands/deps.js';
import { registerRisk } from '../src/commands/risk.js';
import { registerPm } from '../src/commands/pm.js';
import { registerIncident } from '../src/commands/incident.js';
import { registerPr } from '../src/commands/pr.js';
import { registerHealth } from '../src/commands/health.js';
import { registerBenchmark } from '../src/commands/benchmark.js';
import { registerMultiRepo } from '../src/commands/multi-repo.js';
import { registerSecure } from '../src/commands/secure.js';
import { registerSecrets } from '../src/commands/secrets.js';
import { registerProvenance } from '../src/commands/provenance.js';
import { registerSupplyChain } from '../src/commands/supply-chain.js';
import { registerSandbox } from '../src/commands/sandbox.js';
import { registerPromptGuard } from '../src/commands/prompt-guard.js';
import { registerFingerprint } from '../src/commands/fingerprint.js';
import { registerRuntimeMonitor } from '../src/commands/runtime-monitor.js';
import { registerInbox } from '../src/commands/inbox.js';
import { registerStandup } from '../src/commands/standup.js';
import { registerJournal } from '../src/commands/journal.js';
import { registerScope } from '../src/commands/scope.js';
import { registerContext } from '../src/commands/context.js';
import { registerPair } from '../src/commands/pair.js';
import { registerDelegate } from '../src/commands/delegate.js';
import { registerReport } from '../src/commands/report.js';
import { registerTeam } from '../src/commands/team.js';
import { registerRetro } from '../src/commands/retro.js';
import { registerOwn } from '../src/commands/own.js';
import { registerArchitectReview } from '../src/commands/architect-review.js';
import { registerOnboard } from '../src/commands/onboard.js';
import { registerMentor } from '../src/commands/mentor.js';
import { registerRoadmap } from '../src/commands/roadmap.js';
import { registerSystem } from '../src/commands/system.js';
import { registerSlo } from '../src/commands/slo.js';
import { registerEvolve } from '../src/commands/evolve.js';
import { registerForecast } from '../src/commands/forecast.js';
import { registerCompliance } from '../src/commands/compliance.js';
import { registerObserve } from '../src/commands/observe.js';
import { registerExperiment } from '../src/commands/experiment.js';
import { registerImprove } from '../src/commands/improve.js';
import { registerOptimize } from '../src/commands/optimize.js';
import { registerImpact } from '../src/commands/impact.js';
import { registerFleet } from '../src/commands/fleet.js';
import { registerContract } from '../src/commands/contract.js';
import { registerSimulate } from '../src/commands/simulate.js';
import { registerTeach } from '../src/commands/teach.js';
import { registerNegotiate } from '../src/commands/negotiate.js';
import { registerSpecialize } from '../src/commands/specialize.js';
import { registerGovern } from '../src/commands/govern.js';
import { registerEmpathize } from '../src/commands/empathize.js';
import { registerAllocate } from '../src/commands/allocate.js';
import { registerCompete } from '../src/commands/compete.js';
import { registerSpawnCapability } from '../src/commands/spawn-capability.js';
import { registerFederate } from '../src/commands/federate.js';
import { registerModels } from '../src/commands/models.js';
import { registerCheck } from '../src/commands/check.js';
import { autoDetectStack, autoInit, loadConfig } from '../src/core/config.js';
import { createContext } from '../src/commands/shared.js';

const program = new Command();

// Check if --all flag was passed for extended help
const showAll = process.argv.includes('--all');

program
  .name('hivemind')
  .description('AI builds your feature while you watch')
  .version('0.1.0')
  .argument('[feature-request]', 'Describe what to build — runs the full pipeline automatically')
  .action(async (featureRequest: string | undefined) => {
    // Only trigger when a feature-request string is provided and no subcommand matched
    if (!featureRequest) return;

    const cwd = process.cwd();
    const swarmDir = join(cwd, '.swarm');
    const stack = autoDetectStack(cwd);

    // Auto-init if .swarm/ doesn't exist
    if (!existsSync(swarmDir)) {
      const projectName = cwd.split('/').pop() || 'my-project';
      console.log(chalk.yellow(`No .swarm/ found — auto-initializing (stack: ${stack})...`));
      autoInit(projectName, stack, cwd);
      console.log(chalk.green(`Initialized .swarm/ for "${projectName}"`));
    }

    const config = loadConfig(cwd);
    const { pipeline, cleanup } = createContext(swarmDir, config);

    try {
      await pipeline.runMayday(featureRequest, {
        stack,
        maxIterations: 5,
        parallel: 3,
        maxFixBudgetUsd: 15,
      });
    } catch (err) {
      console.error(chalk.red(err instanceof Error ? err.message : String(err)));
      process.exit(1);
    } finally {
      cleanup();
    }
  });

// --- Primary commands (always visible) ---
registerInit(program);
registerMayday(program);
registerDashboard(program);
registerStatus(program);
registerDoctor(program);

// --- Pipeline stage commands (always visible) ---
registerAnalyze(program);
registerArchitect(program);
registerPlan(program);
registerBuild(program);
registerTest(program);

// --- Preset commands (quick workflows) ---
registerFix(program);
registerSpike(program);
registerReview(program);
registerRefactor(program);
registerSimplify(program);

// --- Test generation ---
registerTestGen(program);

// --- CI mode ---
registerCi(program);

// --- Convention learning ---
registerLearn(program);

// --- Cross-run memory ---
registerMemory(program);

// --- PR babysitter ---
registerBabysitPrs(program);

// --- File watcher ---
registerWatch(program);

// --- Codebase explainer ---
registerExplain(program);

// --- Cost stats ---
registerStats(program);

// --- Deploy, migrate, server ---
registerDeploy(program);
registerMigrate(program);
registerServer(program);

// --- Autopilot (issue-to-PR automation) ---
registerAutopilot(program);

// --- Dependency management ---
registerDeps(program);

// --- Risk scoring ---
registerRisk(program);

// --- Incident response ---
registerIncident(program);
registerPr(program);

// --- Codebase health monitor ---
registerHealth(program);

// --- Benchmark / perf regression ---
registerBenchmark(program);

// --- Multi-repo orchestration ---
registerMultiRepo(program);

// --- Security scanner ---
registerSecure(program);

// --- Supply chain attack prevention ---
registerSupplyChain(program);

// --- Code provenance & audit trail ---
registerProvenance(program);

// --- Sandboxed code execution ---
registerSandbox(program);

// --- Secret detection & prevention ---
registerSecrets(program);

// --- PM integration ---
registerPm(program);

// --- Prompt injection defense ---
registerPromptGuard(program);

// --- AI code fingerprinting ---
registerFingerprint(program);

// --- Runtime security monitoring ---
registerRuntimeMonitor(program);

// --- Wave 3: Autonomous Employee ---
registerInbox(program);
registerStandup(program);
registerJournal(program);
registerScope(program);
registerContext(program);
registerPair(program);
registerDelegate(program);
registerReport(program);
registerTeam(program);
registerRetro(program);

// --- Wave 4: Autonomous Engineering Organization ---
registerOwn(program);
registerArchitectReview(program);
registerOnboard(program);
registerMentor(program);
registerRoadmap(program);
registerSystem(program);
registerSlo(program);
registerEvolve(program);
registerForecast(program);
registerCompliance(program);

// --- Wave 5: Product-Aware Engineering Intelligence ---
registerObserve(program);
registerExperiment(program);
registerImprove(program);
registerOptimize(program);
registerImpact(program);
registerFleet(program);
registerContract(program);
registerSimulate(program);
registerTeach(program);

// --- Wave 6: Autonomous Engineering Company ---
registerNegotiate(program);
registerSpecialize(program);
registerGovern(program);
registerEmpathize(program);
registerAllocate(program);
registerCompete(program);
registerSpawnCapability(program);
registerFederate(program);

// --- Wave 8: Multi-LLM Architecture ---
registerModels(program);

// --- Pipeline management ---
registerPipeline(program);

// --- Guardrail checks ---
registerCheck(program);

// --- Advanced commands ---
const advancedCommands = [registerEvaluate, registerAgent, registerRecover, registerAudit, registerPlugin, registerTelemetry];
for (const register of advancedCommands) {
  register(program);
}

// v0.1 launch set — all other commands are registered but hidden from help
const V01_COMMANDS = new Set([
  'mayday', 'analyze', 'architect', 'plan', 'build', 'test',
  'fix', 'review', 'pr', 'refactor', 'simplify', 'spike', 'test-gen', 'learn',
  'init', 'doctor', 'status', 'stats', 'memory', 'dashboard', 'check',
]);

if (!showAll) {
  for (const cmd of program.commands) {
    if (!V01_COMMANDS.has(cmd.name())) {
      (cmd as unknown as { _hidden: boolean })._hidden = true;
    }
  }
}

// Override help to add usage examples
program.addHelpText('after', () => {
  const visible = program.commands.filter(c => !(c as unknown as { _hidden: boolean })._hidden).length;
  const total = program.commands.length;
  const lines = [
    '',
    chalk.bold('Quick start:'),
    `  ${chalk.cyan('hivemind "add a login page"')}           Full pipeline end-to-end`,
    `  ${chalk.cyan('hivemind fix "login not working"')}      Fix a bug directly`,
    `  ${chalk.cyan('hivemind review')}                       Review staged changes`,
    `  ${chalk.cyan('hivemind pr --reviewers --risk')}        Smart PR with risk scores`,
    `  ${chalk.cyan('hivemind spike "how does auth work?"')}  Quick exploration`,
    `  ${chalk.cyan('hivemind dashboard')}                    Real-time web UI`,
  ];
  if (!showAll) {
    lines.push('', chalk.dim(`  Showing ${visible} commands. Run ${chalk.cyan('hivemind --help --all')} to see all ${total}.`));
  }
  return lines.join('\n');
});

program.parse();
