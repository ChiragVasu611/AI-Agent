import { requireWorkspace } from '@/lib/auth/require-workspace';
import { PERMISSIONS, ROLES, hasPermission, permissionsForRole } from '@/lib/auth/permissions';
import { Card } from '@/components/ui/card';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';

export default async function AdminPermissionsPage() {
  await requireWorkspace('admin.manage');

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6 lg:p-8">
      <div>
        <h1 className="font-display text-2xl font-semibold tracking-tight">Permissions</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Every permission in the catalogue and which roles currently hold it. Super Admin holds every
          permission via a wildcard grant, checked directly rather than listed permission-by-permission.
        </p>
      </div>

      <Card className="overflow-x-auto border-border bg-card/60 backdrop-blur">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="sticky left-0 bg-card/95">Permission</TableHead>
              {ROLES.map((role) => (
                <TableHead key={role} className="whitespace-nowrap text-center capitalize">{role.replace(/_/g, ' ')}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {PERMISSIONS.map((perm) => (
              <TableRow key={perm}>
                <TableCell className="sticky left-0 bg-card/95 font-mono text-xs">{perm}</TableCell>
                {ROLES.map((role) => {
                  const granted = hasPermission(permissionsForRole(role), perm);
                  return (
                    <TableCell key={role} className="text-center">
                      {granted ? <Check className={cn('mx-auto h-4 w-4 text-success')} /> : <span className="text-muted-foreground/30">—</span>}
                    </TableCell>
                  );
                })}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
