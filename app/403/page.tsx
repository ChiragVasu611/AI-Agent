import Link from 'next/link';
import { ShieldAlert } from 'lucide-react';
import { getCurrentUser } from '@/lib/auth/session';
import { roleHome } from '@/lib/auth/permissions';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';

export default async function ForbiddenPage() {
  const user = await getCurrentUser();
  const homeHref = user ? roleHome(user.role) : '/login';

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <Card className="flex max-w-md flex-col items-center gap-4 border-border bg-card/60 p-10 text-center backdrop-blur">
        <div className="grid h-16 w-16 place-items-center rounded-2xl bg-destructive/10 text-destructive">
          <ShieldAlert className="h-8 w-8" />
        </div>
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight">403 — Access Denied</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {user
              ? `Your role (${user.role.replace('_', ' ')}) doesn't have permission to view this workspace.`
              : 'You need to sign in to view this page.'}
          </p>
        </div>
        <div className="flex gap-2">
          <Link href={homeHref}>
            <Button>Go to my workspace</Button>
          </Link>
          {!user && (
            <Link href="/login">
              <Button variant="outline">Sign in</Button>
            </Link>
          )}
        </div>
      </Card>
    </div>
  );
}
