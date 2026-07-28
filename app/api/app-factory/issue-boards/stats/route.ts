import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth/session';
import { connectToDatabase } from '@/lib/mongodb/connect';
import { QaIssueBoard } from '@/lib/mongodb/models/QaIssueBoard';
import { QaIssueCard } from '@/lib/mongodb/models/QaIssueCard';

/** Summary counters for the AI App Factory dashboard widgets. */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  await connectToDatabase();

  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  const [totalBoards, byStatus, critical, highPriority, fixedToday] = await Promise.all([
    QaIssueBoard.countDocuments({}),
    QaIssueCard.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
    QaIssueCard.countDocuments({ severity: 'critical', status: { $ne: 'closed' } }),
    QaIssueCard.countDocuments({ priority: 'p1', status: { $ne: 'closed' } }),
    QaIssueCard.countDocuments({ status: 'closed', closedAt: { $gte: startOfToday } }),
  ]);

  const count = (s: string) => (byStatus as any[]).find((r) => r._id === s)?.count ?? 0;
  const newCount = count('new');
  const assigned = count('assigned');
  const inProgress = count('in_progress');
  const reopened = count('reopened');

  return NextResponse.json({
    totalBoards,
    totalIssues: (byStatus as any[]).reduce((sum, r) => sum + r.count, 0),
    openIssues: newCount + assigned + inProgress + reopened,
    newIssues: newCount,
    assigned,
    inProgress,
    readyForQa: count('ready_for_qa'),
    closed: count('closed'),
    reopened,
    criticalIssues: critical,
    highPriorityIssues: highPriority,
    fixedToday,
  });
}
