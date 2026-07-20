import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth/session';
import { Sidebar } from '@/components/dashboard/sidebar';
import { Topbar } from '@/components/dashboard/topbar';

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  return (
    <div className="flex h-screen overflow-hidden bg-background text-foreground">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar title="Enterprise AI Workspace" subtitle="Orchestrate every agent from one place" />
        <main className="flex-1 overflow-y-auto scrollbar-thin">{children}</main>
      </div>
    </div>
  );
}
