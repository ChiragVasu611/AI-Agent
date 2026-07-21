import { NextResponse } from 'next/server';
import { createReadStream, existsSync, statSync } from 'fs';
import path from 'path';
import { Readable } from 'stream';
import { getCurrentUser } from '@/lib/auth/session';
import { connectToDatabase } from '@/lib/mongodb/connect';
import { Project } from '@/lib/mongodb/models/Project';
import { WORKSPACE_ROOT } from '@/lib/ai/builder';

export const dynamic = 'force-dynamic';

const ARTIFACTS: Record<string, { rel: string; type: string; filename: string }> = {
  apk: {
    rel: 'build/app/outputs/flutter-apk/app-debug.apk',
    type: 'application/vnd.android.package-archive',
    filename: 'app-debug.apk',
  },
  source: { rel: 'source.zip', type: 'application/zip', filename: 'source.zip' },
};

export async function GET(
  _req: Request,
  { params }: { params: { projectId: string; kind: string } },
) {
  const user = await getCurrentUser();
  if (!user) return new NextResponse('Not authenticated', { status: 401 });

  const artifact = ARTIFACTS[params.kind];
  if (!artifact || !/^[a-f0-9]{24}$/i.test(params.projectId)) {
    return new NextResponse('Not found', { status: 404 });
  }

  await connectToDatabase();
  const owned = await Project.exists({ _id: params.projectId, userId: user.id });
  if (!owned) return new NextResponse('Not found', { status: 404 });

  const target = path.join(WORKSPACE_ROOT, params.projectId, artifact.rel);
  if (!existsSync(target) || !statSync(target).isFile()) {
    return new NextResponse('Artifact not available', { status: 404 });
  }

  const stream = Readable.toWeb(createReadStream(target)) as unknown as ReadableStream;
  return new NextResponse(stream, {
    headers: {
      'Content-Type': artifact.type,
      'Content-Disposition': `attachment; filename="${artifact.filename}"`,
      'Content-Length': String(statSync(target).size),
      'Cache-Control': 'no-store',
    },
  });
}
