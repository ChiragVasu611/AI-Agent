import { NextResponse } from 'next/server';
import { requireApiPermission } from '@/lib/auth/api-guard';
import { connectToDatabase } from '@/lib/mongodb/connect';
import { User } from '@/lib/mongodb/models/User';

export async function GET() {
  const gate = await requireApiPermission('workspace:qa');
  if (!gate.ok) return gate.response;
  const user = gate.user;

  await connectToDatabase();
  const dbUser = await User.findById(user.id).lean<{ qaOpenRouterApiKey: string | null; qaApiKeyTier: string | null }>();

  // Never echo the actual key back to the client — only whether one is set.
  return NextResponse.json({ hasKey: Boolean(dbUser?.qaOpenRouterApiKey), tier: dbUser?.qaApiKeyTier ?? null });
}
