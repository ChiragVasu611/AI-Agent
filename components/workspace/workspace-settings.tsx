'use client';

import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { useAuth } from '@/components/providers/auth-provider';
import { updateProfile, signOut } from '@/lib/auth/actions';

export function WorkspaceSettings({ workspaceLabel }: { workspaceLabel: string }) {
  const { user, refresh } = useAuth();
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    setName(user?.fullName ?? '');
  }, [user]);

  async function onSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    const res = await updateProfile(name);
    setSaving(false);
    if (res.error) return toast.error(res.error);
    await refresh();
    toast.success('Profile updated');
  }

  async function onSignOut() {
    setSigningOut(true);
    await signOut();
    window.location.assign('/login');
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6 lg:p-8">
      <div>
        <h1 className="font-display text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground">Manage your account for the {workspaceLabel}.</p>
      </div>

      <Card className="border-border bg-card/60 p-6 backdrop-blur">
        <h2 className="font-display text-lg font-semibold">Account</h2>
        <form onSubmit={onSave} className="mt-4 space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="name">Full name</Label>
            <Input id="name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Email</Label>
            <Input value={user?.email ?? ''} disabled />
          </div>
          <div className="space-y-1.5">
            <Label>Role</Label>
            <div>
              <Badge variant="secondary" className="capitalize">{user?.role.replace('_', ' ') ?? 'employee'}</Badge>
            </div>
          </div>
          <Button type="submit" disabled={saving} className="gap-2">
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            Save changes
          </Button>
        </form>
      </Card>

      <Card className="border-border bg-card/60 p-6 backdrop-blur">
        <h2 className="font-display text-lg font-semibold">Sign Out</h2>
        <p className="mt-1 text-sm text-muted-foreground">End your session on this device.</p>
        <Button
          variant="outline"
          disabled={signingOut}
          className="mt-4 gap-2 border-destructive/40 text-destructive hover:bg-destructive/10"
          onClick={onSignOut}
        >
          {signingOut && <Loader2 className="h-4 w-4 animate-spin" />}
          Sign out
        </Button>
      </Card>
    </div>
  );
}
