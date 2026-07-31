import { NextResponse } from 'next/server';
import { requireApiPermission } from '@/lib/auth/api-guard';
import { connectWireless, pairWireless, disconnectWireless } from '@/lib/qa/adb';
import { scanDevices } from '@/lib/qa/device-detect';

export const runtime = 'nodejs';
// Device state tracks physical hardware — never serve a cached scan.
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET() {
  const gate = await requireApiPermission('workspace:qa');
  if (!gate.ok) return gate.response;

  const scan = await scanDevices();
  const online = scan.devices.filter((d) => d.state === 'online');

  return NextResponse.json({
    ...scan,
    // `devices` keeps the full list so the UI can explain unauthorized/offline
    // hardware; `online` is the subset actually usable for test execution.
    online,
    configured: scan.android.toolAvailable || scan.ios.toolAvailable,
  }, { headers: { 'Cache-Control': 'no-store' } });
}

/**
 * Wireless device actions. Body: { action: 'connect' | 'pair' | 'disconnect', host, port, code? }.
 * `connect` attaches a device already in wireless-debugging mode; `pair` runs
 * the Android 11+ pairing flow with a 6-digit code shown on the phone.
 */
export async function POST(req: Request) {
  const gate = await requireApiPermission('workspace:qa');
  if (!gate.ok) return gate.response;

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
