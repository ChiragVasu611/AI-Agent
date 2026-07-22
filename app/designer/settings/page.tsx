import { WorkspaceSettings } from '@/components/workspace/workspace-settings';
import { UiuxAiSettings } from '@/components/modules/uiux/ai-settings';
import { WORKSPACES } from '@/lib/workspaces/registry';

export default function DesignerSettingsPage() {
  return (
    <div className="space-y-6">
      <WorkspaceSettings workspaceLabel={WORKSPACES.designer.label} />
      <div className="mx-auto max-w-4xl px-6 lg:px-8">
        <UiuxAiSettings />
      </div>
    </div>
  );
}
