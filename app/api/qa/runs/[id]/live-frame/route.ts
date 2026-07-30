import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth/session';
import { connectToDatabase } from '@/lib/mongodb/connect';
import { QaTestRun } from '@/lib/mongodb/models/QaTestRun';
import { captureDeviceScreen } from '@/lib/qa/android-bridge';
import { scanDevices } from '@/lib/qa/device-detect';

/**
 * A single live frame from the device a run is executing on, for the Live
 * Tracking preview.
 *
 * The preview used to be driven entirely by stored step screenshots, so it only
 * ever moved when a step finished — on a slow step that reads as a frozen
 * picture. Capturing on demand here lets the panel stream the device in real
 * time while staying decoupled from step cadence, and keeps the response to one
 * image instead of re-sending the whole screenshot history on every poll.
 */
export const runtime = 'nodejs';

/**
 * Captures are shared per device and reused briefly. Several viewers (or a
 * remounting panel) polling at once must not each spawn their own `adb
 * screencap`: those calls contend with the engine's own uiautomator dumps and
 * would slow the very execution the panel is displaying.
 */
const FRAME_TTL_MS = 700;
const cache = new Map<string, { at: number; frame: string | null; inflight: Promise<string | null> | null }>();

async function cachedFrame(serial: string): Promise<string | null> {
  const now = Date.now();
  const entry = cache.get(serial);
  if (entry) {
    if (now - entry.at < FRAME_TTL_MS) return entry.frame;
    if (entry.inflight) return entry.inflight;
  }

  const inflight = captureDeviceScreen(serial)
    .catch(() => null)
    .then((frame) => {
      cache.set(serial, { at: Date.now(), frame, inflight: null });
      return frame;
    });
  cache.set(serial, { at: entry?.at ?? 0, frame: entry?.frame ?? null, inflight });
  return inflight;
}

export async function GET(req: Request, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  await connectToDatabase();
  const run = await QaTestRun.findOne({ _id: params.id, userId: user.id })
    .select('status deviceSerial')
    .lean<{ status: string; deviceSerial: string | null } | null>();
  if (!run) return NextResponse.json({ error: 'Run not found' }, { status: 404 });

  // Only a live run has anything to stream. Once it ends the stored step
  // screenshots are the record, so there is nothing to capture and no reason to
  // keep touching the device.
  if (run.status !== 'running') return NextResponse.json({ frame: null, live: false });

  let serial = run.deviceSerial ? String(run.deviceSerial) : null;
  if (!serial) {
    // Same resolution the engine uses when no device was explicitly selected.
    const scan = await scanDevices().catch(() => null);
    serial = scan?.devices.find((d) => d.platform === 'android' && d.state === 'online')?.id ?? null;
  }
  if (!serial) return NextResponse.json({ frame: null, live: false });

  const frame = await cachedFrame(serial);
  return NextResponse.json({ frame, live: frame != null }, {
    headers: { 'Cache-Control': 'no-store' },
  });
}
