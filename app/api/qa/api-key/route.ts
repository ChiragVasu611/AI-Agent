import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth/session';
import { connectToDatabase } from '@/lib/mongodb/connect';
import { User } from '@/lib/mongodb/models/User';

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  await connectToDatabase();
  const dbUser = await User.findById(user.id).lean<{ qaOpenRouterApiKey: string | null; qaApiKeyTier: string | null }>();

  // Never echo the actual key back to the client — only whether one is set.
  return NextResponse.json({ hasKey: Boolean(dbUser?.qaOpenRouterApiKey), tier: dbUser?.qaApiKeyTier ?? null });
}
