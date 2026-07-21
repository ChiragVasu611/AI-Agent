import { jwtVerify } from 'jose';
import { NextResponse, type NextRequest } from 'next/server';
import { permissionForPath, permissionsForRole, hasPermission, roleHome } from '@/lib/auth/permissions';

const PUBLIC_PATHS = ['/', '/login', '/signup', '/forgot-password', '/reset-password'];

const secret = new TextEncoder().encode(process.env.AUTH_SECRET ?? 'dev-only-insecure-secret-change-me');

function isPublic(path: string) {
  return PUBLIC_PATHS.some((p) => path === p || path.startsWith(p + '/'));
}

async function readSession(req: NextRequest): Promise<{ role: string } | null> {
  const token = req.cookies.get('session')?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret);
    return typeof payload.role === 'string' ? { role: payload.role } : null;
  } catch {
    return null;
  }
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const session = await readSession(req);

  if (session && isPublic(pathname)) {
    const url = req.nextUrl.clone();
    url.pathname = roleHome(session.role);
    return NextResponse.redirect(url);
  }

  const requiredPermission = permissionForPath(pathname);
  if (requiredPermission) {
    if (!session) {
      const url = req.nextUrl.clone();
      url.pathname = '/login';
      url.searchParams.set('redirect', pathname);
      return NextResponse.redirect(url);
    }

    const perms = permissionsForRole(session.role);
    if (!hasPermission(perms, requiredPermission)) {
      const url = req.nextUrl.clone();
      url.pathname = '/403';
      return NextResponse.redirect(url);
    }
  }

  return NextResponse.next({ request: { headers: req.headers } });
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|css|js)$).*)'],
};
