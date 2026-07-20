'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Loader2, MailCheck } from 'lucide-react';
import { requestPasswordReset } from '@/lib/auth/actions';
import { AuthShell } from '@/components/auth/auth-shell';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [resetLink, setResetLink] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    const res = await requestPasswordReset(email);
    setLoading(false);
    if (res.error) return toast.error(res.error);
    setSent(true);
    setResetLink(res.resetLink ?? null);
    toast.success('Reset link generated');
  }

  return (
    <AuthShell
      title="Reset your password"
      subtitle="No email delivery is configured yet, so we'll show your reset link here."
      footer={
        <Link href="/login" className="inline-flex items-center gap-1 hover:text-primary">
          <ArrowLeft className="h-3 w-3" /> Back to sign in
        </Link>
      }
    >
      {sent ? (
        <div className="flex flex-col items-center gap-3 py-6 text-center">
          <MailCheck className="h-10 w-10 text-success" />
          {resetLink ? (
            <>
              <p className="text-sm text-muted-foreground">Use this link to reset your password:</p>
              <Link href={resetLink} className="break-all text-sm font-medium text-primary hover:underline">
                {resetLink}
              </Link>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              If an account exists for <span className="text-foreground">{email}</span>, a reset link was generated.
            </p>
          )}
        </div>
      ) : (
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="email">Email</Label>
            <Input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" />
          </div>
          <Button type="submit" disabled={loading} className="w-full gap-2">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Send reset link
          </Button>
        </form>
      )}
    </AuthShell>
  );
}
