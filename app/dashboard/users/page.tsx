import { requireWorkspace } from '@/lib/auth/require-workspace';
import { connectToDatabase } from '@/lib/mongodb/connect';
import { User } from '@/lib/mongodb/models/User';
import { serializeDoc } from '@/lib/mongodb/serialize';
import { ROLES } from '@/lib/auth/permissions';
import { Card } from '@/components/ui/card';
import { UsersTable, type AdminUserRow } from '@/components/dashboard/users-table';

export default async function AdminUsersPage() {
  const currentUser = await requireWorkspace('admin.manage');

  await connectToDatabase();
  const docs = await User.find({}, '-passwordHash -resetToken -resetTokenExpires -qaOpenRouterApiKey -uiuxOpenRouterApiKey')
    .sort({ createdAt: -1 })
    .lean();
  const users = docs.map(serializeDoc) as AdminUserRow[];

  const byRole = ROLES.map((role) => ({
    role,
    count: users.filter((u) => u.role === role).length,
  })).filter((r) => r.count > 0);

  const activeCount = users.filter((u) => u.isActive !== false).length;

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6 lg:p-8">
      <div>
        <h1 className="font-display text-2xl font-semibold tracking-tight">Users</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Every account across the organization. Change a user's role or deactivate access.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="border-border bg-card/60 p-5 backdrop-blur">
          <div className="font-display text-3xl font-semibold">{users.length}</div>
          <div className="mt-1 text-sm text-muted-foreground">Total Users</div>
        </Card>
        <Card className="border-border bg-card/60 p-5 backdrop-blur">
          <div className="font-display text-3xl font-semibold">{activeCount}</div>
          <div className="mt-1 text-sm text-muted-foreground">Active</div>
        </Card>
        <Card className="border-border bg-card/60 p-5 backdrop-blur">
          <div className="font-display text-3xl font-semibold">{users.length - activeCount}</div>
          <div className="mt-1 text-sm text-muted-foreground">Deactivated</div>
        </Card>
        <Card className="border-border bg-card/60 p-5 backdrop-blur">
          <div className="font-display text-3xl font-semibold">{byRole.length}</div>
          <div className="mt-1 text-sm text-muted-foreground">Roles In Use</div>
        </Card>
      </div>

      <UsersTable users={users} currentUserId={currentUser.id} />
    </div>
  );
}
