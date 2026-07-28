import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth/session';
import { getDeviceAdapter } from '@/lib/qa/device-adapter';
import { connectWireless, pairWireless, disconnectWireless } from '@/lib/qa/adb';

export const runtime = 'nodejs';

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const adapter = getDeviceAdapter();
  const [devices, configured] = await Promise.all([adapter.listDevices(), adapter.isConfigured()]);
  return NextResponse.json({ devices, configured });
}

/**
 * Wireless device actions. Body: { action: 'connect' | 'pair' | 'disconnect', host, port, code? }.
 * `connect` attaches a device already in wireless-debugging mode; `pair` runs
 * the Android 11+ pairing flow with a 6-digit code shown on the phone.
 */
export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  let body: { action?: string; host?: string; port?: string | number; code?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }

  const action = String(body.action ?? '');
  const host = String(body.host ?? '').trim();
  const port = Number(body.port);

  if (action === 'disconnect') {
    if (!host) return NextResponse.json({ error: 'A device target is required.' }, { status: 400 });
    const res = await disconnectWireless(port ? `${host}:${port}` : host);
    return NextResponse.json(res);
  }

  if (!host || !port || Number.isNaN(port)) {
    return NextResponse.json({ error: 'A valid IP address and port are required.' }, { status: 400 });
  }

  if (action === 'connect') {
    const res = await connectWireless(host, port);
    return NextResponse.json(res, { status: res.ok ? 200 : 400 });
  }

  if (action === 'pair') {
    const code = String(body.code ?? '').trim();
    if (!code) return NextResponse.json({ error: 'A pairing code is required.' }, { status: 400 });
    const res = await pairWireless(host, port, code);
    return NextResponse.json(res, { status: res.ok ? 200 : 400 });
  }

  return NextResponse.json({ error: 'Unknown action.' }, { status: 400 });
}
