import { Wrench, Bot, Inbox, GitPullRequest, GitBranch, Eye } from 'lucide-react';
import { HubLayout } from '../../layouts/HubLayout';

export function WorkflowsHub() {
  return (
    <HubLayout
      title="Workflows"
      description="Quick AI-powered workflows for common development tasks."
      icon={<Wrench size={20} />}
      features={[
        { name: 'Autopilot', route: '/workflows/autopilot', icon: <Bot size={18} />, description: 'Issue-to-PR automation daemon', status: 'not-setup', actionLabel: 'Setup' },
        { name: 'Inbox', route: '/workflows/inbox', icon: <Inbox size={18} />, description: 'Self-directed work queue', status: 'not-setup', actionLabel: 'Setup' },
        { name: 'PR Reviews', route: '/workflows/review', icon: <GitPullRequest size={18} />, description: 'Automated code review', status: 'not-setup', actionLabel: 'Setup' },
        { name: 'Delegate', route: '/workflows/delegate', icon: <GitBranch size={18} />, description: 'Multi-agent task decomposition', status: 'not-setup', actionLabel: 'Setup' },
        { name: 'Watch', route: '/workflows/watch', icon: <Eye size={18} />, description: 'File watcher & auto-test', status: 'not-setup', actionLabel: 'Setup' },
      ]}
      quickStart="Run 'swarm review' to review current changes, or 'swarm autopilot start' to auto-process labeled issues."
    />
  );
}
