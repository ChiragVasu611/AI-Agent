import { WorkspaceSidebar } from '@/components/workspace/workspace-sidebar';
import { Topbar } from '@/components/dashboard/topbar';
import { WORKSPACES } from '@/lib/workspaces/registry';

export function WorkspaceShell({ workspaceKey, children }: { workspaceKey: keyof typeof WORKSPACES; children: React.ReactNode }) {
  const workspace = WORKSPACES[workspaceKey];
  return (
    <div className="flex h-screen overflow-hidden bg-background text-foreground">
      {/* WorkspaceSidebar re-reads the registry itself — Lucide icon components
          (functions) can't cross the server->client prop boundary. */}
      <WorkspaceSidebar workspaceKey={workspaceKey} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar title={workspace.label} subtitle={workspace.subtitle} />
        <main className="flex-1 overflow-y-auto scrollbar-thin">{children}</main>
      </div>
    </div>
  );
}
