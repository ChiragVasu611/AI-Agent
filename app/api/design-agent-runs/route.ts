import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth/session';
import { connectToDatabase } from '@/lib/mongodb/connect';
import { DesignProject } from '@/lib/mongodb/models/DesignProject';
import { DesignAgentRun } from '@/lib/mongodb/models/DesignAgentRun';
import { serializeDoc } from '@/lib/mongodb/serialize';

export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  const projectId = new URL(req.url).searchParams.get('projectId');
  if (!projectId) return NextResponse.json({ error: 'projectId is required' }, { status: 400 });

  await connectToDatabase();

  const project = await DesignProject.findOne({ _id: projectId, userId: user.id }).lean();
  if (!project) return NextResponse.json({ runs: [] }, { status: 404 });

  const docs = await DesignAgentRun.find({ projectId }).sort({ createdAt: 1 }).lean();
  return NextResponse.json({ runs: docs.map(serializeDoc) });
}
