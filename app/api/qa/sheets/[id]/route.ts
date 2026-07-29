import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth/session';
import { connectToDatabase } from '@/lib/mongodb/connect';
import { QaTestCaseSheet } from '@/lib/mongodb/models/QaTestCaseSheet';
import { serializeDoc } from '@/lib/mongodb/serialize';

/** Full sheet detail, including every version's rows — used by the built-in editor/viewer and Download. */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  await connectToDatabase();
  const sheet = await QaTestCaseSheet.findOne({ _id: params.id, userId: user.id }).lean();
  if (!sheet) return NextResponse.json({ error: 'Sheet not found.' }, { status: 404 });

  return NextResponse.json({ sheet: serializeDoc(sheet) }, { headers: { 'Cache-Control': 'no-store' } });
}
