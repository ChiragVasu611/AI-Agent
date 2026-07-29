import { requireWorkspace } from '@/lib/auth/require-workspace';
import { connectToDatabase } from '@/lib/mongodb/connect';
import { ActivityLog } from '@/lib/mongodb/models/ActivityLog';
import { User } from '@/lib/mongodb/models/User';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { formatDateTime } from '@/lib/utils';

const PAGE_SIZE = 50;

function moduleOf(action: string): string {
  return action.split('.')[0] || 'other';
}

const MODULE_COLORS: Record<string, string> = {
  hr: 'bg-amber-500/15 text-amber-500',
  qa: 'bg-emerald-500/15 text-emerald-500',
  designer: 'bg-cyan-500/15 text-cyan-500',
  admin: 'bg-red-500/15 text-red-500',
  app_factory: 'bg-primary/10 text-primary',
};

export default async function AdminAuditLogsPage({
  searchParams,
}: {
  searchParams: { user?: string; action?: string; entity?: string; from?: string; to?: string; page?: string };
}) {
  await requireWorkspace('admin.manage');
  await connectToDatabase();

  const { user: userQuery, action, entity, from, to } = searchParams;
  const page = Math.max(1, Number(searchParams.page ?? '1') || 1);

  const query: Record<string, unknown> = {};
  if (action) query.action = { $regex: action, $options: 'i' };
  if (entity) query.entity = { $regex: entity, $options: 'i' };
  if (from || to) {
    const createdAt: Record<string, Date> = {};
    if (from) createdAt.$gte = new Date(from);
    if (to) createdAt.$lte = new Date(`${to}T23:59:59.999Z`);
    query.createdAt = createdAt;
  }
  if (userQuery) {
    const matchingUsers = await User.find({
      $or: [{ email: { $regex: userQuery, $options: 'i' } }, { fullName: { $regex: userQuery, $options: 'i' } }],
    }, '_id').lean();
    query.userId = { $in: matchingUsers.map((u) => u._id) };
  }

  const total = await ActivityLog.countDocuments(query);
  const logs = await ActivityLog.find(query)
    .sort({ createdAt: -1 })
    .skip((page - 1) * PAGE_SIZE)
    .limit(PAGE_SIZE)
    .populate('userId', 'email fullName')
    .lean();

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  function pageHref(p: number) {
    const params = new URLSearchParams();
    if (userQuery) params.set('user', userQuery);
    if (action) params.set('action', action);
    if (entity) params.set('entity', entity);
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    params.set('page', String(p));
    return `/dashboard/audit-logs?${params.toString()}`;
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6 lg:p-8">
      <div>
        <h1 className="font-display text-2xl font-semibold tracking-tight">Audit Logs</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Every recorded action across HR, QA, Designer, App Factory, and Admin — {total.toLocaleString()} total.
        </p>
      </div>

      <Card className="border-border bg-card/60 p-4 backdrop-blur">
        <form method="get" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <Input name="user" defaultValue={userQuery ?? ''} placeholder="User (name or email)" />
          <Input name="action" defaultValue={action ?? ''} placeholder="Action contains..." />
          <Input name="entity" defaultValue={entity ?? ''} placeholder="Entity" />
          <Input type="date" name="from" defaultValue={from ?? ''} />
          <div className="flex gap-2">
            <Input type="date" name="to" defaultValue={to ?? ''} />
            <Button type="submit" size="sm">Filter</Button>
          </div>
        </form>
      </Card>

      <Card className="border-border bg-card/60 backdrop-blur">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>When</TableHead>
              <TableHead>User</TableHead>
              <TableHead>Module</TableHead>
              <TableHead>Action</TableHead>
              <TableHead>Entity</TableHead>
              <TableHead>Details</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {logs.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="py-10 text-center text-sm text-muted-foreground">
                  No activity matches these filters.
                </TableCell>
              </TableRow>
            ) : (
              logs.map((log: any) => {
                const mod = moduleOf(log.action);
                return (
                  <TableRow key={String(log._id)}>
                    <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                      {formatDateTime(log.createdAt)}
                    </TableCell>
                    <TableCell className="text-xs">
                      {log.userId?.fullName || log.userId?.email || 'Unknown'}
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary" className={`text-[10px] capitalize ${MODULE_COLORS[mod] ?? ''}`}>{mod.replace(/_/g, ' ')}</Badge>
                    </TableCell>
                    <TableCell className="font-mono text-xs">{log.action}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{log.entity ? `${log.entity}${log.entityId ? ` · ${String(log.entityId).slice(-6)}` : ''}` : '—'}</TableCell>
                    <TableCell className="max-w-[240px] truncate text-xs text-muted-foreground" title={log.meta ? JSON.stringify(log.meta) : ''}>
                      {log.meta ? JSON.stringify(log.meta) : '—'}
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </Card>

      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>Page {page} of {totalPages}</span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={page <= 1} asChild={page > 1}>
              {page > 1 ? <a href={pageHref(page - 1)}>Previous</a> : <span>Previous</span>}
            </Button>
            <Button variant="outline" size="sm" disabled={page >= totalPages} asChild={page < totalPages}>
              {page < totalPages ? <a href={pageHref(page + 1)}>Next</a> : <span>Next</span>}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
