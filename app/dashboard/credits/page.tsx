import { getCurrentUser } from '@/lib/auth/session';
import { connectToDatabase } from '@/lib/mongodb/connect';
import { Credits } from '@/lib/mongodb/models/Credits';
import { Project } from '@/lib/mongodb/models/Project';
import { User } from '@/lib/mongodb/models/User';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { CreditCard, Zap } from 'lucide-react';

export default async function CreditsPage() {
  const user = await getCurrentUser();
  await connectToDatabase();

  const credits = user
    ? await Credits.findOne({ userId: user.id }).lean<{ balance: number }>()
    : null;
  const balance = credits?.balance ?? 100;
  const count = user ? await Project.countDocuments({ userId: user.id }) : 0;
  const account = user
    ? await User.findById(user.id).lean<{ createdAt: Date }>()
    : null;

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6 lg:p-8">
      <div>
        <h1 className="font-display text-2xl font-semibold tracking-tight">Credits</h1>
        <p className="text-sm text-muted-foreground">Each agent run consumes credits. Top up to keep building.</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Card className="relative overflow-hidden border-border bg-gradient-to-br from-primary/20 to-primary/5 p-6 backdrop-blur">
          <Zap className="h-6 w-6 text-primary" />
          <div className="mt-3 font-display text-4xl font-semibold">{balance}</div>
          <div className="text-sm text-muted-foreground">Available credits</div>
        </Card>
        <Card className="border-border bg-card/60 p-6 backdrop-blur">
          <CreditCard className="h-6 w-6 text-muted-foreground" />
          <div className="mt-3 font-display text-4xl font-semibold">{count}</div>
          <div className="text-sm text-muted-foreground">Total projects</div>
        </Card>
        <Card className="border-border bg-card/60 p-6 backdrop-blur">
          <div className="text-sm text-muted-foreground">Member since</div>
          <div className="mt-2 font-medium">
            {account?.createdAt ? new Date(account.createdAt).toLocaleDateString() : '—'}
          </div>
        </Card>
      </div>

      <Card className="border-border bg-card/60 p-6 backdrop-blur">
        <h2 className="mb-3 font-display text-lg font-semibold">Top up</h2>
        <div className="grid gap-3 sm:grid-cols-3">
          {[
            { credits: 100, price: '$10', popular: false },
            { credits: 500, price: '$40', popular: true },
            { credits: 2000, price: '$120', popular: false },
          ].map((p) => (
            <div
              key={p.credits}
              className="relative rounded-xl border border-border p-4 text-center transition hover:border-primary/40"
            >
              {p.popular && <Badge className="absolute -top-2 left-1/2 -translate-x-1/2">Popular</Badge>}
              <div className="font-display text-2xl font-semibold">{p.credits}</div>
              <div className="text-xs text-muted-foreground">credits</div>
              <div className="mt-2 font-medium">{p.price}</div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
