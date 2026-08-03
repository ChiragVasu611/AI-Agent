/**
 * Migrates QA screenshots out of MongoDB and into the evidence store.
 *
 * Frames used to be embedded as base64 `data:` URLs, averaging 662 KB each. This
 * moves the bytes to the configured store, records `storageKey` + metadata on the
 * document, and clears the inline payload.
 *
 * Safety properties:
 *  • The inline payload is cleared ONLY after the bytes are written AND read back
 *    and verified by hash. A frame is never lost to a half-finished migration.
 *  • Re-running is safe: documents that already have a `storageKey` are skipped.
 *  • `--dry-run` reports exactly what would move and how much space it frees.
 *  • `--keep-inline` migrates without clearing the payload, for a staged rollout.
 *
 * Usage:
 *   node scripts/qa-migrate-evidence.mjs --dry-run
 *   node scripts/qa-migrate-evidence.mjs
 *   QA_EVIDENCE_DRIVER=s3 QA_EVIDENCE_S3_BUCKET=my-bucket node scripts/qa-migrate-evidence.mjs
 */
import { readFileSync, mkdirSync, writeFileSync, readFileSync as readBack } from 'fs';
import { dirname, join, resolve } from 'path';
import { createHash, randomUUID } from 'crypto';
import mongoose from 'mongoose';

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const KEEP_INLINE = args.includes('--keep-inline');

function loadEnv() {
  try {
    const raw = readFileSync(resolve(process.cwd(), '.env.local'), 'utf8');
    for (const line of raw.split('\n')) {
      const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
    }
  } catch { /* env file is optional */ }
}

function decodeDataUrl(dataUrl) {
  const m = /^data:([^;,]+);base64,(.*)$/s.exec(dataUrl);
  if (!m) return null;
  return { contentType: m[1], data: Buffer.from(m[2], 'base64') };
}

function pngSize(data) {
  if (data.length < 24) return null;
  const isPng = data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47;
  if (!isPng || data.toString('ascii', 12, 16) !== 'IHDR') return null;
  return { width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
}

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

/** Local-disk writer mirroring LocalDiskEvidenceStore's key layout exactly. */
function makeLocalStore() {
  const root = resolve(process.env.QA_EVIDENCE_DIR ?? join(process.cwd(), '.qa-evidence'));
  return {
    driver: 'local',
    root,
    put(key, data) {
      const path = join(root, key);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, data);
      return { key, bytes: data.length, sha256: sha256(data) };
    },
    verify(key, expectedHash) {
      try { return sha256(readBack(join(root, key))) === expectedHash; } catch { return false; }
    },
  };
}

async function makeS3Store() {
  const bucket = process.env.QA_EVIDENCE_S3_BUCKET;
  if (!bucket) throw new Error('QA_EVIDENCE_DRIVER=s3 requires QA_EVIDENCE_S3_BUCKET.');
  let mod;
  try {
    mod = await import('@aws-sdk/client-s3');
  } catch {
    throw new Error('QA_EVIDENCE_DRIVER=s3 requires @aws-sdk/client-s3 (npm i @aws-sdk/client-s3).');
  }
  const prefix = (process.env.QA_EVIDENCE_S3_PREFIX ?? '').replace(/^\/+|\/+$/g, '');
  const endpoint = process.env.QA_EVIDENCE_S3_ENDPOINT || undefined;
  const s3 = new mod.S3Client({
    region: process.env.QA_EVIDENCE_S3_REGION ?? 'us-east-1',
    ...(endpoint ? { endpoint, forcePathStyle: true } : {}),
  });
  const full = (k) => (prefix ? `${prefix}/${k}` : k);
  return {
    driver: 's3',
    root: `s3://${bucket}`,
    async put(key, data, contentType) {
      await s3.send(new mod.PutObjectCommand({
        Bucket: bucket, Key: full(key), Body: data, ContentType: contentType,
        CacheControl: 'public, max-age=31536000, immutable',
      }));
      return { key, bytes: data.length, sha256: sha256(data) };
    },
    async verify(key, expectedHash) {
      try {
        const res = await s3.send(new mod.GetObjectCommand({ Bucket: bucket, Key: full(key) }));
        const chunks = [];
        for await (const c of res.Body) chunks.push(Buffer.from(c));
        return sha256(Buffer.concat(chunks)) === expectedHash;
      } catch { return false; }
    },
  };
}

const fmtMb = (b) => `${(b / 1024 / 1024).toFixed(1)} MB`;

(async () => {
  loadEnv();
  const uri = process.env.MONGODB_URI;
  if (!uri) { console.error('MONGODB_URI is not set.'); process.exit(1); }

  const store = (process.env.QA_EVIDENCE_DRIVER ?? 'local').toLowerCase() === 's3'
    ? await makeS3Store()
    : makeLocalStore();

  await mongoose.connect(uri, { serverSelectionTimeoutMS: 20000 });
  const col = mongoose.connection.db.collection('qascreenshots');

  // Frames belonging to AI Test Case Execution runs are left ALONE.
  //
  // That engine writes inline payloads and its UI reads `imageDataUrl` directly,
  // so clearing the field would blank its screenshot gallery and live preview.
  // Those runs keep their inline frames until that module adopts the evidence
  // store; the streaming endpoint already serves either shape, so nothing else
  // has to care which form a given frame is in.
  const runs = mongoose.connection.db.collection('qatestruns');
  const uploadedRunIds = (await runs.find({ sourceMode: 'uploaded' }).project({ _id: 1 }).toArray())
    .map((r) => r._id);
  if (uploadedRunIds.length > 0) {
    console.log(`Skipping       : ${uploadedRunIds.length} AI Test Case Execution run(s) — that module reads inline payloads`);
  }

  const pending = await col.find({
    storageKey: { $in: [null, ''] },
    imageDataUrl: { $nin: [null, ''] },
    ...(uploadedRunIds.length > 0 ? { runId: { $nin: uploadedRunIds } } : {}),
  }).project({ _id: 1, runId: 1, imageDataUrl: 1 }).toArray();

  console.log(`Evidence store : ${store.driver} (${store.root})`);
  console.log(`Mode           : ${DRY_RUN ? 'DRY RUN — nothing written' : KEEP_INLINE ? 'migrate, keep inline payload' : 'migrate and clear inline payload'}`);
  console.log(`Frames to move : ${pending.length}`);
  if (pending.length === 0) { await mongoose.disconnect(); return; }

  let moved = 0; let failed = 0; let bytes = 0;

  for (const doc of pending) {
    const decoded = decodeDataUrl(doc.imageDataUrl);
    if (!decoded) {
      failed += 1;
      console.warn(`  ! ${doc._id}: inline payload is not a decodable data URL — left untouched`);
      continue;
    }
    bytes += decoded.data.length;
    if (DRY_RUN) { moved += 1; continue; }

    const ext = decoded.contentType === 'image/svg+xml' ? 'svg'
      : decoded.contentType === 'image/jpeg' ? 'jpg' : 'png';
    const key = `runs/${doc.runId}/screenshots/${Date.now()}-${randomUUID()}.${ext}`;

    try {
      const stored = await store.put(key, decoded.data, decoded.contentType);
      // Read back and compare hashes BEFORE touching the document. Clearing an
      // inline payload against an unverified write would destroy the only copy.
      const ok = await store.verify(key, stored.sha256);
      if (!ok) throw new Error('write could not be verified by hash on read-back');

      const size = pngSize(decoded.data);
      const update = {
        storageKey: stored.key,
        contentType: decoded.contentType,
        bytes: stored.bytes,
        sha256: stored.sha256,
        width: size?.width ?? null,
        height: size?.height ?? null,
      };
      if (!KEEP_INLINE) update.imageDataUrl = null;
      await col.updateOne({ _id: doc._id }, { $set: update });
      moved += 1;
      if (moved % 25 === 0) console.log(`  … ${moved}/${pending.length}`);
    } catch (e) {
      failed += 1;
      console.error(`  ! ${doc._id}: ${e.message} — document left unchanged`);
    }
  }

  console.log('');
  console.log(`Migrated : ${moved}`);
  console.log(`Failed   : ${failed}`);
  console.log(`Payload  : ${fmtMb(bytes)} ${DRY_RUN ? 'would move out of MongoDB' : KEEP_INLINE ? 'copied to the store (still inline too)' : 'removed from MongoDB documents'}`);
  if (failed > 0) console.log('Failed documents kept their inline payload and can be retried by re-running.');

  await mongoose.disconnect();
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
