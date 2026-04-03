import { Map, Search } from 'lucide-react';
import { HubLayout } from '../../layouts/HubLayout';

export function PlanningHub() {
  return (
    <HubLayout
      title="Planning"
      description="Plan features, analyze scope, and manage your engineering roadmap."
      icon={<Map size={20} />}
      features={[
        { name: 'Roadmap', route: '/planning/roadmap', icon: <Map size={18} />, description: 'Long-term project planning', status: 'not-setup', actionLabel: 'Create roadmap' },
        { name: 'Scope', route: '/planning/scope', icon: <Search size={18} />, description: 'Feature feasibility & effort analysis', status: 'not-setup', actionLabel: 'Analyze' },
      ]}
      quickStart={'Run \'swarm scope "Add SSO support"\' to analyze a feature\'s scope and complexity.'}
    />
  );
}
