import { WorkspaceSidebar } from '@/components/workspace/workspace-sidebar';
import { Topbar } from '@/components/dashboard/topbar';
import { WORKSPACES } from '@/lib/workspaces/registry';

export function WorkspaceShell({ workspaceKey, children }: { workspaceKey: keyof typeof WORKSPACES; children: React.ReactNode }) {
  const workspace = WORKSPACES[workspaceKey];
  return (
    <div className="flex h-screen overflow-hidden bg-background text-foreground">
      {/* WorkspaceSidebar re-reads the registry itself — Lucide icon components
          (functions) can't cross the server->client prop boundary.
          Below lg it is presented as a drawer from the top bar instead. */}
      <div className="hidden lg:flex">
        <WorkspaceSidebar workspaceKey={workspaceKey} />
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar
          title={workspace.label}
          subtitle={workspace.subtitle}
          // The workspace's own navigation goes in the mobile drawer, so a
          // workspace never shows enterprise navigation on small screens.
          mobileNav={<WorkspaceSidebar workspaceKey={workspaceKey} />}
        />
        <main className="flex-1 overflow-y-auto scrollbar-thin">{children}</main>
      </div>
    </div>
  );
}
