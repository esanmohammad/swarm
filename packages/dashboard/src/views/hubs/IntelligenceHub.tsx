import { TrendingUp } from 'lucide-react';
import { HubLayout } from '../../layouts/HubLayout';

export function IntelligenceHub() {
  return (
    <HubLayout
      title="Intelligence"
      description="Monitor costs and track performance across all activities."
      icon={<TrendingUp size={20} />}
      features={[
        { name: 'Stats', route: '/intelligence/stats', icon: <TrendingUp size={18} />, description: 'Cost & performance analytics across pipelines, agents, and reviews', status: 'has-data', actionLabel: 'View' },
      ]}
      quickStart="Run 'swarm stats' to see your cost breakdown and performance trends across all activity types."
    />
  );
}
