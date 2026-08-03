import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth/session';
import { connectToDatabase } from '@/lib/mongodb/connect';
import { QaTestRun } from '@/lib/mongodb/models/QaTestRun';
import { QaScreenshot } from '@/lib/mongodb/models/QaScreenshot';
import { serializeDoc } from '@/lib/mongodb/serialize';

export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const url = new URL(req.url);
  const runId = url.searchParams.get('runId');
  if (!runId) return NextResponse.json({ error: 'runId is required' }, { status: 400 });

  await connectToDatabase();
  const run = await QaTestRun.findOne({ _id: runId, userId: user.id }).lean();
  if (!run) return NextResponse.json({ screenshots: [] }, { status: 404 });

  // Take the 60 most recent frames, then hand them back oldest → newest.
  // Callers treat the last element as the current frame ("latest screenshot",
  // live preview) and render the gallery in chronological order; returning
  // newest-first made the *oldest* of the last 60 frames read as the live one,
  // so the preview showed a badly stale screen and looked frozen.
  //
  // Frames stored in the evidence store are returned as METADATA + a `url` that
  // the browser fetches lazily and caches immutably. Embedding the bytes here
  // meant this endpoint returned tens of megabytes on every 1.5s poll of a live
  // run (measured: 662 KB average per frame, 60 frames per response).
  //
  // `imageDataUrl` is still passed through when a document actually has one.
  // Pre-migration frames carry inline payloads, as do frames written by the AI
  // Test Case Execution engine, whose UI reads that field directly — dropping it
  // would break a working module.
  const docs = await QaScreenshot.find({ runId })
    .sort({ createdAt: -1 })
    .limit(60)
    .lean<Array<Record<string, unknown>>>();

  const screenshots = docs.reverse().map((d) => {
    const base = serializeDoc(d);
    return {
      ...base,
      // One uniform URL for every frame, whichever way its bytes are held.
      url: `/api/qa/evidence/${base.id}`,
    };
  });

  return NextResponse.json({ screenshots });
}
