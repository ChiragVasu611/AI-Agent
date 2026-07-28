import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth/session';
import { connectToDatabase } from '@/lib/mongodb/connect';
import { QaIssueBoard } from '@/lib/mongodb/models/QaIssueBoard';
import { QaIssueCard } from '@/lib/mongodb/models/QaIssueCard';
import { serializeDoc } from '@/lib/mongodb/serialize';

/** Full issue record — evidence, AI analysis, threaded comments and timeline. */
export async function GET(_req: Request, { params }: { params: { cardId: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  await connectToDatabase();

  const card = await QaIssueCard.findById(params.cardId).lean<any>().catch(() => null);
  if (!card) return NextResponse.json({ error: 'Issue not found' }, { status: 404 });

  const board = await QaIssueBoard.findById(card.boardId).lean<any>();

  return NextResponse.json({
    issue: {
      ...serializeDoc(card),
      comments: (card.comments ?? []).map((c: any) => ({
        ...serializeDoc(c),
        parentId: c.parentId ? String(c.parentId) : null,
        authorUserId: c.authorUserId ? String(c.authorUserId) : null,
      })),
      activity: (card.activity ?? []).map((a: any) => ({
        ...serializeDoc(a),
        actorUserId: a.actorUserId ? String(a.actorUserId) : null,
      })),
      attachments: (card.attachments ?? []).map((a: any) => serializeDoc(a)),
    },
    board: board ? serializeDoc(board) : null,
  });
}
