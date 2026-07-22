import { NextResponse } from 'next/server';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { getCurrentUser } from '@/lib/auth/session';
import { connectToDatabase } from '@/lib/mongodb/connect';
import { Project } from '@/lib/mongodb/models/Project';
import { webDirFor } from '@/lib/build/toolchain';

export const runtime = 'nodejs';

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.wasm': 'application/wasm',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
  '.bin': 'application/octet-stream',
  '.symbols': 'application/octet-stream',
};

/**
 * Serves the compiled Flutter web build for a project so it can run live inside
 * the dashboard phone-frame iframe (the "virtual emulator"). Requests for the
 * app's own routes fall back to index.html.
 */
export async function GET(req: Request, { params }: { params: { projectId: string; path?: string[] } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  await connectToDatabase();
  const project = await Project.findOne({ _id: params.projectId, userId: user.id }).lean();
  if (!project) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const webDir = webDirFor(params.projectId);
  const rel = (params.path ?? []).join('/') || 'index.html';

  // Resolve safely inside the web build directory (block path traversal).
  const target = path.normalize(path.join(webDir, rel));
  if (!target.startsWith(path.normalize(webDir))) {
    return NextResponse.json({ error: 'Invalid path' }, { status: 400 });
  }

  async function readOrIndex(file: string): Promise<{ data: Buffer; file: string } | null> {
    try {
      const data = await fs.readFile(file);
      return { data, file };
    } catch {
      return null;
    }
  }

  // Try the requested file; fall back to index.html for client-side routes,
  // but never for real asset requests (those keep their 404).
  let result = await readOrIndex(target);
  const ext = path.extname(target).toLowerCase();
  if (!result && (ext === '' || ext === '.html')) {
    result = await readOrIndex(path.join(webDir, 'index.html'));
  }
  if (!result) {
    return NextResponse.json({ error: 'Preview not built yet' }, { status: 404 });
  }

  const contentType = CONTENT_TYPES[path.extname(result.file).toLowerCase()] ?? 'application/octet-stream';
  return new NextResponse(result.data, {
    headers: {
      'Content-Type': contentType,
      'Cache-Control': 'no-store',
    },
  });
}
