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

  const docs = await QaScreenshot.find({ runId }).sort({ createdAt: -1 }).limit(60).lean();
  return NextResponse.json({ screenshots: docs.map(serializeDoc) });
}
