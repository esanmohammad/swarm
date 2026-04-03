export interface FeatureGuideData {
  title: string;
  description: string;
  setupSteps?: Array<{ label: string; command?: string }>;
  cliCommands?: Array<{ command: string; description: string }>;
}

export const featureGuides: Record<string, FeatureGuideData> = {
  stats: {
    title: 'Cost Intelligence',
    description: 'Track spending across pipeline runs, identify cost trends, and get optimization recommendations.',
    cliCommands: [
      { command: 'swarm stats', description: 'View cost breakdown' },
      { command: 'swarm stats --period 7', description: 'Last 7 days' },
    ],
  },
  health: {
    title: 'Codebase Health',
    description: 'Analyze test coverage, dependency freshness, code quality metrics, and CI reliability in one score.',
    setupSteps: [
      { label: 'Run your first health check', command: 'swarm health' },
    ],
    cliCommands: [
      { command: 'swarm health', description: 'Run health check' },
      { command: 'swarm health --format json', description: 'JSON output' },
    ],
  },
  reviews: {
    title: 'PR Reviews',
    description: 'Automated code reviews powered by AI. Reviews PRs, posts comments to GitHub, and optionally auto-approves.',
    setupSteps: [
      { label: 'Ensure GitHub CLI is installed', command: 'gh auth status' },
      { label: 'Review a PR', command: 'swarm review <pr-number>' },
    ],
    cliCommands: [
      { command: 'swarm review', description: 'Review current changes' },
      { command: 'swarm babysit-prs --label swarm', description: 'Watch for PRs to review' },
    ],
  },
  autopilot: {
    title: 'Autopilot',
    description: 'Watches GitHub issues with a specific label and automatically creates PRs. Zero-touch issue-to-PR automation.',
    setupSteps: [
      { label: 'Ensure GitHub CLI is authenticated', command: 'gh auth status' },
      { label: 'Start autopilot', command: 'swarm autopilot start --label swarm' },
    ],
    cliCommands: [
      { command: 'swarm autopilot start', description: 'Start the daemon' },
      { command: 'swarm autopilot stop', description: 'Stop the daemon' },
      { command: 'swarm autopilot status', description: 'View status' },
    ],
  },
  deploy: {
    title: 'Deploy',
    description: 'AI-assisted deployments with pre-flight checks, rollback support, and step-by-step execution visibility.',
    setupSteps: [
      { label: 'Configure deployment in .swarm/deploy.yaml', command: 'swarm deploy --help' },
    ],
    cliCommands: [
      { command: 'swarm deploy staging', description: 'Deploy to staging' },
      { command: 'swarm deploy production', description: 'Deploy to production' },
    ],
  },
  security: {
    title: 'Security',
    description: 'Scan your codebase for vulnerabilities, secret leaks, and supply chain risks.',
    cliCommands: [
      { command: 'swarm secure', description: 'Run security scan' },
      { command: 'swarm secrets', description: 'Check for leaked secrets' },
      { command: 'swarm supply-chain', description: 'Supply chain audit' },
    ],
  },
  slo: {
    title: 'SLO Management',
    description: 'Service Level Objectives define reliability targets for your services. Track SLOs, get alerts when budgets are burning, and maintain production quality.',
    setupSteps: [
      { label: 'Add an SLO target', command: 'swarm slo add "API Latency" --target "<200ms"' },
      { label: 'Check SLO status', command: 'swarm slo check' },
    ],
    cliCommands: [
      { command: 'swarm slo', description: 'View SLO dashboard' },
      { command: 'swarm slo add', description: 'Add new SLO' },
      { command: 'swarm slo check', description: 'Check all SLOs' },
    ],
  },
  debt: {
    title: 'Tech Debt',
    description: 'Track and prioritize technical debt. Identifies hotspots, calculates debt scores, and suggests where to invest refactoring effort.',
    cliCommands: [
      { command: 'swarm health', description: 'Includes debt scoring' },
    ],
  },
  conventions: {
    title: 'Conventions',
    description: 'Swarm learns your project patterns and coding conventions to generate code that matches your style.',
    setupSteps: [
      { label: 'Scan your codebase for conventions', command: 'swarm learn' },
    ],
    cliCommands: [
      { command: 'swarm learn', description: 'Learn conventions' },
      { command: 'swarm learn --stack node', description: 'Learn for specific stack' },
    ],
  },
  memory: {
    title: 'Memory',
    description: 'Cross-run memory allows Swarm to remember context between pipeline runs. Stores decisions, patterns, and lessons learned.',
    cliCommands: [
      { command: 'swarm memory', description: 'View stored memories' },
      { command: 'swarm memory add "Always use UTC"', description: 'Add a memory' },
    ],
  },
  explain: {
    title: 'Explain',
    description: 'Ask questions about your codebase and get AI-powered answers with file references.',
    cliCommands: [
      { command: 'swarm explain "How does auth work?"', description: 'Ask a question' },
    ],
  },
  context: {
    title: 'Codebase Context',
    description: 'Build an intelligent index of your codebase. Maps modules, dependencies, and ownership for better AI understanding.',
    setupSteps: [
      { label: 'Build the codebase index', command: 'swarm context build' },
    ],
    cliCommands: [
      { command: 'swarm context build', description: 'Build index' },
      { command: 'swarm context', description: 'View index' },
    ],
  },
  forecast: {
    title: 'Engineering Forecast',
    description: 'Predict engineering metrics and trends based on historical pipeline data.',
    cliCommands: [
      { command: 'swarm forecast', description: 'View forecasts' },
    ],
  },
  benchmark: {
    title: 'Benchmarks',
    description: 'Run performance benchmarks and detect regressions across pipeline runs.',
    cliCommands: [
      { command: 'swarm benchmark', description: 'Run benchmarks' },
    ],
  },
  inbox: {
    title: 'Inbox',
    description: 'Self-directed work queue. Swarm identifies tasks, prioritizes them, and works through them autonomously.',
    cliCommands: [
      { command: 'swarm inbox', description: 'View inbox' },
      { command: 'swarm inbox process', description: 'Process next item' },
    ],
  },
  standup: {
    title: 'Standup',
    description: 'Automated async status reports summarizing what was done, what\'s in progress, and blockers.',
    cliCommands: [
      { command: 'swarm standup', description: 'Generate standup report' },
    ],
  },
  journal: {
    title: 'Decision Journal',
    description: 'Track architectural decisions, their rationale, and outcomes over time.',
    cliCommands: [
      { command: 'swarm journal', description: 'View journal' },
      { command: 'swarm journal add', description: 'Add entry' },
    ],
  },
  roadmap: {
    title: 'Roadmap',
    description: 'Long-term project planning with AI-assisted prioritization and dependency analysis.',
    cliCommands: [
      { command: 'swarm roadmap', description: 'View roadmap' },
    ],
  },
  scope: {
    title: 'Scope Analysis',
    description: 'Analyze feature requests for feasibility, complexity, and effort estimation.',
    cliCommands: [
      { command: 'swarm scope "Add SSO support"', description: 'Analyze scope' },
    ],
  },
  deps: {
    title: 'Dependencies',
    description: 'Intelligent dependency management. Check for outdated packages, security vulnerabilities, and safe update paths.',
    cliCommands: [
      { command: 'swarm deps', description: 'Audit dependencies' },
      { command: 'swarm deps update', description: 'Update dependencies' },
    ],
  },
  incident: {
    title: 'Incident Response',
    description: 'AI-assisted incident response. Analyze logs, identify root cause, and propose fixes.',
    cliCommands: [
      { command: 'swarm incident', description: 'Start incident response' },
    ],
  },
  migrate: {
    title: 'Migrations',
    description: 'AI-driven database migration generation and validation.',
    cliCommands: [
      { command: 'swarm migrate', description: 'Generate migration' },
    ],
  },
  retro: {
    title: 'Retrospectives',
    description: 'Automated retrospectives analyzing pipeline runs, identifying patterns, and suggesting improvements.',
    cliCommands: [
      { command: 'swarm retro', description: 'Generate retro' },
    ],
  },
  pair: {
    title: 'Pair Programming',
    description: 'Real-time AI pair programming with context-aware assistance.',
    cliCommands: [
      { command: 'swarm pair', description: 'Start pairing session' },
    ],
  },
  delegate: {
    title: 'Delegation',
    description: 'Break complex tasks into sub-tasks and delegate to specialized AI agents.',
    cliCommands: [
      { command: 'swarm delegate "Refactor auth module"', description: 'Delegate a task' },
    ],
  },
  compliance: {
    title: 'Compliance',
    description: 'Automated regulatory compliance checks for your codebase.',
    cliCommands: [
      { command: 'swarm compliance', description: 'Run compliance check' },
    ],
  },
  'arch-review': {
    title: 'Architecture Review',
    description: 'Strategic architecture review analyzing coupling, complexity, and design patterns.',
    cliCommands: [
      { command: 'swarm architect-review', description: 'Run review' },
    ],
  },
  system: {
    title: 'System Map',
    description: 'Visualize your system architecture, service dependencies, and cross-repo relationships.',
    cliCommands: [
      { command: 'swarm system', description: 'View system map' },
    ],
  },
  watch: {
    title: 'File Watcher',
    description: 'Watch files for changes and automatically run tests or other commands.',
    cliCommands: [
      { command: 'swarm watch', description: 'Start watching' },
    ],
  },
  report: {
    title: 'Impact Reports',
    description: 'Generate ROI and impact reports showing the value of AI-assisted development.',
    cliCommands: [
      { command: 'swarm report', description: 'Generate report' },
    ],
  },
  team: {
    title: 'Team Coordination',
    description: 'Multi-user coordination, shared context, and collaborative development.',
    cliCommands: [
      { command: 'swarm team', description: 'View team status' },
    ],
  },
  surfaces: {
    title: 'Surface Ownership',
    description: 'Define and track ownership of code surfaces, APIs, and services.',
    cliCommands: [
      { command: 'swarm own', description: 'View ownership' },
    ],
  },
  plugins: {
    title: 'Plugins',
    description: 'Extend Swarm with custom plugins for webhooks, integrations, and custom workflows.',
    cliCommands: [
      { command: 'swarm plugin list', description: 'List plugins' },
      { command: 'swarm plugin install', description: 'Install a plugin' },
    ],
  },
  onboard: {
    title: 'Onboarding',
    description: 'Guided developer onboarding and mentoring powered by AI.',
    cliCommands: [
      { command: 'swarm onboard', description: 'Start onboarding' },
    ],
  },
};
