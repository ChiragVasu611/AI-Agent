import { getCurrentUser } from '@/lib/auth/session';
import { connectToDatabase } from '@/lib/mongodb/connect';
import { ActivityLog } from '@/lib/mongodb/models/ActivityLog';
import { serializeDoc } from '@/lib/mongodb/serialize';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';

export default async function ProfilePage() {
  const user = await getCurrentUser();
  if (!user) return null;

  await connectToDatabase();
  const activityDocs = await ActivityLog.find({ userId: user.id }).sort({ createdAt: -1 }).limit(10).lean();
  const activity = activityDocs.map(serializeDoc);

  const initials = user.email.slice(0, 2).toUpperCase();

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6 lg:p-8">
      <div>
        <h1 className="font-display text-2xl font-semibold tracking-tight">Profile</h1>
        <p className="text-sm text-muted-foreground">Your account details and recent activity.</p>
      </div>

      <Card className="border-border bg-card/60 p-6 backdrop-blur">
        <div className="flex items-center gap-4">
          <Avatar className="h-16 w-16">
            <AvatarFallback className="bg-primary/15 text-lg text-primary">{initials}</AvatarFallback>
          </Avatar>
          <div>
            <div className="font-display text-xl font-semibold">{user.fullName || 'User'}</div>
            <div className="text-sm text-muted-foreground">{user.email}</div>
            <Badge variant="secondary" className="mt-1.5 capitalize">{user.role}</Badge>
          </div>
        </div>
      </Card>

      <Card className="border-border bg-card/60 p-6 backdrop-blur">
        <h2 className="mb-3 font-display text-lg font-semibold">Recent Activity</h2>
        {activity.length > 0 ? (
          <div className="divide-y divide-border">
            {activity.map((a) => (
              <div key={a.id} className="flex items-center justify-between py-3 text-sm">
                <div>
                  <span className="font-medium">{a.action}</span>
                  {a.entity && <span className="text-muted-foreground"> · {a.entity}</span>}
                </div>
                <span className="text-xs text-muted-foreground">
                  {new Date(a.createdAt).toLocaleString()}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="py-6 text-center text-sm text-muted-foreground">No activity yet.</p>
        )}
      </Card>
    </div>
  );
}
