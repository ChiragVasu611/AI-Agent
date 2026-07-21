import { WorkspaceSettings } from '@/components/workspace/workspace-settings';
import { QaApiKeySettings } from '@/components/modules/qa/api-key-settings';
import { WORKSPACES } from '@/lib/workspaces/registry';

export default function QaSettingsPage() {
  return (
    <div>
      <WorkspaceSettings workspaceLabel={WORKSPACES.qa.label} />
      <div className="mx-auto max-w-3xl px-6 pb-8 lg:px-8">
        <QaApiKeySettings />
      </div>
    </div>
  );
}
