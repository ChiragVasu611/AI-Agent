import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth/session';
import { connectToDatabase } from '@/lib/mongodb/connect';
import { User } from '@/lib/mongodb/models/User';

/**
 * People an issue can be assigned to, and who can be @mentioned in a comment.
 * Developers and QA engineers plus the admins who oversee both.
 */
const ASSIGNABLE_ROLES = ['developer', 'qa', 'company_admin', 'super_admin'];

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  await connectToDatabase();

  const docs = await User.find({ role: { $in: ASSIGNABLE_ROLES }, isActive: true })
    .select('fullName email role')
    .sort({ fullName: 1, email: 1 })
    .lean<any[]>();

  return NextResponse.json({
    users: docs.map((u) => ({
      id: String(u._id),
      name: u.fullName || u.email,
      email: u.email,
      role: u.role,
    })),
  });
}
