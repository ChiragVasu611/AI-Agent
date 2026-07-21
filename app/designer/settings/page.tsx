import { WorkspaceSettings } from '@/components/workspace/workspace-settings';
import { WORKSPACES } from '@/lib/workspaces/registry';

export default function DesignerSettingsPage() {
  return <WorkspaceSettings workspaceLabel={WORKSPACES.designer.label} />;
}
