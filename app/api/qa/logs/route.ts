import { NextResponse } from 'next/server';
import { requireApiPermission } from '@/lib/auth/api-guard';
import { connectToDatabase } from '@/lib/mongodb/connect';
import { QaTestRun } from '@/lib/mongodb/models/QaTestRun';
import { QaLogEntry } from '@/lib/mongodb/models/QaLogEntry';
import { serializeDoc } from '@/lib/mongodb/serialize';

export async function GET(req: Request) {
  const gate = await requireApiPermission('workspace:qa');
  if (!gate.ok) return gate.response;
  const user = gate.user;

  const url = new URL(req.url);
  const runId = url.searchParams.get('runId');
  if (!runId) return NextResponse.json({ error: 'runId is required' }, { status: 400 });

  await connectToDatabase();
  const run = await QaTestRun.findOne({ _id: runId, userId: user.id }).lean();
  if (!run) return NextResponse.json({ logs: [] }, { status: 404 });

  const docs = await QaLogEntry.find({ runId }).sort({ createdAt: 1 }).limit(500).lean();
  return NextResponse.json({ logs: docs.map(serializeDoc) });
}
