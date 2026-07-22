import { NextResponse } from 'next/server';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { getCurrentUser } from '@/lib/auth/session';
import { connectToDatabase } from '@/lib/mongodb/connect';
import { Project } from '@/lib/mongodb/models/Project';
import { buildsRoot } from '@/lib/build/toolchain';

export const runtime = 'nodejs';

export async function GET(req: Request, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  await connectToDatabase();
  const project = await Project.findOne({ _id: params.id, userId: user.id }).lean();
  if (!project) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const type = new URL(req.url).searchParams.get('type') ?? 'apk';
  const root = buildsRoot();

  // Docs are generated on the fly from the project record.
  if (type === 'docs') {
    const p = project as Record<string, unknown>;
    const md = `# ${p.name} — Build Report\n\n` +
      `- Reference: ${p.referenceUrl}\n` +
      `- Platform: ${p.platform}\n` +
      `- Version: ${p.version}\n` +
      `- QA score: ${p.qaScore ?? 'n/a'}\n` +
      `- Test cases: ${p.testCasesPassed ?? 0}/${p.testCasesTotal ?? 0} passed\n` +
      `- Build time: ${p.buildTimeMs ? Math.round(Number(p.buildTimeMs) / 1000) + 's' : 'n/a'}\n` +
      `- Files generated: ${p.fileCount ?? 'n/a'}\n` +
      `- Emulator: ${p.emulatorStatus ?? 'n/a'}\n\n` +
      `${p.releaseNotes ?? ''}\n`;
    return new NextResponse(md, {
      headers: {
        'Content-Type': 'text/markdown; charset=utf-8',
        'Content-Disposition': `attachment; filename="build-report-${params.id}.md"`,
      },
    });
  }

  const fileMap: Record<string, { file: string; contentType: string; name: string }> = {
    apk: {
      file: path.join(root, params.id, 'app/build/app/outputs/flutter-apk/app-debug.apk'),
      contentType: 'application/vnd.android.package-archive',
      name: 'app-debug.apk',
    },
    source: {
      file: path.join(root, params.id, 'source.zip'),
      contentType: 'application/zip',
      name: 'source.zip',
    },
  };

  const target = fileMap[type];
  if (!target) return NextResponse.json({ error: 'Unknown artifact type' }, { status: 400 });

  try {
    const data = await fs.readFile(target.file);
    return new NextResponse(data, {
      headers: {
        'Content-Type': target.contentType,
        'Content-Disposition': `attachment; filename="${target.name}"`,
        'Content-Length': String(data.length),
      },
    });
  } catch {
    return NextResponse.json({ error: 'Artifact not available' }, { status: 404 });
  }
}
