import { jwtVerify } from 'jose';
import { NextResponse, type NextRequest } from 'next/server';

const PUBLIC_PATHS = ['/', '/login', '/signup', '/forgot-password', '/reset-password'];

const secret = new TextEncoder().encode(process.env.AUTH_SECRET ?? 'dev-only-insecure-secret-change-me');

function isPublic(path: string) {
  return PUBLIC_PATHS.some((p) => path === p || path.startsWith(p + '/'));
}

async function hasValidSession(req: NextRequest) {
  const token = req.cookies.get('session')?.value;
  if (!token) return false;
  try {
    await jwtVerify(token, secret);
    return true;
  } catch {
    return false;
  }
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const res = NextResponse.next({ request: { headers: req.headers } });

  const authed = await hasValidSession(req);

  if (authed && isPublic(pathname)) {
    const url = req.nextUrl.clone();
    url.pathname = '/dashboard';
    return NextResponse.redirect(url);
  }

  if (!authed && (pathname === '/dashboard' || pathname.startsWith('/dashboard/'))) {
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    url.searchParams.set('redirect', pathname);
    return NextResponse.redirect(url);
  }

  return res;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|css|js)$).*)'],
};
