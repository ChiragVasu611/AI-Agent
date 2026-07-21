import { WorkspaceHome } from '@/components/workspace/workspace-home';
import { WORKSPACES } from '@/lib/workspaces/registry';

export default function MarketingDashboardPage() {
  return <WorkspaceHome workspace={WORKSPACES.marketing} />;
}
