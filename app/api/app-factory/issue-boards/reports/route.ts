import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth/session';
import { connectToDatabase } from '@/lib/mongodb/connect';
import { QaIssueBoard } from '@/lib/mongodb/models/QaIssueBoard';
import { QaIssueCard } from '@/lib/mongodb/models/QaIssueCard';

/**
 * Report data for the AI Issue Boards reports view: issue summary, developer
 * performance, resolution, reopened, and module-wise breakdowns. The client
 * renders and exports these to PDF / Excel / CSV.
 */

function hoursBetween(from: Date | null | undefined, to: Date | null | undefined): number | null {
  if (!from || !to) return null;
  return Math.round(((new Date(to).getTime() - new Date(from).getTime()) / 3600000) * 10) / 10;
}

export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  await connectToDatabase();

  const sp = new URL(req.url).searchParams;
  const boardId = sp.get('boardId');
  const project = sp.get('project');
  const dateFrom = sp.get('dateFrom') ? new Date(sp.get('dateFrom') as string) : null;
  const dateTo = sp.get('dateTo') ? new Date(`${sp.get('dateTo')}T23:59:59.999Z`) : null;

  const query: Record<string, unknown> = {};
  if (boardId && boardId !== 'all') query.boardId = boardId;
  if (project && project !== 'all') query.projectName = project;
  if (dateFrom || dateTo) {
    query.createdAt = {
      ...(dateFrom ? { $gte: dateFrom } : {}),
      ...(dateTo ? { $lte: dateTo } : {}),
    };
  }

  const cards = await QaIssueCard.find(query).select(
    'issueKey title status severity priority category module labels assignedToName '
    + 'projectName applicationName executionId platform reopenCount createdAt closedAt '
    + 'firstAssignedAt readyForQaAt boardId',
  ).lean<any[]>();

  const boards = await QaIssueBoard.find(
    boardId && boardId !== 'all' ? { _id: boardId } : project && project !== 'all' ? { projectName: project } : {},
  ).select('boardName projectName applicationName executionId totalIssues closedIssues openIssues status executedAt executedByName moduleType platform')
    .sort({ executedAt: -1 }).lean<any[]>();

  // ---- Issue summary ----
  const bucket = (key: string) => cards.filter((c) => c.status === key).length;
  const issueSummary = {
    totalIssues: cards.length,
    new: bucket('new'),
    assigned: bucket('assigned'),
    inProgress: bucket('in_progress'),
    readyForQa: bucket('ready_for_qa'),
    reopened: bucket('reopened'),
    closed: bucket('closed'),
    bySeverity: ['critical', 'high', 'medium', 'low'].map((s) => ({
      severity: s, count: cards.filter((c) => c.severity === s).length,
    })),
    byPriority: ['p1', 'p2', 'p3', 'p4'].map((p) => ({
      priority: p, count: cards.filter((c) => c.priority === p).length,
    })),
    byCategory: Array.from(new Set(cards.map((c) => c.category))).map((cat) => ({
      category: cat, count: cards.filter((c) => c.category === cat).length,
    })).sort((a, b) => b.count - a.count),
  };

  // ---- Developer performance ----
  const developers = Array.from(new Set(cards.map((c) => c.assignedToName).filter(Boolean)));
  const developerPerformance = developers.map((name) => {
    const own = cards.filter((c) => c.assignedToName === name);
    const closed = own.filter((c) => c.status === 'closed');
    const times = closed.map((c) => hoursBetween(c.firstAssignedAt ?? c.createdAt, c.closedAt)).filter((n): n is number => n != null);
    return {
      developer: name,
      assigned: own.length,
      inProgress: own.filter((c) => c.status === 'in_progress').length,
      readyForQa: own.filter((c) => c.status === 'ready_for_qa').length,
      closed: closed.length,
      reopened: own.filter((c) => (c.reopenCount ?? 0) > 0).length,
      critical: own.filter((c) => c.severity === 'critical').length,
      avgResolutionHours: times.length > 0
        ? Math.round((times.reduce((a, b) => a + b, 0) / times.length) * 10) / 10
        : null,
      closureRate: own.length > 0 ? Math.round((closed.length / own.length) * 100) : 0,
    };
  }).sort((a, b) => b.closed - a.closed);

  // ---- Resolution report ----
  const resolution = cards.filter((c) => c.status === 'closed').map((c) => ({
    issueKey: c.issueKey,
    title: c.title,
    severity: c.severity,
    priority: c.priority,
    developer: c.assignedToName || 'Unassigned',
    project: c.projectName,
    executionId: c.executionId,
    createdAt: c.createdAt,
    closedAt: c.closedAt,
    resolutionHours: hoursBetween(c.createdAt, c.closedAt),
    reopenCount: c.reopenCount ?? 0,
  })).sort((a, b) => (b.resolutionHours ?? 0) - (a.resolutionHours ?? 0));

  // ---- Reopened report ----
  const reopened = cards.filter((c) => (c.reopenCount ?? 0) > 0).map((c) => ({
    issueKey: c.issueKey,
    title: c.title,
    status: c.status,
    severity: c.severity,
    developer: c.assignedToName || 'Unassigned',
    project: c.projectName,
    application: c.applicationName,
    executionId: c.executionId,
    module: c.module,
    reopenCount: c.reopenCount ?? 0,
  })).sort((a, b) => b.reopenCount - a.reopenCount);

  // ---- Module-wise report ----
  const modules = Array.from(new Set(cards.map((c) => c.module || 'Unspecified')));
  const moduleWise = modules.map((mod) => {
    const own = cards.filter((c) => (c.module || 'Unspecified') === mod);
    return {
      module: mod,
      totalIssues: own.length,
      critical: own.filter((c) => c.severity === 'critical').length,
      high: own.filter((c) => c.severity === 'high').length,
      open: own.filter((c) => c.status !== 'closed').length,
      closed: own.filter((c) => c.status === 'closed').length,
      reopened: own.filter((c) => (c.reopenCount ?? 0) > 0).length,
    };
  }).sort((a, b) => b.totalIssues - a.totalIssues);

  return NextResponse.json({
    issueSummary,
    developerPerformance,
    resolution,
    reopened,
    moduleWise,
    boards: boards.map((b) => ({
      id: String(b._id),
      boardName: b.boardName,
      projectName: b.projectName,
      applicationName: b.applicationName,
      executionId: b.executionId,
      moduleType: b.moduleType,
      platform: b.platform,
      status: b.status,
      totalIssues: b.totalIssues,
      closedIssues: b.closedIssues,
      openIssues: b.openIssues,
      executedByName: b.executedByName,
      executedAt: b.executedAt,
    })),
  });
}
