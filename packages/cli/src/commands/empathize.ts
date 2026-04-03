import { Command } from 'commander';
import chalk from 'chalk';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { requireSwarmDir, loadConfig } from '../core/config.js';
import { UserIntelligence } from '../core/user-intelligence.js';

export function registerEmpathize(program: Command): void {
  const empathize = program
    .command('empathize')
    .description('User intelligence — journey mapping, feedback themes, impact analysis, and improvement suggestions')
    .action(() => {
      let swarmDir: string;
      try {
        swarmDir = requireSwarmDir();
      } catch {
        console.error(chalk.red('No .swarm/ directory found. Run "hivemind init" first.'));
        process.exit(1);
      }

      const intel = new UserIntelligence(swarmDir);
      const state = intel.getState();

      console.log(chalk.bold('\n  User Intelligence Overview\n'));

      // Journeys
      if (state.journeys.length > 0) {
        console.log(chalk.bold('  Mapped Journeys'));
        for (const j of state.journeys.slice(-5)) {
          const satisfaction = j.satisfaction >= 70
            ? chalk.green(`${j.satisfaction}%`)
            : j.satisfaction >= 40
              ? chalk.yellow(`${j.satisfaction}%`)
              : chalk.red(`${j.satisfaction}%`);
          console.log(`    ${chalk.cyan(j.name.padEnd(25))} satisfaction: ${satisfaction}  touchpoints: ${chalk.dim(String(j.touchpoints.length))}  pain points: ${chalk.dim(String(j.painPoints.length))}`);
        }
        console.log('');
      } else {
        console.log(chalk.dim('  No journeys mapped yet. Run: swarm empathize journey "<name>"\n'));
      }

      // Themes
      if (state.themes.length > 0) {
        console.log(chalk.bold('  Feedback Themes'));
        for (const t of state.themes.slice(0, 5)) {
          const sentimentIcon = t.sentiment === 'positive'
            ? chalk.green('+')
            : t.sentiment === 'negative'
              ? chalk.red('-')
              : chalk.dim('~');
          const impactColor = t.impact === 'high' ? chalk.red : t.impact === 'medium' ? chalk.yellow : chalk.dim;
          console.log(`    ${sentimentIcon} ${t.theme.padEnd(35)} occurrences: ${chalk.dim(String(t.occurrences))}  impact: ${impactColor(t.impact)}`);
        }
        console.log('');
      } else {
        console.log(chalk.dim('  No feedback analyzed yet. Run: swarm empathize feedback\n'));
      }

      // Improvements
      if (state.improvements.length > 0) {
        console.log(chalk.bold('  Suggested Improvements'));
        for (const imp of state.improvements.slice(0, 5)) {
          console.log(`    ${chalk.yellow('-')} ${imp}`);
        }
        console.log('');
      }

      if (state.lastAnalyzed > 0) {
        console.log(chalk.dim(`  Last analyzed: ${new Date(state.lastAnalyzed).toLocaleString()}\n`));
      }
    });

  // ── journey ─────────────────────────────────────────────────────────────────

  empathize
    .command('journey <name>')
    .description('Map and analyze a user journey by name')
    .option('--format <format>', 'Output format: table or json', 'table')
    .action((name: string, opts) => {
      let swarmDir: string;
      try {
        swarmDir = requireSwarmDir();
      } catch {
        console.error(chalk.red('No .swarm/ directory found. Run "hivemind init" first.'));
        process.exit(1);
      }

      const intel = new UserIntelligence(swarmDir);
      const journey = intel.analyzeJourney(name);

      if (opts.format === 'json') {
        console.log(JSON.stringify(journey, null, 2));
        return;
      }

      console.log(chalk.bold(`\n  User Journey: "${journey.name}"\n`));

      // Satisfaction
      const satColor = journey.satisfaction >= 70
        ? chalk.green
        : journey.satisfaction >= 40
          ? chalk.yellow
          : chalk.red;
      console.log(`  Satisfaction:  ${satColor(journey.satisfaction + '%')}`);
      console.log(`  Touchpoints:   ${chalk.dim(String(journey.touchpoints.length))}`);
      console.log('');

      // Touchpoints timeline
      if (journey.touchpoints.length > 0) {
        console.log(chalk.bold('  Touchpoints'));
        const recent = journey.touchpoints.slice(-10);
        for (const tp of recent) {
          const statusColor = tp.status === 'completed'
            ? chalk.green
            : tp.status === 'failed'
              ? chalk.red
              : chalk.yellow;
          const date = new Date(tp.timestamp).toLocaleDateString();
          console.log(`    ${chalk.dim(date)}  ${tp.stage.padEnd(12)} ${statusColor(tp.status.padEnd(12))} ${chalk.dim(tp.sentiment)}`);
        }
        console.log('');
      }

      // Pain points
      if (journey.painPoints.length > 0) {
        console.log(chalk.bold('  Pain Points'));
        for (const pp of journey.painPoints) {
          console.log(`    ${chalk.red('-')} ${pp}`);
        }
        console.log('');
      }

      // Drop-off points
      if (journey.dropOffPoints.length > 0) {
        console.log(chalk.bold('  Drop-off Points'));
        for (const dp of journey.dropOffPoints) {
          console.log(`    ${chalk.yellow('-')} ${dp}`);
        }
        console.log('');
      }

      console.log(chalk.dim(`  Analyzed at ${new Date(journey.analyzedAt).toLocaleString()}`));
      console.log(chalk.dim('  Saved to .swarm/empathize-state.json\n'));
    });

  // ── feedback ────────────────────────────────────────────────────────────────

  empathize
    .command('feedback')
    .description('Analyze user feedback themes from pipeline history and audit logs')
    .option('--format <format>', 'Output format: table or json', 'table')
    .action((opts) => {
      let swarmDir: string;
      try {
        swarmDir = requireSwarmDir();
      } catch {
        console.error(chalk.red('No .swarm/ directory found. Run "hivemind init" first.'));
        process.exit(1);
      }

      const intel = new UserIntelligence(swarmDir);
      const themes = intel.analyzeFeedback();

      if (opts.format === 'json') {
        console.log(JSON.stringify(themes, null, 2));
        return;
      }

      console.log(chalk.bold('\n  Feedback Theme Analysis\n'));

      if (themes.length === 0) {
        console.log(chalk.dim('  No significant themes found. Run more pipelines to generate data.\n'));
        return;
      }

      for (const t of themes) {
        const sentimentColor = t.sentiment === 'positive'
          ? chalk.green
          : t.sentiment === 'negative'
            ? chalk.red
            : chalk.dim;
        const impactColor = t.impact === 'high' ? chalk.red : t.impact === 'medium' ? chalk.yellow : chalk.dim;

        console.log(`  ${sentimentColor(t.sentiment === 'positive' ? '+' : t.sentiment === 'negative' ? '-' : '~')} ${chalk.bold(t.theme)}`);
        console.log(`    Occurrences: ${chalk.dim(String(t.occurrences))}  Impact: ${impactColor(t.impact)}  Sources: ${chalk.dim(t.sources.join(', '))}`);
        console.log(`    First seen: ${chalk.dim(new Date(t.firstSeen).toLocaleDateString())}  Last seen: ${chalk.dim(new Date(t.lastSeen).toLocaleDateString())}`);
        console.log('');
      }

      console.log(chalk.dim(`  ${themes.length} themes identified.`));
      console.log(chalk.dim('  Saved to .swarm/empathize-state.json\n'));
    });

  // ── impact ──────────────────────────────────────────────────────────────────

  empathize
    .command('impact <feature>')
    .description('Assess user impact for a feature or change')
    .option('--format <format>', 'Output format: table or json', 'table')
    .action((feature: string, opts) => {
      let swarmDir: string;
      try {
        swarmDir = requireSwarmDir();
      } catch {
        console.error(chalk.red('No .swarm/ directory found. Run "hivemind init" first.'));
        process.exit(1);
      }

      const intel = new UserIntelligence(swarmDir);
      const assessment = intel.assessImpact(feature);

      if (opts.format === 'json') {
        console.log(JSON.stringify(assessment, null, 2));
        return;
      }

      console.log(chalk.bold(`\n  User Impact Assessment\n`));
      console.log(`  Feature:    ${chalk.cyan(`"${assessment.feature}"`)}`);

      const riskColor = assessment.riskLevel === 'high' ? chalk.red : assessment.riskLevel === 'medium' ? chalk.yellow : chalk.green;
      console.log(`  Risk level: ${riskColor(assessment.riskLevel)}`);
      console.log(`  Adoption:   ${chalk.yellow(assessment.adoptionEstimate + '%')} estimated`);
      console.log(`  Confidence: ${chalk.dim(assessment.confidence + '%')}`);
      console.log('');

      // User segments
      console.log(chalk.bold('  Affected User Segments'));
      for (const seg of assessment.userSegments) {
        const impactColor = seg.impact === 'high' ? chalk.red : seg.impact === 'medium' ? chalk.yellow : chalk.dim;
        console.log(`    ${impactColor(seg.impact.padEnd(8))} ${chalk.cyan(seg.segment)}`);
      }
      console.log('');

      // Recommendations
      console.log(chalk.bold('  Recommendations'));
      for (const rec of assessment.recommendations) {
        console.log(`    ${chalk.yellow('-')} ${rec}`);
      }
      console.log('');
    });

  // ── suggest ─────────────────────────────────────────────────────────────────

  empathize
    .command('suggest')
    .description('Suggest high-impact user experience improvements')
    .option('--format <format>', 'Output format: table or json', 'table')
    .action((opts) => {
      let swarmDir: string;
      try {
        swarmDir = requireSwarmDir();
      } catch {
        console.error(chalk.red('No .swarm/ directory found. Run "hivemind init" first.'));
        process.exit(1);
      }

      const intel = new UserIntelligence(swarmDir);
      const suggestions = intel.suggestImprovements();

      if (opts.format === 'json') {
        console.log(JSON.stringify(suggestions, null, 2));
        return;
      }

      console.log(chalk.bold('\n  Improvement Suggestions\n'));

      if (suggestions.length === 0) {
        console.log(chalk.dim('  No suggestions available. Run more pipelines to generate data.\n'));
        return;
      }

      for (const s of suggestions) {
        const priorityColor = s.priority === 'high' ? chalk.red : s.priority === 'medium' ? chalk.yellow : chalk.dim;
        const catColor = {
          usability: chalk.blue,
          reliability: chalk.red,
          performance: chalk.yellow,
          'feature-gap': chalk.cyan,
        }[s.category] || chalk.dim;

        console.log(`  ${priorityColor(s.priority.toUpperCase().padEnd(8))} ${chalk.bold(s.title)}`);
        console.log(`           Category: ${catColor(s.category)}`);
        console.log(`           Rationale: ${chalk.dim(s.rationale)}`);
        console.log(`           Impact: ${chalk.dim(s.estimatedImpact)}`);
        console.log('');
      }

      console.log(chalk.dim(`  ${suggestions.length} suggestions generated.`));
      console.log(chalk.dim('  Saved to .swarm/empathize-state.json\n'));
    });
}
