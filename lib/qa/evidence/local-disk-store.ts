import { mkdir, readFile, writeFile, rm, stat } from 'fs/promises';
import { dirname, join, resolve, sep } from 'path';
import {
  sha256Of, type EvidenceReadResult, type EvidenceStore, type StoredEvidence,
} from './store';

/**
 * Local-disk evidence store — the zero-configuration default.
 *
 * Artefacts land under `QA_EVIDENCE_DIR` (default `<cwd>/.qa-evidence`). This is
 * the right default for a single-host deployment and for development; a
 * multi-worker deployment should point `QA_EVIDENCE_DRIVER=s3` at shared object
 * storage instead, because workers cannot read each other's local disks.
 */
export class LocalDiskEvidenceStore implements EvidenceStore {
  readonly driver = 'local' as const;
  private readonly root: string;

  constructor(root?: string) {
    this.root = resolve(root ?? process.env.QA_EVIDENCE_DIR ?? join(process.cwd(), '.qa-evidence'));
  }

  /**
   * Maps a logical key to an absolute path, refusing anything that would escape
   * the root. Keys are generated server-side, but the streaming endpoint reads a
   * key out of the database, so treating it as untrusted input costs nothing.
   */
  private pathFor(key: string): string {
    const full = resolve(this.root, key);
    if (full !== this.root && !full.startsWith(this.root + sep)) {
      throw new Error(`Evidence key escapes the storage root: ${key}`);
    }
    return full;
  }

  async put(key: string, data: Buffer, contentType: string): Promise<StoredEvidence> {
    const path = this.pathFor(key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, data);
    return { key, bytes: data.length, sha256: sha256Of(data), contentType };
  }

  async get(key: string): Promise<EvidenceReadResult | null> {
    try {
      const path = this.pathFor(key);
      const body = await readFile(path);
      return { body, bytes: body.length, contentType: contentTypeFor(key) };
    } catch {
      return null;
    }
  }

  async deletePrefix(prefix: string): Promise<number> {
    try {
      const path = this.pathFor(prefix);
      // Count what is about to go so callers can report it honestly.
      const count = await countFiles(path);
      await rm(path, { recursive: true, force: true });
      return count;
    } catch {
      return 0;
    }
  }

  async healthCheck(): Promise<{ ok: boolean; detail: string }> {
    try {
      await mkdir(this.root, { recursive: true });
      const probe = join(this.root, '.write-probe');
      await writeFile(probe, 'ok');
      await rm(probe, { force: true });
      return { ok: true, detail: `Local disk at ${this.root}` };
    } catch (e) {
      return { ok: false, detail: `Local disk at ${this.root} is not writable: ${(e as Error).message}` };
    }
  }
}

async function countFiles(path: string): Promise<number> {
  try {
    const s = await stat(path);
    if (s.isFile()) return 1;
  } catch {
    return 0;
  }
  const { readdir } = await import('fs/promises');
  let n = 0;
  const walk = async (dir: string): Promise<void> => {
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const e of entries) {
      if (e.isDirectory()) await walk(join(dir, e.name));
      else n += 1;
    }
  };
  await walk(path);
  return n;
}

function contentTypeFor(key: string): string {
  if (/\.png$/i.test(key)) return 'image/png';
  if (/\.jpe?g$/i.test(key)) return 'image/jpeg';
  if (/\.webp$/i.test(key)) return 'image/webp';
  if (/\.mp4$/i.test(key)) return 'video/mp4';
  if (/\.webm$/i.test(key)) return 'video/webm';
  return 'application/octet-stream';
}
