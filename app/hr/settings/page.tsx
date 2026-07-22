import { WorkspaceSettings } from '@/components/workspace/workspace-settings';
import { RecruitmentSourcesSettings } from '@/components/modules/hr/recruitment-sources-settings';
import { WORKSPACES } from '@/lib/workspaces/registry';

export default function HrSettingsPage() {
  return (
    <div className="space-y-6">
      <WorkspaceSettings workspaceLabel={WORKSPACES.hr.label} />
      <div className="mx-auto max-w-4xl px-6 lg:px-8">
        <RecruitmentSourcesSettings />
      </div>
    </div>
  );
}
