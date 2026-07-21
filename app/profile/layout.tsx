import { redirect } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, LogOut } from 'lucide-react';
import { getCurrentUser } from '@/lib/auth/session';
import { roleHome } from '@/lib/auth/permissions';
import { signOutAction } from '@/app/actions';

// Profile has no workspace permission requirement — every authenticated role
// (including employee/guest, who have no workspace access at all) can reach it.
// It's also the only page such roles can reach, so it must offer a sign-out
// control — every other sign-out button lives inside a workspace sidebar.
export default async function ProfileLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="flex items-center justify-between border-b border-border px-6 py-4">
        <Link href={roleHome(user.role)} className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> Back to my workspace
        </Link>
        <form action={signOutAction}>
          <button
            type="submit"
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition hover:text-destructive"
          >
            <LogOut className="h-4 w-4" /> Sign out
          </button>
        </form>
      </div>
      {children}
    </div>
  );
}
