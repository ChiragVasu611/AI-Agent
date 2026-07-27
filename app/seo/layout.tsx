import { requireWorkspace } from '@/lib/auth/require-workspace';
import { WorkspaceShell } from '@/components/workspace/workspace-shell';

export default async function SeoLayout({ children }: { children: React.ReactNode }) {
  await requireWorkspace('workspace:seo');
  return <WorkspaceShell workspaceKey="seo">{children}</WorkspaceShell>;
}
