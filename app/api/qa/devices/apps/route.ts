import { NextResponse } from 'next/server';
import { requireApiPermission } from '@/lib/auth/api-guard';
import { listDevices, listInstalledApps } from '@/lib/qa/adb';

export const runtime = 'nodejs';

/**
 * Lists the user-installed apps on a connected device, so a run can target an
 * app that is already on the phone instead of uploading an APK.
 *
 * GET /api/qa/devices/apps?serial=<device>   (serial optional — first online
 * device is used when omitted)
 *
 * The serial is validated against the actually-attached devices before any
 * shell command is issued, so an arbitrary string can never be interpolated
 * into an adb invocation.
 */
export async function GET(req: Request) {
  const gate = await requireApiPermission('workspace:qa');
  if (!gate.ok) return gate.response;

  const requested = new URL(req.url).searchParams.get('serial')?.trim() || '';

  const devices = await listDevices();
  const online = devices.filter((d) => d.status === 'online');
  if (online.length === 0) {
    return NextResponse.json(
      { error: 'No device is connected. Connect a device with USB debugging enabled and try again.', apps: [] },
      { status: 409 },
    );
  }

  const target = requested ? online.find((d) => d.id === requested) : online[0];
  if (!target) {
    return NextResponse.json(
      { error: 'That device is no longer connected. Reload the device list and try again.', apps: [] },
      { status: 409 },
    );
  }

  const apps = await listInstalledApps(target.id);
  return NextResponse.json({ apps, serial: target.id, deviceName: target.name ?? target.id });
}
