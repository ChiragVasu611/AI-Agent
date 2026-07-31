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

export type ActionGateResult =
  | { ok: true; user: SessionUser }
  | { ok: false; error: string };

/**
 * The Server Action counterpart to requireWorkspace(). An action cannot
 * redirect() usefully — the caller is awaiting a result object it means to show
 * as a toast — so this returns the same `{ error }` shape the actions already
 * use.
 *
 * Server Actions in this Next.js version POST to the page path they were
 * imported from, so middleware's '/qa' -> workspace:qa rule already covers
 * these. This is the second layer: it re-reads the role from Mongo (middleware
 * trusts the JWT claim, which goes stale when a role changes) and it keeps the
 * action safe if it is ever re-exported from a page outside /qa.
 */
export async function requireWorkspaceAction(permission: Permission): Promise<ActionGateResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: 'Not authenticated' };
  if (!hasPermission(user.permissions, permission)) {
    return { ok: false, error: 'You do not have access to this workspace.' };
  }
  return { ok: true, user };
}
