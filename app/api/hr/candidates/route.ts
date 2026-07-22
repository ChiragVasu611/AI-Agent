import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth/session';
import { connectToDatabase } from '@/lib/mongodb/connect';
import { Candidate } from '@/lib/mongodb/models/Candidate';
import { Application } from '@/lib/mongodb/models/Application';
import { Job } from '@/lib/mongodb/models/Job';
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

  const candidateIds = docs.map((d: any) => d._id);
  const applications = await Application.find({ candidateId: { $in: candidateIds } }).sort({ createdAt: -1 }).lean();
  const jobIds = Array.from(new Set(applications.map((a: any) => String(a.jobId))));
  const jobs = await Job.find({ _id: { $in: jobIds } }).lean();
  const jobById = new Map(jobs.map((j: any) => [String(j._id), j]));

  const latestApplicationByCandidate = new Map<string, any>();
  for (const app of applications) {
    const key = String((app as any).candidateId);
    if (!latestApplicationByCandidate.has(key)) latestApplicationByCandidate.set(key, app);
  }

  const candidates = docs.map((d: any) => {
    const app = latestApplicationByCandidate.get(String(d._id));
    const job = app ? jobById.get(String(app.jobId)) : null;
    return {
      ...serializeDoc(d),
      latestApplication: app ? {
        jobTitle: job?.title ?? null,
        matchScore: app.matchScore,
        stage: app.stage,
        source: app.source,
        appliedAt: app.createdAt?.toISOString?.() ?? app.createdAt,
      } : null,
    };
  });

  return NextResponse.json({
    candidates, total, page, limit, totalPages: Math.ceil(total / limit),
  });
}
