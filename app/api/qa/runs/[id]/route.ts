import { NextResponse } from 'next/server';
import { requireApiPermission } from '@/lib/auth/api-guard';
import { connectToDatabase } from '@/lib/mongodb/connect';
import { QaTestRun } from '@/lib/mongodb/models/QaTestRun';
import { QaProject } from '@/lib/mongodb/models/QaProject';
import { serializeDoc } from '@/lib/mongodb/serialize';
import { reconcileStaleRuns } from '@/lib/qa/reconcile-runs';
import { deleteRunCascade } from '@/lib/qa/delete-run';

export const runtime = 'nodejs';

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const gate = await requireApiPermission('workspace:qa');
  if (!gate.ok) return gate.response;
  const user = gate.user;

  await connectToDatabase();
  // Self-heal zombie runs whose background worker died so the client stops
  // polling a run that can never finish (the "stuck at 96%" case).
  await reconcileStaleRuns(user.id);
  const doc = await QaTestRun.findOne({ _id: params.id, userId: user.id }).lean();
  if (!doc) return NextResponse.json({ run: null }, { status: 404 });

  const project = await QaProject.findById((doc as any).projectId).lean();

  return NextResponse.json({ run: { ...serializeDoc(doc), project: project ? serializeDoc(project) : null } });
}

/**
 * Permanently deletes a test run and ALL of its execution data (test-case
 * results, screenshots, logs, bugs, uploaded rows, issue board), plus the
 * project and its uploaded binary once this was the project's last run.
 * Only the owner can delete their own run. See lib/qa/delete-run.ts.
 */
export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const gate = await requireApiPermission('workspace:qa');
  if (!gate.ok) return gate.response;
  const user = gate.user;

  await connectToDatabase();
  const run = await QaTestRun.findOne({ _id: params.id, userId: user.id });
  if (!run) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const deleted = await deleteRunCascade({ _id: run._id, projectId: run.projectId });

  return NextResponse.json({ ok: true, deleted });
}
