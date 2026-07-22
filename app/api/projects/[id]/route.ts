import { NextResponse } from 'next/server';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { getCurrentUser } from '@/lib/auth/session';
import { connectToDatabase } from '@/lib/mongodb/connect';
import { Project } from '@/lib/mongodb/models/Project';
import { AgentRun } from '@/lib/mongodb/models/AgentRun';
import { serializeDoc } from '@/lib/mongodb/serialize';
import { buildsRoot } from '@/lib/build/toolchain';

export const runtime = 'nodejs';

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  await connectToDatabase();
  const doc = await Project.findOne({ _id: params.id, userId: user.id }).lean();
  if (!doc) return NextResponse.json({ project: null }, { status: 404 });

  return NextResponse.json({ project: serializeDoc(doc) });
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  await connectToDatabase();
  const project = await Project.findOne({ _id: params.id, userId: user.id });
  if (!project) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  await AgentRun.deleteMany({ projectId: params.id });
  await Project.deleteOne({ _id: params.id });

  // Best-effort cleanup of on-disk build artifacts.
  try {
    await fs.rm(path.join(buildsRoot(), params.id), { recursive: true, force: true });
  } catch {
    /* ignore */
  }

  return NextResponse.json({ ok: true });
}
