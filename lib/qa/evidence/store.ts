import { createHash } from 'crypto';

/**
 * Evidence storage — screenshots, recordings and other run artefacts.
 *
 * Artefacts used to be embedded in MongoDB documents as base64 `data:` URLs.
 * Measured on real runs that cost **662 KB per screenshot on average, 2.0 MB at
 * the peak, and 17.7 MB for a single run**, and the run report re-fetched up to
 * 60 of them every 1.5s while a run was live — tens of megabytes per poll cycle.
 * That is also why screen recording and visual diffing were impossible: neither
 * is affordable when every frame travels inside a document.
 *
 * Bytes now live in a store behind this interface and the database keeps only
 * metadata plus a key. Nothing here interprets or generates image content — it
 * moves exactly the bytes the device produced.
 */

export type EvidenceKind = 'screenshot' | 'recording';

export interface StoredEvidence {
  key: string;
  bytes: number;
  /** Content hash, so identical frames can be recognised and diffed. */
  sha256: string;
  contentType: string;
}

export interface EvidenceReadResult {
  body: Buffer;
  bytes: number;
  contentType: string;
}

export interface EvidenceStore {
  readonly driver: 'local' | 's3';
  /** Persists bytes under `key`, overwriting any previous value. */
  put(key: string, data: Buffer, contentType: string): Promise<StoredEvidence>;
  /** Reads bytes back, or null when the key does not exist. */
  get(key: string): Promise<EvidenceReadResult | null>;
  /** Removes everything under a key prefix. Returns how many objects went. */
  deletePrefix(prefix: string): Promise<number>;
  /** True when the backing store is actually reachable/writable right now. */
  healthCheck(): Promise<{ ok: boolean; detail: string }>;
}

/** Key layout: one namespace per run so deletion is a single prefix sweep. */
export function evidenceKey(runId: string, kind: EvidenceKind, filename: string): string {
  return `runs/${runId}/${kind}s/${filename}`;
}

export function runPrefix(runId: string): string {
  return `runs/${runId}/`;
}

export function sha256Of(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

/**
 * Decodes a `data:` URL into raw bytes. Used by the backfill migration and by
 * the streaming endpoint when it serves a legacy document that still carries an
 * inline payload.
 */
export function decodeDataUrl(dataUrl: string): { data: Buffer; contentType: string } | null {
  const m = /^data:([^;,]+);base64,(.*)$/s.exec(dataUrl);
  if (!m) return null;
  try {
    return { contentType: m[1], data: Buffer.from(m[2], 'base64') };
  } catch {
    return null;
  }
}

/**
 * Reads a PNG's intrinsic dimensions straight from its IHDR chunk — no image
 * library needed, and no guessing. Returns null for anything that is not a PNG
 * with a readable header.
 */
export function pngSize(data: Buffer): { width: number; height: number } | null {
  // 8-byte signature, then a 4-byte length + "IHDR", then width/height as BE u32.
  if (data.length < 24) return null;
  const isPng = data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47;
  if (!isPng) return null;
  if (data.toString('ascii', 12, 16) !== 'IHDR') return null;
  return { width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
}

let cached: EvidenceStore | null = null;

/**
 * Resolves the configured store.
 *
 * `QA_EVIDENCE_DRIVER=s3` selects object storage; anything else (the default)
 * uses the local disk, which works with no configuration at all so a developer
 * checkout behaves correctly out of the box.
 */
export async function getEvidenceStore(): Promise<EvidenceStore> {
  if (cached) return cached;
  const driver = (process.env.QA_EVIDENCE_DRIVER ?? 'local').toLowerCase();

  if (driver === 's3') {
    const { S3EvidenceStore } = await import('./s3-store');
    cached = new S3EvidenceStore();
  } else {
    const { LocalDiskEvidenceStore } = await import('./local-disk-store');
    cached = new LocalDiskEvidenceStore();
  }
  return cached;
}

/** Test seam: lets a suite substitute a fake store. */
export function __setEvidenceStore(store: EvidenceStore | null): void {
  cached = store;
}
