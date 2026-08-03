import { NextResponse } from 'next/server';
import { requireApiPermission } from '@/lib/auth/api-guard';
import { connectToDatabase } from '@/lib/mongodb/connect';
import { QaTestRun } from '@/lib/mongodb/models/QaTestRun';
import { QaScreenshot } from '@/lib/mongodb/models/QaScreenshot';

/**
 * One live snapshot of the run: the current device frame AND the text that
 * describes it, read together.
 *
 * Two earlier designs failed here, in different ways.
 *
 * The first took its OWN `adb screencap` on a timer. That was the freeze: a
 * device capture is genuinely slow (multi-second on real hardware) and adb
 * serializes commands to one device, so this route's captures queued behind
 * whatever the engine was doing — one measured poll took 8 seconds.
 *
 * The second (this route's previous form) fixed the stall by reading only the
 * engine's most recent stored frame — a plain Mongo query, no device I/O — but
 * returned nothing except the image bytes. The panel's text tiles came from a
 * DIFFERENT endpoint on a DIFFERENT interval (1500ms for the run document
 * against 500ms here), so the image and the words beside it were routinely
 * describing different steps, and neither side could detect it because the
 * frame carried no identity.
 *
 * So this route now returns both halves from one read, and both halves are
 * stamped with the step they belong to (`stepNumber` on the frame,
 * `currentStepNumber` on the run). `inSync` tells the client whether the frame
 * on screen is the one the text is talking about, so the panel can caption a
 * lagging frame honestly instead of silently implying it is current.
 */
export const runtime = 'nodejs';

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const gate = await requireApiPermission('workspace:qa');
  if (!gate.ok) return gate.response;
  const user = gate.user;

  await connectToDatabase();
  const run = await QaTestRun.findOne({ _id: params.id, userId: user.id })
    .select([
      'status', 'progress',
      'currentModule', 'currentSuite', 'currentTestCaseId', 'currentScenario',
      'currentStep', 'currentStepNumber', 'currentExpected', 'currentActual',
      'currentStepStatus', 'currentScreen', 'currentCase',
      'passedCases', 'failedCases', 'blockedCases', 'skippedCases', 'totalCases',
    ].join(' '))
    .lean<Record<string, any> | null>();
  if (!run) return NextResponse.json({ error: 'Run not found' }, { status: 404 });

  const live = run.status === 'running';

  // The newest frame, whatever the run's state. Reading it even after the run
  // ends lets the client hold the final frame rather than blanking the panel
  // the instant the status flips.
  const latestShot = await QaScreenshot.findOne({ runId: params.id })
    .sort({ createdAt: -1 })
    .select('imageDataUrl screenName testStep testCaseId stepNumber createdAt')
    .lean<{
      imageDataUrl: string; screenName?: string; testStep?: string;
      testCaseId?: string; stepNumber?: number | null; createdAt?: Date;
    } | null>();

  // Does the frame belong to the step the text describes? Only meaningful when
  // both sides carry an identity; frames written before stamping existed are
  // reported as unknown (null) rather than falsely in-sync.
  const frameStep = latestShot?.stepNumber ?? null;
  const textStep = (run.currentStepNumber as number | null) ?? null;
  const frameCase = latestShot?.testCaseId ?? '';
  const textCase = (run.currentTestCaseId as string | null) ?? '';
  const identified = frameStep != null && textStep != null && Boolean(frameCase) && Boolean(textCase);
  const inSync = identified ? frameStep === textStep && frameCase === textCase : null;

  return NextResponse.json({
    live,
    frame: latestShot?.imageDataUrl ?? null,
    // What the frame itself is, so the panel can caption it truthfully.
    frameInfo: latestShot
      ? {
        screenName: latestShot.screenName ?? '',
        testStep: latestShot.testStep ?? '',
        testCaseId: latestShot.testCaseId ?? '',
        stepNumber: latestShot.stepNumber ?? null,
        capturedAt: latestShot.createdAt ? new Date(latestShot.createdAt).toISOString() : null,
      }
      : null,
    inSync,
    // The text tiles, from the SAME read as the frame above.
    current: {
      module: run.currentModule ?? run.currentSuite ?? null,
      testCaseId: run.currentTestCaseId ?? null,
      scenario: run.currentScenario ?? null,
      step: run.currentStep ?? null,
      stepNumber: textStep,
      expected: run.currentExpected ?? '',
      actual: run.currentActual ?? '',
      status: run.currentStepStatus ?? null,
      screen: run.currentScreen ?? null,
    },
    progress: run.progress ?? 0,
    counts: {
      passed: run.passedCases ?? 0,
      failed: run.failedCases ?? 0,
      blocked: run.blockedCases ?? 0,
      skipped: run.skippedCases ?? 0,
      total: run.totalCases ?? 0,
    },
  }, { headers: { 'Cache-Control': 'no-store' } });
}
