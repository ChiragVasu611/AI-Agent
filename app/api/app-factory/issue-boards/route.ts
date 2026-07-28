import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth/session';
import { connectToDatabase } from '@/lib/mongodb/connect';
import { QaIssueBoard } from '@/lib/mongodb/models/QaIssueBoard';
import { QaIssueCard } from '@/lib/mongodb/models/QaIssueCard';
import { serializeDoc } from '@/lib/mongodb/serialize';
import { backfillIssueBoards } from '@/lib/issue-boards/sync';

/**
 * AI Issue Boards — board list.
 *
 * Boards are readable by every AI App Factory user, not just the QA engineer
 * who ran the execution: the whole point of the module is that a developer
 * picks up work QA produced.
 *
 * Each request first backfills boards for any completed execution that does
 * not have one yet, so a board always exists for every finished run even if
 * the app restarted between completion and this request.
 */
export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  await connectToDatabase();
  await backfillIssueBoards().catch((e) => console.error('Issue board backfill failed', e));

  const params = new URL(req.url).searchParams;
  const page = Math.max(1, Number(params.get('page') ?? '1') || 1);
  const pageSize = Math.min(60, Math.max(1, Number(params.get('pageSize') ?? '12') || 12));
  const search = params.get('search')?.toLowerCase().trim() || null;
  const project = params.get('project') || null;
  const application = params.get('application') || null;
  const executionId = params.get('executionId')?.trim() || null;
  const moduleType = params.get('moduleType') || null;
  const platform = params.get('platform') || null;
  const status = params.get('status') || null;
  const developer = params.get('developer') || null;
  const severity = params.get('severity') || null;
  const priority = params.get('priority') || null;
  const dateFrom = params.get('dateFrom') ? new Date(params.get('dateFrom') as string) : null;
  const dateTo = params.get('dateTo') ? new Date(`${params.get('dateTo')}T23:59:59.999Z`) : null;
  const sort = params.get('sort') ?? 'latest';

  const query: Record<string, unknown> = {};
  if (project && project !== 'all') query.projectName = project;
  if (application && application !== 'all') query.applicationName = application;
  if (moduleType && moduleType !== 'all') query.moduleType = moduleType;
  if (platform && platform !== 'all') query.platform = platform;
  if (status && status !== 'all') query.status = status;
  if (developer && developer !== 'all') query.assignedDevelopers = developer;
  if (severity && severity !== 'all') query.severities = severity;
  if (priority && priority !== 'all') query.priorities = priority;
  if (executionId) {
    const digits = executionId.replace(/[^0-9]/g, '');
    if (digits) query.executionNumber = Number(digits);
  }
  if (dateFrom || dateTo) {
    query.executedAt = {
      ...(dateFrom ? { $gte: dateFrom } : {}),
      ...(dateTo ? { $lte: dateTo } : {}),
    };
  }
  if (search) {
    query.$or = [
      { boardName: { $regex: search, $options: 'i' } },
      { projectName: { $regex: search, $options: 'i' } },
      { applicationName: { $regex: search, $options: 'i' } },
      { executedByName: { $regex: search, $options: 'i' } },
      { executionId: { $regex: search, $options: 'i' } },
      { deviceName: { $regex: search, $options: 'i' } },
    ];
  }

  const sortSpec: Record<string, 1 | -1> = sort === 'oldest'
    ? { executedAt: 1, createdAt: 1 }
    : sort === 'most_issues'
      ? { totalIssues: -1, executedAt: -1 }
      : sort === 'recently_updated'
        ? { lastActivityAt: -1 }
        : { executedAt: -1, createdAt: -1 };

  const total = await QaIssueBoard.countDocuments(query);
  const docs = await QaIssueBoard.find(query)
    .sort(sortSpec)
    .skip((page - 1) * pageSize)
    .limit(pageSize)
    .lean<any[]>();

  // Filter option values come from the full collection, not the current page,
  // so the dropdowns don't shrink as the user filters.
  const [projects, applications, platforms, developers] = await Promise.all([
    QaIssueBoard.distinct('projectName'),
    QaIssueBoard.distinct('applicationName'),
    QaIssueBoard.distinct('platform'),
    QaIssueCard.distinct('assignedToName', { assignedToName: { $ne: '' } }),
  ]);

  return NextResponse.json({
    boards: docs.map(serializeDoc),
    total,
    page,
    pageSize,
    filterOptions: {
      projects: (projects as string[]).filter(Boolean).sort(),
      applications: (applications as string[]).filter(Boolean).sort(),
      platforms: (platforms as string[]).filter(Boolean).sort(),
      developers: (developers as string[]).filter(Boolean).sort(),
    },
  });
}
