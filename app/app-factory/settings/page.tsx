import { WorkspaceSettings } from '@/components/workspace/workspace-settings';
import { WORKSPACES } from '@/lib/workspaces/registry';

export default function AppFactorySettingsPage() {
  return <WorkspaceSettings workspaceLabel={WORKSPACES.app_factory.label} />;
}
