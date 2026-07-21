import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth/session';
import { connectToDatabase } from '@/lib/mongodb/connect';
import { QaTestRun } from '@/lib/mongodb/models/QaTestRun';
import { QaProject } from '@/lib/mongodb/models/QaProject';
import { QaBug } from '@/lib/mongodb/models/QaBug';
import { serializeDoc } from '@/lib/mongodb/serialize';

export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const params = new URL(req.url).searchParams;
  const limit = Number(params.get('limit') ?? '20');
  const search = params.get('search')?.toLowerCase().trim() || null;
  const device = params.get('device') || null;
  const status = params.get('status') || null;
  const executedBy = params.get('executedBy')?.toLowerCase().trim() || null;
  const dateFrom = params.get('dateFrom') ? new Date(params.get('dateFrom') as string) : null;
  const dateTo = params.get('dateTo') ? new Date(params.get('dateTo') as string) : null;
  const sort = params.get('sort') ?? 'latest';

  await connectToDatabase();

  const query: Record<string, unknown> = { userId: user.id };
  if (status) query.status = status;
  if (executedBy) query.executedByName = { $regex: executedBy, $options: 'i' };
  if (device) query.currentDevice = { $regex: device, $options: 'i' };
  if (dateFrom || dateTo) {
    query.createdAt = {
      ...(dateFrom ? { $gte: dateFrom } : {}),
      ...(dateTo ? { $lte: dateTo } : {}),
    };
  }

  const docs = await QaTestRun.find(query).sort({ createdAt: -1 }).lean();
  const projectIds = docs.map((d: any) => d.projectId);
  const projects = await QaProject.find({ _id: { $in: projectIds } }).lean();
  const projectById = new Map(projects.map((p: any) => [String(p._id), serializeDoc(p)]));

  const bugCounts = await QaBug.aggregate([
    { $match: { runId: { $in: docs.map((d: any) => d._id) } } },
    { $group: { _id: '$runId', count: { $sum: 1 } } },
  ]);
  const bugCountByRun = new Map(bugCounts.map((b: any) => [String(b._id), b.count]));

  let runs = docs.map((d: any) => ({
    ...serializeDoc(d),
    project: projectById.get(String(d.projectId)),
    bugCount: bugCountByRun.get(String(d._id)) ?? 0,
  }));

  if (search) {
    runs = runs.filter((r: any) =>
      r.project?.name?.toLowerCase().includes(search)
      || r.runName?.toLowerCase().includes(search)
      || String(r.runNumber).includes(search));
  }

  switch (sort) {
    case 'oldest':
      runs.sort((a: any, b: any) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
      break;
    case 'duration':
      runs.sort((a: any, b: any) => {
        const durA = a.startedAt && a.completedAt ? new Date(a.completedAt).getTime() - new Date(a.startedAt).getTime() : 0;
        const durB = b.startedAt && b.completedAt ? new Date(b.completedAt).getTime() - new Date(b.startedAt).getTime() : 0;
        return durB - durA;
      });
      break;
    case 'bugCount':
      runs.sort((a: any, b: any) => b.bugCount - a.bugCount);
      break;
    default:
      runs.sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  return NextResponse.json({ runs: runs.slice(0, limit), total: runs.length });
}
