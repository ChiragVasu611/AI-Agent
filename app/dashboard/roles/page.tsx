import { ShieldCheck } from 'lucide-react';
import { requireWorkspace } from '@/lib/auth/require-workspace';
import { connectToDatabase } from '@/lib/mongodb/connect';
import { User } from '@/lib/mongodb/models/User';
import { ROLES, ROLE_PERMISSIONS, ROLE_HOME, permissionsForRole } from '@/lib/auth/permissions';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

export default async function AdminRolesPage() {
  await requireWorkspace('admin.manage');
  await connectToDatabase();

  const counts = await User.aggregate([{ $group: { _id: '$role', count: { $sum: 1 } } }]);
  const countByRole = new Map<string, number>(counts.map((c: any) => [c._id ?? 'employee', c.count]));

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6 lg:p-8">
      <div>
        <h1 className="font-display text-2xl font-semibold tracking-tight">Roles</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Roles are defined in code and enforced on every request by both the edge middleware and each
          workspace layout — this view reflects that live configuration, it isn't a separate editable copy.
          To change what a role can do, edit the permission map in <code className="rounded bg-secondary px-1 py-0.5 text-xs">lib/auth/permissions.ts</code>.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {ROLES.map((role) => {
          const perms = permissionsForRole(role);
          const isWildcard = ROLE_PERMISSIONS[role] === '*';
          const count = countByRole.get(role) ?? 0;
          return (
            <Card key={role} className="border-border bg-card/60 p-5 backdrop-blur">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-2">
                  <div className="grid h-9 w-9 place-items-center rounded-lg bg-primary/10 text-primary">
                    <ShieldCheck className="h-4 w-4" />
                  </div>
                  <div>
                    <div className="font-display text-base font-semibold capitalize">{role.replace(/_/g, ' ')}</div>
                    <div className="text-xs text-muted-foreground">Home: {ROLE_HOME[role]}</div>
                  </div>
                </div>
                <Badge variant="secondary">{count} user{count === 1 ? '' : 's'}</Badge>
              </div>
              <div className="mt-4 flex flex-wrap gap-1.5">
                {isWildcard ? (
                  <Badge className="bg-primary/15 text-primary hover:bg-primary/15 text-[11px]">All permissions (*)</Badge>
                ) : perms.length === 0 ? (
                  <span className="text-xs text-muted-foreground">No permissions granted.</span>
                ) : (
                  perms.map((p) => (
                    <Badge key={p} variant="outline" className="text-[11px] font-normal">{p}</Badge>
                  ))
                )}
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
