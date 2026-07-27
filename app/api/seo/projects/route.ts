import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth/session';
import { hasPermission } from '@/lib/auth/permissions';
import { connectToDatabase } from '@/lib/mongodb/connect';
import { SeoProject } from '@/lib/mongodb/models/SeoProject';
import { serializeDoc } from '@/lib/mongodb/serialize';

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  if (!hasPermission(user.permissions, 'workspace:seo')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  await connectToDatabase();
  const docs = await SeoProject.find({ userId: user.id }).sort({ createdAt: -1 }).lean();
  return NextResponse.json({ projects: docs.map(serializeDoc) });
}
