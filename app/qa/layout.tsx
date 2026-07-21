import { requireWorkspace } from '@/lib/auth/require-workspace';
import { WorkspaceShell } from '@/components/workspace/workspace-shell';

export default async function QaLayout({ children }: { children: React.ReactNode }) {
  await requireWorkspace('workspace:qa');
  return <WorkspaceShell workspaceKey="qa">{children}</WorkspaceShell>;
}
