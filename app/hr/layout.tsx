import { requireWorkspace } from '@/lib/auth/require-workspace';
import { WorkspaceShell } from '@/components/workspace/workspace-shell';

export default async function HrLayout({ children }: { children: React.ReactNode }) {
  await requireWorkspace('workspace:hr');
  return <WorkspaceShell workspaceKey="hr">{children}</WorkspaceShell>;
}
