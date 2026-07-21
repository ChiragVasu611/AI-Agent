import { WorkspaceSettings } from '@/components/workspace/workspace-settings';
import { WORKSPACES } from '@/lib/workspaces/registry';

export default function MarketingSettingsPage() {
  return <WorkspaceSettings workspaceLabel={WORKSPACES.marketing.label} />;
}
