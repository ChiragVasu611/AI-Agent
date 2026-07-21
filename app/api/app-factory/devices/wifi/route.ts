import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth/session';
import { enableWifiAdb } from '@/lib/build/toolchain';

export const runtime = 'nodejs';

/** Switches a USB-connected physical device to wireless (Wi-Fi) adb. */
export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const serial = String(body.serial ?? '');
  if (!serial) return NextResponse.json({ error: 'serial is required' }, { status: 400 });

  const result = await enableWifiAdb(serial);
  return NextResponse.json(result);
}
