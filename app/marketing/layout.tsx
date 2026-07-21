import { requireWorkspace } from '@/lib/auth/require-workspace';
import { WorkspaceShell } from '@/components/workspace/workspace-shell';

export default async function MarketingLayout({ children }: { children: React.ReactNode }) {
  await requireWorkspace('workspace:marketing');
  return <WorkspaceShell workspaceKey="marketing">{children}</WorkspaceShell>;
}
