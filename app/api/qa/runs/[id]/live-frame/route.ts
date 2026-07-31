import { NextResponse } from 'next/server';
import { requireApiPermission } from '@/lib/auth/api-guard';
import { connectToDatabase } from '@/lib/mongodb/connect';
import { QaTestRun } from '@/lib/mongodb/models/QaTestRun';
import { QaScreenshot } from '@/lib/mongodb/models/QaScreenshot';

/**
 * A single live frame from the device a run is executing on, for the Live
 * Tracking preview.
 *
 * This used to also take its OWN independent `adb screencap` on a timer,
 * decoupled from step cadence, on the theory that this would make the panel
 * feel more continuously "live" than only updating on step boundaries. In
 * practice that was the freeze: a device screencap is genuinely slow
 * (multi-second on real hardware) and adb serializes commands to one device,
 * so this route's own captures queued behind whatever the engine itself was
 * doing (a uiautomator dump, a tap, a settle poll) — one real measurement hit
 * 8 seconds for a single poll. Every attempt to reuse-if-fresh still fell back
 * to that same contended path often enough to be visibly janky.
 *
 * The fix is architectural, not a bigger cache: this route now ONLY ever reads
 * the engine's own most recently stored step screenshot — a plain Mongo query,
 * no device I/O, so it can never contend with the run and never stalls. This
 * also happens to be a MORE faithful "synchronized with the current step"
 * signal than an arbitrarily-timed independent capture ever was: every frame
 * shown corresponds to an actual logged step boundary, not a mid-transition
 * moment that matches nothing in the log.
 */
export const runtime = 'nodejs';

export async function GET(req: Request, { params }: { params: { id: string } }) {
  const gate = await requireApiPermission('workspace:qa');
  if (!gate.ok) return gate.response;
  const user = gate.user;

  await connectToDatabase();
  const run = await QaTestRun.findOne({ _id: params.id, userId: user.id })
    .select('status')
    .lean<{ status: string } | null>();
  if (!run) return NextResponse.json({ error: 'Run not found' }, { status: 404 });

  // Only a live run has anything new to show. Once it ends the Screenshots tab
  // is the record; there is no "live" frame to keep polling for.
  if (run.status !== 'running') return NextResponse.json({ frame: null, live: false });

  const latestShot = await QaScreenshot.findOne({ runId: params.id })
    .sort({ createdAt: -1 })
    .select('imageDataUrl')
    .lean<{ imageDataUrl: string } | null>();

  return NextResponse.json({ frame: latestShot?.imageDataUrl ?? null, live: !!latestShot }, {
    headers: { 'Cache-Control': 'no-store' },
  });
}
