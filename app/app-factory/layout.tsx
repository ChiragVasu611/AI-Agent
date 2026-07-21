import { requireWorkspace } from '@/lib/auth/require-workspace';
import { WorkspaceShell } from '@/components/workspace/workspace-shell';

export default async function AppFactoryLayout({ children }: { children: React.ReactNode }) {
  await requireWorkspace('workspace:app_factory');
  return <WorkspaceShell workspaceKey="app_factory">{children}</WorkspaceShell>;
}
