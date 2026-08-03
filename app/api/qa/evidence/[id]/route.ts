import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth/session';
import { connectToDatabase } from '@/lib/mongodb/connect';
import { QaTestRun } from '@/lib/mongodb/models/QaTestRun';
import { QaScreenshot } from '@/lib/mongodb/models/QaScreenshot';
import { decodeDataUrl, getEvidenceStore } from '@/lib/qa/evidence/store';

export const runtime = 'nodejs';

/**
 * Streams one evidence frame.
 *
 * The client addresses frames by DOCUMENT ID, never by storage key: the key is
 * read from the database after an ownership check, so a caller cannot ask for an
 * arbitrary object in the store or walk out of it.
 *
 * Frames are immutable once written — each carries a unique key — so they are
 * served with a long immutable cache and an ETag. That is what makes the report
 * cheap: the gallery re-renders without re-downloading anything, where it
 * previously pulled every frame's base64 payload on each 1.5s poll.
 */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  await connectToDatabase();

  const shot = await QaScreenshot.findById(params.id)
    .select('runId storageKey contentType imageDataUrl sha256')
    .lean<{
      runId: unknown; storageKey?: string | null; contentType?: string | null;
      imageDataUrl?: string | null; sha256?: string | null;
    }>();
  if (!shot) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // Ownership is checked through the owning run — evidence is never public.
  const run = await QaTestRun.findOne({ _id: shot.runId, userId: user.id }).select('_id').lean();
  if (!run) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const cacheHeaders = (etag: string | null) => ({
    'Cache-Control': 'private, max-age=31536000, immutable',
    ...(etag ? { ETag: `"${etag}"` } : {}),
  });

  // Preferred path: bytes live in the evidence store.
  if (shot.storageKey) {
    const store = await getEvidenceStore();
    const found = await store.get(shot.storageKey);
    if (!found) {
      // Be explicit: the metadata exists but the bytes are gone. Reporting this
      // as a 404 with a reason beats serving a substitute image.
      return NextResponse.json(
        { error: 'The stored evidence for this frame is missing from the evidence store.' },
        { status: 410 },
      );
    }
    return new NextResponse(new Uint8Array(found.body), {
      status: 200,
      headers: {
        'Content-Type': shot.contentType ?? found.contentType,
        'Content-Length': String(found.bytes),
        ...cacheHeaders(shot.sha256 ?? null),
      },
    });
  }

  // Legacy/inline path: frames captured before the migration, and frames written
  // by engines that still embed their payload. Decoded and served as real bytes
  // so every consumer can use one uniform URL.
  if (shot.imageDataUrl) {
    const decoded = decodeDataUrl(shot.imageDataUrl);
    if (!decoded) return NextResponse.json({ error: 'Unreadable inline payload' }, { status: 500 });
    return new NextResponse(new Uint8Array(decoded.data), {
      status: 200,
      headers: {
        'Content-Type': decoded.contentType,
        'Content-Length': String(decoded.data.length),
        ...cacheHeaders(shot.sha256 ?? null),
      },
    });
  }

  return NextResponse.json({ error: 'This frame has no stored bytes.' }, { status: 410 });
}
