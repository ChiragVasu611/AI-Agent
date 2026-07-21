import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth/session';
import { connectToDatabase } from '@/lib/mongodb/connect';
import { Notification } from '@/lib/mongodb/models/Notification';
import { serializeDoc } from '@/lib/mongodb/serialize';

export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const limit = Number(new URL(req.url).searchParams.get('limit') ?? '20');
  await connectToDatabase();
  const docs = await Notification.find({ userId: user.id }).sort({ createdAt: -1 }).limit(limit).lean();
  const unreadCount = await Notification.countDocuments({ userId: user.id, read: false });

  return NextResponse.json({ notifications: docs.map(serializeDoc), unreadCount });
}

export async function PATCH(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const body = await req.json();
  await connectToDatabase();

  if (body.markAllRead) {
    await Notification.updateMany({ userId: user.id, read: false }, { read: true });
  } else if (body.id) {
    await Notification.findOneAndUpdate({ _id: body.id, userId: user.id }, { read: true });
  }

  return NextResponse.json({ ok: true });
}
