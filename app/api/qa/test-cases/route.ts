import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth/session';
import { connectToDatabase } from '@/lib/mongodb/connect';
import { QaTestRun } from '@/lib/mongodb/models/QaTestRun';
import { QaTestCaseResult } from '@/lib/mongodb/models/QaTestCaseResult';
import { QaUploadedTestCase } from '@/lib/mongodb/models/QaUploadedTestCase';
import { serializeDoc } from '@/lib/mongodb/serialize';

export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const runId = new URL(req.url).searchParams.get('runId');
  if (!runId) return NextResponse.json({ error: 'runId is required' }, { status: 400 });

  await connectToDatabase();
  const run = await QaTestRun.findOne({ _id: runId, userId: user.id }).lean();
  if (!run) return NextResponse.json({ testCases: [] }, { status: 404 });

  if ((run as any).sourceMode === 'uploaded') {
    const docs = await QaUploadedTestCase.find({ runId }).sort({ order: 1 }).lean();
    const testCases = docs.map((d: any) => ({
      ...serializeDoc(d),
      name: d.scenario,
      screen: d.screenName,
      result: d.result === 'pass' ? 'pass' : d.result === 'fail' ? 'fail' : d.result,
      failedStepNumber: d.failedStepIndex != null ? d.failedStepIndex + 1 : null,
    }));
    return NextResponse.json({ testCases });
  }

  const docs = await QaTestCaseResult.find({ runId }).sort({ createdAt: 1 }).lean();
  return NextResponse.json({ testCases: docs.map(serializeDoc) });
}
