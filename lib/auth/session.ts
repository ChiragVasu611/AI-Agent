import { cookies } from 'next/headers';
import { SignJWT, jwtVerify } from 'jose';
import bcrypt from 'bcryptjs';
import { connectToDatabase } from '@/lib/mongodb/connect';
import { User } from '@/lib/mongodb/models/User';

const SESSION_COOKIE = 'session';
const secret = new TextEncoder().encode(process.env.AUTH_SECRET ?? 'dev-only-insecure-secret-change-me');

export interface SessionUser {
  id: string;
  email: string;
  fullName: string;
  role: string;
}

export async function hashPassword(password: string) {
  return bcrypt.hash(password, 10);
}

export async function verifyPassword(password: string, hash: string) {
  return bcrypt.compare(password, hash);
}

export async function signSessionToken(userId: string) {
  return new SignJWT({ sub: userId })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('30d')
    .sign(secret);
}

export async function verifySessionToken(token: string): Promise<string | null> {
  try {
    const { payload } = await jwtVerify(token, secret);
    return typeof payload.sub === 'string' ? payload.sub : null;
  } catch {
    return null;
  }
}

export async function setSessionCookie(token: string) {
  cookies().set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 60 * 24 * 30,
  });
}

export async function clearSessionCookie() {
  cookies().set(SESSION_COOKIE, '', { path: '/', maxAge: 0 });
}

export async function getCurrentUser(): Promise<SessionUser | null> {
  const token = cookies().get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const userId = await verifySessionToken(token);
  if (!userId) return null;

  await connectToDatabase();
  const user = await User.findById(userId).lean<{
    _id: unknown; email: string; fullName: string; role: string;
  }>();
  if (!user) return null;

  return {
    id: String(user._id),
    email: user.email,
    fullName: user.fullName ?? '',
    role: user.role ?? 'user',
  };
}
