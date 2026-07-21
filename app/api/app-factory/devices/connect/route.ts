import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth/session';
import { connectWireless } from '@/lib/build/toolchain';

export const runtime = 'nodejs';

/** Connects to a device over Wi-Fi by explicit IP address and port. */
export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const host = String(body.host ?? '').trim();
  const port = Number(body.port ?? 5555);

  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) {
    return NextResponse.json({ error: 'Enter a valid IPv4 address.' }, { status: 400 });
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return NextResponse.json({ error: 'Enter a valid port (1-65535).' }, { status: 400 });
  }

  const result = await connectWireless(host, port);
  return NextResponse.json(result);
}
