import { Wrench } from 'lucide-react';
import { HubLayout } from '../../layouts/HubLayout';

export function WorkflowsHub() {
  return (
    <HubLayout
      title="Workflows"
      description="Quick AI-powered workflows for common development tasks. Use the Launch view or CLI to run workflows."
      icon={<Wrench size={20} />}
      features={[]}
      quickStart="Run swarm fix, swarm review, or swarm refactor from the CLI. Use the Launch view for guided workflows."
    />
  );
}
