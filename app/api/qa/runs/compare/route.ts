import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth/session';
import { connectToDatabase } from '@/lib/mongodb/connect';
import { QaTestRun } from '@/lib/mongodb/models/QaTestRun';
import { QaProject } from '@/lib/mongodb/models/QaProject';
import { QaBug } from '@/lib/mongodb/models/QaBug';
import { serializeDoc } from '@/lib/mongodb/serialize';

async function loadRun(id: string, userId: string) {
  const doc = await QaTestRun.findOne({ _id: id, userId }).lean();
  if (!doc) return null;
  const project = await QaProject.findById((doc as any).projectId).lean();
  const bugs = await QaBug.find({ runId: id }).lean();
  const severityCounts = { critical: 0, high: 0, medium: 0, low: 0 };
  bugs.forEach((b: any) => { severityCounts[b.severity as keyof typeof severityCounts] += 1; });
  const durationSeconds = (doc as any).startedAt && (doc as any).completedAt
    ? Math.round((new Date((doc as any).completedAt).getTime() - new Date((doc as any).startedAt).getTime()) / 1000)
    : null;

  return {
    run: { ...serializeDoc(doc), project: project ? serializeDoc(project) : null },
    bugCount: bugs.length,
    severityCounts,
    durationSeconds,
  };
}

export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const params = new URL(req.url).searchParams;
  const a = params.get('a');
  const b = params.get('b');
  if (!a || !b) return NextResponse.json({ error: 'Both a and b run ids are required' }, { status: 400 });

  await connectToDatabase();
  const [runA, runB] = await Promise.all([loadRun(a, user.id), loadRun(b, user.id)]);
  if (!runA || !runB) return NextResponse.json({ error: 'One or both runs were not found' }, { status: 404 });

  return NextResponse.json({ a: runA, b: runB });
}
