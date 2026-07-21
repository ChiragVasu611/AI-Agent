import { requireWorkspace } from '@/lib/auth/require-workspace';
import { WorkspaceShell } from '@/components/workspace/workspace-shell';

export default async function DesignerLayout({ children }: { children: React.ReactNode }) {
  await requireWorkspace('workspace:designer');
  return <WorkspaceShell workspaceKey="designer">{children}</WorkspaceShell>;
}
