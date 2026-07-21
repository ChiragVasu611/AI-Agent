import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth/session';
import { listDevices, toolchainStatus } from '@/lib/build/toolchain';

export const runtime = 'nodejs';

/** Lists connected devices/emulators and toolchain availability for the device panel. */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const [devices, status] = await Promise.all([listDevices(), toolchainStatus()]);
  return NextResponse.json({ devices, status });
}
