import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth/session';
import { connectToDatabase } from '@/lib/mongodb/connect';
import { RecruitmentSourceSettings } from '@/lib/mongodb/models/RecruitmentSourceSettings';
import { serializeDoc } from '@/lib/mongodb/serialize';

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  await connectToDatabase();
  const existing = await RecruitmentSourceSettings.findOne({ userId: user.id }).lean();
  const doc = existing ?? (await RecruitmentSourceSettings.create({ userId: user.id })).toObject();
  return NextResponse.json({ settings: serializeDoc(doc) });
}
