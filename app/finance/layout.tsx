import { requireWorkspace } from '@/lib/auth/require-workspace';
import { WorkspaceShell } from '@/components/workspace/workspace-shell';

export default async function FinanceLayout({ children }: { children: React.ReactNode }) {
  await requireWorkspace('workspace:finance');
  return <WorkspaceShell workspaceKey="finance">{children}</WorkspaceShell>;
}
