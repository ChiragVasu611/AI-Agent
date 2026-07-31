import { NextResponse } from 'next/server';
import { getCurrentUser, type SessionUser } from '@/lib/auth/session';
import { hasPermission, type Permission } from '@/lib/auth/permissions';

/**
 * Authoritative, DB-backed permission gate for a Route Handler — the API
 * counterpart to requireWorkspace() (which redirects, and so can only be used
 * from a page or layout).
 *
 * Route Handlers previously checked authentication only (`getCurrentUser()` +
 * 401). That is not the same as authorization: middleware maps route prefixes
 * to permissions from ROUTE_PERMISSIONS, whose entries are page paths ('/qa',
 * '/hr', …), so nothing under '/api/…' ever matched and every signed-in user —
 * including roles with an EMPTY permission set, which are bounced from the
 * workspace pages — could still call the API directly. For QA that meant
 * uploading an APK and having it installed on real connected hardware with all
 * runtime permissions granted.
 *
 * Like requireWorkspace, the role is re-read from Mongo rather than trusted
 * from the JWT claim, so revoking a workspace takes effect immediately instead
 * of at the user's next sign-in.
 *
 * Usage — one line at the top of the handler:
 *
 *   const gate = await requireApiPermission('workspace:qa');
 *   if (!gate.ok) return gate.response;
 *   const user = gate.user;
 */
export type ApiGateResult =
  | { ok: true; user: SessionUser }
  | { ok: false; response: NextResponse };

export async function requireApiPermission(permission: Permission): Promise<ApiGateResult> {
  const user = await getCurrentUser();
  if (!user) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Not authenticated' }, { status: 401 }),
    };
  }
  if (!hasPermission(user.permissions, permission)) {
    // 403, not 404: the caller is authenticated and the route exists — they
    // simply do not hold this workspace. Distinguishing the two is what makes
    // the failure debuggable when a role is misconfigured.
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'You do not have access to this workspace.' },
        { status: 403 },
      ),
    };
  }
  return { ok: true, user };
}
