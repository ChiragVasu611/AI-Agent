import { WorkspaceHome } from '@/components/workspace/workspace-home';
import { WORKSPACES } from '@/lib/workspaces/registry';

export default function FinanceDashboardPage() {
  return <WorkspaceHome workspace={WORKSPACES.finance} />;
}
