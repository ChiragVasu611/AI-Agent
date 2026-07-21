import { WorkspaceSettings } from '@/components/workspace/workspace-settings';
import { WORKSPACES } from '@/lib/workspaces/registry';

export default function FinanceSettingsPage() {
  return <WorkspaceSettings workspaceLabel={WORKSPACES.finance.label} />;
}
