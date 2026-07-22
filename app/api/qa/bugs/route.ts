import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth/session';
import { connectToDatabase } from '@/lib/mongodb/connect';
import { QaBug } from '@/lib/mongodb/models/QaBug';
import { QaTestRun } from '@/lib/mongodb/models/QaTestRun';
import { serializeDoc } from '@/lib/mongodb/serialize';

export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const url = new URL(req.url);
  const runId = url.searchParams.get('runId');
  const type = url.searchParams.get('type');
  const severity = url.searchParams.get('severity');
  const search = url.searchParams.get('search');
  const limit = Number(url.searchParams.get('limit') ?? '100');

  await connectToDatabase();

  if (runId) {
    const run = await QaTestRun.findOne({ _id: runId, userId: user.id }).lean();
    if (!run) return NextResponse.json({ bugs: [] });
  }

  const query: Record<string, unknown> = { userId: user.id };
  if (runId) query.runId = runId;
  if (type) query.type = type;
  if (severity) query.severity = severity;
  if (search) {
    query.$or = [
      { title: { $regex: search, $options: 'i' } },
      { screenName: { $regex: search, $options: 'i' } },
      { module: { $regex: search, $options: 'i' } },
    ];
  }

  const docs = await QaBug.find(query).sort({ createdAt: -1 }).limit(limit).lean();
  return NextResponse.json({ bugs: docs.map(serializeDoc) });
}
