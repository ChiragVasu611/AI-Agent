'use client';

import { useEffect, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { useAuth } from '@/components/providers/auth-provider';
import { updateProfile } from '@/lib/auth/actions';
import { signOut } from '@/lib/auth/actions';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';

export default function SettingsPage() {
  const { user, refresh } = useAuth();
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setName(user?.fullName ?? '');
  }, [user]);

  async function onSave(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    const res = await updateProfile(name);
    setLoading(false);
    if (res.error) return toast.error(res.error);
    await refresh();
    toast.success('Profile updated');
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6 lg:p-8">
      <div>
        <h1 className="font-display text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground">Manage your account and preferences.</p>
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
              <Badge variant="secondary" className="capitalize">{user?.role ?? 'user'}</Badge>
            </div>
          </div>
          <Button type="submit" disabled={loading} className="gap-2">
            {loading && <Loader2 className="h-4 w-4 animate-spin" />}
            Save changes
          </Button>
        </form>
      </Card>

      <Card className="border-border bg-card/60 p-6 backdrop-blur">
        <h2 className="font-display text-lg font-semibold">Danger Zone</h2>
        <p className="mt-1 text-sm text-muted-foreground">Sign out of all devices by ending your session.</p>
        <Button
          variant="outline"
          className="mt-4 border-destructive/40 text-destructive hover:bg-destructive/10"
          onClick={async () => {
            await signOut();
            window.location.href = '/login';
          }}
        >
          Sign out everywhere
        </Button>
      </Card>
    </div>
  );
}
