import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth/session';
import { connectToDatabase } from '@/lib/mongodb/connect';
import { Candidate } from '@/lib/mongodb/models/Candidate';
import { serializeDoc } from '@/lib/mongodb/serialize';

export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const url = new URL(req.url);
  const page = Math.max(1, Number(url.searchParams.get('page') ?? '1'));
  const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit') ?? '20')));
  const search = url.searchParams.get('search');
  const skill = url.searchParams.get('skill');
  const minExperience = url.searchParams.get('minExperience');
  const sort = url.searchParams.get('sort') ?? '-createdAt';

  await connectToDatabase();

  const query: Record<string, unknown> = { userId: user.id };
  if (skill) query.skills = { $regex: skill, $options: 'i' };
  if (minExperience) query.totalExperienceYears = { $gte: Number(minExperience) };
  if (search) {
    query.$or = [
      { name: { $regex: search, $options: 'i' } },
      { email: { $regex: search, $options: 'i' } },
      { skills: { $regex: search, $options: 'i' } },
    ];
  }

  const [docs, total] = await Promise.all([
    Candidate.find(query).sort(sort).skip((page - 1) * limit).limit(limit).lean(),
    Candidate.countDocuments(query),
  ]);

  return NextResponse.json({
    candidates: docs.map(serializeDoc), total, page, limit, totalPages: Math.ceil(total / limit),
  });
}
