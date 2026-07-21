import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth/session';
import { getDeviceAdapter } from '@/lib/qa/device-adapter';

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const adapter = getDeviceAdapter();
  const devices = await adapter.listDevices();
  return NextResponse.json({ devices, configured: adapter.isConfigured() });
}
