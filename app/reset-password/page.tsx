'use client';

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { resetPassword } from '@/lib/auth/actions';
import { AuthShell } from '@/components/auth/auth-shell';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';

export default function ResetPasswordPage() {
  const router = useRouter();
  const params = useSearchParams();
  const token = params.get('token') ?? '';
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < 6) return toast.error('Password must be at least 6 characters');
    if (!token) return toast.error('Missing reset token');
    setLoading(true);
    const res = await resetPassword(token, password);
    setLoading(false);
    if (res.error) return toast.error(res.error);
    toast.success('Password updated');
    router.push('/login');
  }

  return (
    <AuthShell
      title="Set a new password"
      subtitle="Choose a strong password for your account."
      footer={null}
    >
      <form onSubmit={onSubmit} className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="password">New password</Label>
          <Input id="password" type="password" required value={password} onChange={(e) => setPassword(e.target.value)} placeholder="At least 6 characters" />
        </div>
        <Button type="submit" disabled={loading} className="w-full gap-2">
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Update password
        </Button>
      </form>
    </AuthShell>
  );
}
