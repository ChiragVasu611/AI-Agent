import { redirect } from 'next/navigation';
import { getCurrentUser, type SessionUser } from '@/lib/auth/session';
import { hasPermission, type Permission } from '@/lib/auth/permissions';

/**
 * Authoritative, DB-backed workspace gate for a layout/page. Always re-checks
 * the user's current role from Mongo (via getCurrentUser), so a role change
 * takes effect immediately here even if the user's JWT `role` claim (used by
 * the Edge middleware for a fast first pass) hasn't been refreshed yet.
 */
export async function requireWorkspace(permission: Permission): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  if (!hasPermission(user.permissions, permission)) redirect('/403');
  return user;
}
