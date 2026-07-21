import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth/session';
import { connectToDatabase } from '@/lib/mongodb/connect';
import { Job } from '@/lib/mongodb/models/Job';
import { Application } from '@/lib/mongodb/models/Application';
import { serializeDoc } from '@/lib/mongodb/serialize';

export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const url = new URL(req.url);
  const page = Math.max(1, Number(url.searchParams.get('page') ?? '1'));
  const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit') ?? '20')));
  const search = url.searchParams.get('search');
  const department = url.searchParams.get('department');
  const status = url.searchParams.get('status');
  const priority = url.searchParams.get('priority');
  const sort = url.searchParams.get('sort') ?? '-createdAt';

  await connectToDatabase();

  const query: Record<string, unknown> = { userId: user.id };
  if (department) query.department = department;
  if (status) query.status = status;
  if (priority) query.priority = priority;
  if (search) {
    query.$or = [
      { title: { $regex: search, $options: 'i' } },
      { department: { $regex: search, $options: 'i' } },
      { requiredSkills: { $regex: search, $options: 'i' } },
    ];
  }

  const [docs, total] = await Promise.all([
    Job.find(query).sort(sort).skip((page - 1) * limit).limit(limit).lean(),
    Job.countDocuments(query),
  ]);

  const jobIds = docs.map((d: any) => d._id);
  const applicantCounts = await Application.aggregate([
    { $match: { jobId: { $in: jobIds } } },
    { $group: { _id: '$jobId', count: { $sum: 1 } } },
  ]);
  const countByJob = new Map(applicantCounts.map((c: any) => [String(c._id), c.count]));

  const jobs = docs.map((d: any) => ({ ...serializeDoc(d), applicantCount: countByJob.get(String(d._id)) ?? 0 }));

  return NextResponse.json({ jobs, total, page, limit, totalPages: Math.ceil(total / limit) });
}
