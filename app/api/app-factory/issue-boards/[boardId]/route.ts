import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth/session';
import { connectToDatabase } from '@/lib/mongodb/connect';
import { QaIssueBoard } from '@/lib/mongodb/models/QaIssueBoard';
import { QaIssueCard } from '@/lib/mongodb/models/QaIssueCard';
import { serializeDoc } from '@/lib/mongodb/serialize';

/**
 * One board plus its cards, in the compact shape the Kanban renders.
 *
 * Heavy evidence (screenshots, logs, stack traces, comment bodies, activity)
 * is deliberately NOT returned here — the Trello-style card shows only its
 * summary fields, and the full record loads when an issue is opened.
 */
const CARD_FIELDS = [
  'issueKey', 'title', 'status', 'severity', 'priority', 'labels', 'order',
  'assignedToUserId', 'assignedToName', 'assignedToEmail', 'dueDate',
  'commentCount', 'attachmentCount', 'category', 'module', 'testCaseId',
  'reopenCount', 'createdAt', 'updatedAt',
].join(' ');

export async function GET(req: Request, { params }: { params: { boardId: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  await connectToDatabase();

  const board = await QaIssueBoard.findById(params.boardId).lean<any>().catch(() => null);
  if (!board) return NextResponse.json({ error: 'Board not found' }, { status: 404 });

  const sp = new URL(req.url).searchParams;
  const search = sp.get('search')?.trim() || null;
  const status = sp.get('status') || null;
  const severity = sp.get('severity') || null;
  const priority = sp.get('priority') || null;
  const label = sp.get('label') || null;
  const developer = sp.get('developer') || null;
  const dateFrom = sp.get('dateFrom') ? new Date(sp.get('dateFrom') as string) : null;
  const dateTo = sp.get('dateTo') ? new Date(`${sp.get('dateTo')}T23:59:59.999Z`) : null;

  const query: Record<string, unknown> = { boardId: board._id };
  if (status && status !== 'all') query.status = status;
  if (severity && severity !== 'all') query.severity = severity;
  if (priority && priority !== 'all') query.priority = priority;
  if (label && label !== 'all') query.labels = label;
  if (developer && developer !== 'all') query.assignedToName = developer;
  if (dateFrom || dateTo) {
    query.createdAt = {
      ...(dateFrom ? { $gte: dateFrom } : {}),
      ...(dateTo ? { $lte: dateTo } : {}),
    };
  }
  if (search) {
    query.$or = [
      { issueKey: { $regex: search, $options: 'i' } },
      { title: { $regex: search, $options: 'i' } },
      { testCaseId: { $regex: search, $options: 'i' } },
      { assignedToName: { $regex: search, $options: 'i' } },
      { labels: { $regex: search, $options: 'i' } },
    ];
  }

  const cards = await QaIssueCard.find(query)
    .select(CARD_FIELDS)
    .sort({ order: 1, createdAt: 1 })
    .lean<any[]>();

  const allLabels = await QaIssueCard.distinct('labels', { boardId: board._id });

  return NextResponse.json({
    board: serializeDoc(board),
    cards: cards.map(serializeDoc),
    labels: (allLabels as string[]).filter(Boolean).sort(),
  });
}
