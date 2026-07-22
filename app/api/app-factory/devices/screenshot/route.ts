import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth/session';
import { captureScreenshot } from '@/lib/build/toolchain';

export const runtime = 'nodejs';

/** Returns a live PNG screenshot of a device for the on-page mirror. */
export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const serial = new URL(req.url).searchParams.get('serial');
  if (!serial) return NextResponse.json({ error: 'serial is required' }, { status: 400 });

  const png = await captureScreenshot(serial);
  if (!png) return NextResponse.json({ error: 'Screenshot unavailable' }, { status: 404 });

  return new NextResponse(png, {
    headers: {
      'Content-Type': 'image/png',
      'Cache-Control': 'no-store, no-cache, must-revalidate',
    },
  });
}
