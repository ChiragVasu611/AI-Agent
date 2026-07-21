import { WorkspaceSettings } from '@/components/workspace/workspace-settings';
import { WORKSPACES } from '@/lib/workspaces/registry';

export default function HrSettingsPage() {
  return <WorkspaceSettings workspaceLabel={WORKSPACES.hr.label} />;
}
