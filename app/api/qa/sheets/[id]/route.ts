import { NextResponse } from 'next/server';
import { requireApiPermission } from '@/lib/auth/api-guard';
import { connectToDatabase } from '@/lib/mongodb/connect';
import { QaTestCaseSheet } from '@/lib/mongodb/models/QaTestCaseSheet';
import { serializeDoc } from '@/lib/mongodb/serialize';

/** Full sheet detail, including every version's rows — used by the built-in editor/viewer and Download. */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const gate = await requireApiPermission('workspace:qa');
  if (!gate.ok) return gate.response;
  const user = gate.user;

  await connectToDatabase();
  const sheet = await QaTestCaseSheet.findOne({ _id: params.id, userId: user.id }).lean();
  if (!sheet) return NextResponse.json({ error: 'Sheet not found.' }, { status: 404 });

  return NextResponse.json({ sheet: serializeDoc(sheet) }, { headers: { 'Cache-Control': 'no-store' } });
}
