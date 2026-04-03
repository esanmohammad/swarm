import { Wrench, GitPullRequest } from 'lucide-react';
import { HubLayout } from '../../layouts/HubLayout';

export function WorkflowsHub() {
  return (
    <HubLayout
      title="Workflows"
      description="Quick AI-powered workflows for common development tasks."
      icon={<Wrench size={20} />}
      features={[
        { name: 'Code Review', route: '/workflows/review', icon: <GitPullRequest size={18} />, description: 'Review staged changes or GitHub PRs', status: 'not-setup', actionLabel: 'Review' },
      ]}
      quickStart="Run 'swarm review' to review current changes, or 'swarm review 123' to review a GitHub PR."
    />
  );
}
