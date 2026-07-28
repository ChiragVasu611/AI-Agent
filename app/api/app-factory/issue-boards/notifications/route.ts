import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth/session';
import { connectToDatabase } from '@/lib/mongodb/connect';
import { Notification } from '@/lib/mongodb/models/Notification';
import { serializeDoc } from '@/lib/mongodb/serialize';

/** Only this module's notifications — HR/SEO alerts keep their own inboxes. */
const TYPE_PREFIX = /^issue_board\./;

export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const limit = Math.min(50, Number(new URL(req.url).searchParams.get('limit') ?? '20') || 20);
  await connectToDatabase();

  const docs = await Notification.find({ userId: user.id, type: TYPE_PREFIX })
    .sort({ createdAt: -1 }).limit(limit).lean<any[]>();
  const unreadCount = await Notification.countDocuments({ userId: user.id, type: TYPE_PREFIX, read: false });

  return NextResponse.json({ notifications: docs.map(serializeDoc), unreadCount });
}

export async function PATCH(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  await connectToDatabase();

  if (body.markAllRead) {
    await Notification.updateMany({ userId: user.id, type: TYPE_PREFIX, read: false }, { read: true });
  } else if (body.id) {
    await Notification.findOneAndUpdate({ _id: body.id, userId: user.id }, { read: true });
  }

  return NextResponse.json({ ok: true });
}
