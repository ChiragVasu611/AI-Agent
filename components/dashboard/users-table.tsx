'use client';

import { useMemo, useState, useTransition } from 'react';
import { Search, ShieldOff, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { updateUserRole, toggleUserActive } from '@/app/dashboard/admin-actions';
import { ROLES } from '@/lib/auth/permissions';
import { formatDate } from '@/lib/utils';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';

export interface AdminUserRow {
  id: string;
  email: string;
  fullName: string;
  role: string;
  isActive?: boolean;
  createdAt: string;
}

function roleLabel(role: string) {
  return role.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export function UsersTable({ users, currentUserId }: { users: AdminUserRow[]; currentUserId: string }) {
  const [search, setSearch] = useState('');
  const [pending, startTransition] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return users;
    return users.filter((u) => u.email.toLowerCase().includes(q) || u.fullName.toLowerCase().includes(q) || u.role.includes(q));
  }, [search, users]);

  function onRoleChange(userId: string, role: string) {
    setBusyId(userId);
    startTransition(async () => {
      const res = await updateUserRole(userId, role);
      if ('error' in res) toast.error(res.error);
      else toast.success('Role updated');
      setBusyId(null);
    });
  }

  function onToggleActive(userId: string) {
    setBusyId(userId);
    startTransition(async () => {
      const res = await toggleUserActive(userId);
      if ('error' in res) toast.error(res.error);
      else toast.success(res.isActive ? 'User reactivated' : 'User deactivated');
      setBusyId(null);
    });
  }

  return (
    <Card className="border-border bg-card/60 backdrop-blur">
      <div className="flex items-center gap-2 border-b border-border p-4">
        <Search className="h-4 w-4 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name, email, or role..."
          className="h-9 border-0 bg-transparent px-0 focus-visible:ring-0"
        />
        <span className="text-xs text-muted-foreground">{filtered.length} of {users.length}</span>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Email</TableHead>
            <TableHead>Role</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Joined</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {filtered.length === 0 ? (
            <TableRow>
              <TableCell colSpan={6} className="py-10 text-center text-sm text-muted-foreground">
                No users match your search.
              </TableCell>
            </TableRow>
          ) : (
            filtered.map((u) => {
              const isSelf = u.id === currentUserId;
              const active = u.isActive !== false;
              return (
                <TableRow key={u.id}>
                  <TableCell className="font-medium">{u.fullName || '—'}{isSelf && <span className="ml-1.5 text-xs text-muted-foreground">(you)</span>}</TableCell>
                  <TableCell className="text-muted-foreground">{u.email}</TableCell>
                  <TableCell>
                    <Select
                      value={u.role}
                      onValueChange={(v) => onRoleChange(u.id, v)}
                      disabled={isSelf || (pending && busyId === u.id)}
                    >
                      <SelectTrigger className="h-8 w-[160px] text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {ROLES.map((r) => (
                          <SelectItem key={r} value={r} className="text-xs">{roleLabel(r)}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell>
                    <Badge variant={active ? 'default' : 'secondary'} className={active ? 'bg-success/15 text-success hover:bg-success/15' : ''}>
                      {active ? 'Active' : 'Deactivated'}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">{formatDate(u.createdAt)}</TableCell>
                  <TableCell className="text-right">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={isSelf || (pending && busyId === u.id)}
                      onClick={() => onToggleActive(u.id)}
                      className="gap-1.5 text-xs"
                    >
                      {active ? <ShieldOff className="h-3.5 w-3.5" /> : <ShieldCheck className="h-3.5 w-3.5" />}
                      {active ? 'Deactivate' : 'Reactivate'}
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })
          )}
        </TableBody>
      </Table>
    </Card>
  );
}
