import { TrendingUp, Activity, LineChart, Gauge, FileText } from 'lucide-react';
import { HubLayout } from '../../layouts/HubLayout';

export function IntelligenceHub() {
  return (
    <HubLayout
      title="Intelligence"
      description="Monitor your codebase, track costs, and forecast engineering metrics."
      icon={<TrendingUp size={20} />}
      features={[
        { name: 'Stats', route: '/intelligence/stats', icon: <TrendingUp size={18} />, description: 'Cost & performance analytics', status: 'not-setup', actionLabel: 'View stats' },
        { name: 'Health', route: '/intelligence/health', icon: <Activity size={18} />, description: 'Codebase health score', status: 'not-setup', actionLabel: 'Run check' },
        { name: 'Forecast', route: '/intelligence/forecast', icon: <LineChart size={18} />, description: 'Engineering metric predictions', status: 'not-setup', actionLabel: 'Setup' },
        { name: 'Benchmark', route: '/intelligence/benchmark', icon: <Gauge size={18} />, description: 'Performance regression detection', status: 'not-setup', actionLabel: 'Run' },
        { name: 'Reports', route: '/intelligence/report', icon: <FileText size={18} />, description: 'ROI & impact reports', status: 'not-setup', actionLabel: 'Generate' },
      ]}
      quickStart="Run 'swarm stats' to see your cost breakdown, or 'swarm health' to check codebase quality."
    />
  );
}
