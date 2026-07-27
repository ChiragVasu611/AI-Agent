'use server';

import { revalidatePath } from 'next/cache';
import { getCurrentUser } from '@/lib/auth/session';
import { connectToDatabase } from '@/lib/mongodb/connect';
import { User } from '@/lib/mongodb/models/User';
import { ActivityLog } from '@/lib/mongodb/models/ActivityLog';
import { hasPermission, ROLES, type Role } from '@/lib/auth/permissions';
import type { SessionUser } from '@/lib/auth/session';

type Guard = { ok: false; error: string } | { ok: true; user: SessionUser };

async function requireAdmin(): Promise<Guard> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: 'Not authenticated' };
  if (!hasPermission(user.permissions, 'admin.manage')) {
    return { ok: false, error: 'Forbidden: your role does not have admin.manage permission.' };
  }
  return { ok: true, user };
}

export async function updateUserRole(userId: string, role: string): Promise<{ error: string } | { ok: true }> {
  const guard = await requireAdmin();
  if (!guard.ok) return { error: guard.error };
  if (!ROLES.includes(role as Role)) return { error: 'Unknown role.' };
  if (userId === guard.user.id) return { error: 'You cannot change your own role.' };

  await connectToDatabase();
  const target = await User.findById(userId);
  if (!target) return { error: 'User not found.' };

  const previousRole = target.role;
  target.role = role;
  await target.save();

  await ActivityLog.create({
    userId: guard.user.id,
    action: 'admin.user.role_changed',
    entity: 'User',
    entityId: userId,
    meta: { previousRole, newRole: role, targetEmail: target.email },
  });

  revalidatePath('/dashboard/users');
  revalidatePath('/dashboard/roles');
  return { ok: true };
}

export async function toggleUserActive(userId: string): Promise<{ error: string } | { ok: true; isActive: boolean }> {
  const guard = await requireAdmin();
  if (!guard.ok) return { error: guard.error };
  if (userId === guard.user.id) return { error: 'You cannot deactivate your own account.' };

  await connectToDatabase();
  const target = await User.findById(userId);
  if (!target) return { error: 'User not found.' };

  target.isActive = target.isActive === false ? true : false;
  await target.save();

  await ActivityLog.create({
    userId: guard.user.id,
    action: target.isActive ? 'admin.user.reactivated' : 'admin.user.deactivated',
    entity: 'User',
    entityId: userId,
    meta: { targetEmail: target.email },
  });

  revalidatePath('/dashboard/users');
  return { ok: true, isActive: target.isActive };
}
