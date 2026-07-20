import { NextResponse } from 'next/server';
import { createReadStream, existsSync, statSync } from 'fs';
import path from 'path';
import { Readable } from 'stream';
import { WORKSPACE_ROOT } from '@/lib/ai/builder';

export const dynamic = 'force-dynamic';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.wasm': 'application/wasm',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.otf': 'font/otf',
  '.ttf': 'font/ttf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.map': 'application/json',
  '.bin': 'application/octet-stream',
};

// Public route: the web build is static, sandboxed in an iframe. No auth so the
// iframe can load sub-assets without forwarding the session cookie cross-context.
export async function GET(
  _req: Request,
  { params }: { params: { projectId: string; path: string[] } },
) {
  // Prevent path traversal — projectId and each segment must be simple.
  if (!/^[a-f0-9]{24}$/i.test(params.projectId)) {
    return new NextResponse('Not found', { status: 404 });
  }
  const rel = (params.path ?? []).join('/');
  if (rel.includes('..')) return new NextResponse('Forbidden', { status: 403 });

  const webRoot = path.join(WORKSPACE_ROOT, params.projectId, 'build', 'web');
  const target = path.join(webRoot, rel || 'index.html');
  if (!target.startsWith(webRoot) || !existsSync(target) || !statSync(target).isFile()) {
    return new NextResponse('Not found', { status: 404 });
  }

  const ext = path.extname(target).toLowerCase();
  const stream = Readable.toWeb(createReadStream(target)) as unknown as ReadableStream;
  return new NextResponse(stream, {
    headers: {
      'Content-Type': TYPES[ext] ?? 'application/octet-stream',
      'Cache-Control': 'no-store',
    },
  });
}
