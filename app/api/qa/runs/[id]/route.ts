import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth/session';
import { connectToDatabase } from '@/lib/mongodb/connect';
import { QaTestRun } from '@/lib/mongodb/models/QaTestRun';
import { QaProject } from '@/lib/mongodb/models/QaProject';
import { QaTestCaseResult } from '@/lib/mongodb/models/QaTestCaseResult';
import { QaScreenshot } from '@/lib/mongodb/models/QaScreenshot';
import { QaLogEntry } from '@/lib/mongodb/models/QaLogEntry';
import { QaBug } from '@/lib/mongodb/models/QaBug';
import { serializeDoc } from '@/lib/mongodb/serialize';

export const runtime = 'nodejs';

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  await connectToDatabase();
  const doc = await QaTestRun.findOne({ _id: params.id, userId: user.id }).lean();
  if (!doc) return NextResponse.json({ run: null }, { status: 404 });

  const project = await QaProject.findById((doc as any).projectId).lean();

  return NextResponse.json({ run: { ...serializeDoc(doc), project: project ? serializeDoc(project) : null } });
}

/**
 * Permanently deletes a test run and ALL of its execution data
 * (test-case results, screenshots, logs, bugs) from the database.
 * Only the owner can delete their own run.
 */
export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  await connectToDatabase();
  const run = await QaTestRun.findOne({ _id: params.id, userId: user.id });
  if (!run) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const runId = run._id;
  const [results, screenshots, logs, bugs] = await Promise.all([
    QaTestCaseResult.deleteMany({ runId }),
    QaScreenshot.deleteMany({ runId }),
    QaLogEntry.deleteMany({ runId }),
    QaBug.deleteMany({ runId }),
  ]);
  await QaTestRun.deleteOne({ _id: runId });

  return NextResponse.json({
    ok: true,
    deleted: {
      run: 1,
      testCaseResults: results.deletedCount ?? 0,
      screenshots: screenshots.deletedCount ?? 0,
      logs: logs.deletedCount ?? 0,
      bugs: bugs.deletedCount ?? 0,
    },
  });
}
