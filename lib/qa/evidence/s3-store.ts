import {
  sha256Of, type EvidenceReadResult, type EvidenceStore, type StoredEvidence,
} from './store';

/**
 * S3-compatible object storage for run evidence (AWS S3, MinIO, R2, Spaces…).
 *
 * The AWS SDK is an OPTIONAL dependency: it is imported dynamically, and if it
 * is not installed every operation fails with an explicit message naming the
 * missing package. That is deliberate — a store that silently swallowed writes
 * would lose evidence and leave the report showing frames that no longer exist,
 * which is precisely the class of dishonesty this platform must not have.
 *
 * Configuration:
 *   QA_EVIDENCE_DRIVER=s3
 *   QA_EVIDENCE_S3_BUCKET=<bucket>            (required)
 *   QA_EVIDENCE_S3_REGION=<region>            (default us-east-1)
 *   QA_EVIDENCE_S3_PREFIX=<prefix>            (optional key prefix)
 *   QA_EVIDENCE_S3_ENDPOINT=<url>             (for MinIO/R2; forces path style)
 *   plus the standard AWS credential environment variables.
 */
export class S3EvidenceStore implements EvidenceStore {
  readonly driver = 's3' as const;
  private readonly bucket: string;
  private readonly region: string;
  private readonly prefix: string;
  private readonly endpoint: string | undefined;
  private client: unknown | null = null;

  constructor() {
    this.bucket = process.env.QA_EVIDENCE_S3_BUCKET ?? '';
    this.region = process.env.QA_EVIDENCE_S3_REGION ?? 'us-east-1';
    this.prefix = (process.env.QA_EVIDENCE_S3_PREFIX ?? '').replace(/^\/+|\/+$/g, '');
    this.endpoint = process.env.QA_EVIDENCE_S3_ENDPOINT || undefined;
  }

  private full(key: string): string {
    return this.prefix ? `${this.prefix}/${key}` : key;
  }

  /** Loads the SDK on first use, failing loudly and specifically if absent. */
  private async sdk(): Promise<any> {
    if (!this.bucket) {
      throw new Error('QA_EVIDENCE_S3_BUCKET is not set, so evidence cannot be stored in S3.');
    }
    if (this.client) return this.client;
    let mod: any;
    try {
      // The specifier is held in a variable on purpose: the AWS SDK is an
      // OPTIONAL dependency, so neither the type checker nor the bundler should
      // try to resolve it at build time. It is required only when a deployment
      // actually opts into S3 storage.
      const spec = '@aws-sdk/client-s3';
      mod = await import(/* webpackIgnore: true */ spec);
    } catch {
      throw new Error(
        'QA_EVIDENCE_DRIVER=s3 is configured but the @aws-sdk/client-s3 package is not installed. '
        + 'Install it (npm i @aws-sdk/client-s3) or set QA_EVIDENCE_DRIVER=local.',
      );
    }
    this.client = {
      mod,
      s3: new mod.S3Client({
        region: this.region,
        ...(this.endpoint ? { endpoint: this.endpoint, forcePathStyle: true } : {}),
      }),
    };
    return this.client;
  }

  async put(key: string, data: Buffer, contentType: string): Promise<StoredEvidence> {
    const { mod, s3 } = await this.sdk();
    await s3.send(new mod.PutObjectCommand({
      Bucket: this.bucket,
      Key: this.full(key),
      Body: data,
      ContentType: contentType,
      // Frames are immutable once written — their key includes a unique id.
      CacheControl: 'public, max-age=31536000, immutable',
    }));
    return { key, bytes: data.length, sha256: sha256Of(data), contentType };
  }

  async get(key: string): Promise<EvidenceReadResult | null> {
    const { mod, s3 } = await this.sdk();
    try {
      const res = await s3.send(new mod.GetObjectCommand({ Bucket: this.bucket, Key: this.full(key) }));
      const chunks: Buffer[] = [];
      for await (const chunk of res.Body as AsyncIterable<Uint8Array>) chunks.push(Buffer.from(chunk));
      const body = Buffer.concat(chunks);
      return { body, bytes: body.length, contentType: res.ContentType ?? 'application/octet-stream' };
    } catch {
      return null;
    }
  }

  async deletePrefix(prefix: string): Promise<number> {
    const { mod, s3 } = await this.sdk();
    let removed = 0;
    let token: string | undefined;
    do {
      const list = await s3.send(new mod.ListObjectsV2Command({
        Bucket: this.bucket, Prefix: this.full(prefix), ContinuationToken: token,
      }));
      const objects = (list.Contents ?? []).map((o: { Key: string }) => ({ Key: o.Key }));
      if (objects.length > 0) {
        await s3.send(new mod.DeleteObjectsCommand({
          Bucket: this.bucket, Delete: { Objects: objects, Quiet: true },
        }));
        removed += objects.length;
      }
      token = list.IsTruncated ? list.NextContinuationToken : undefined;
    } while (token);
    return removed;
  }

  async healthCheck(): Promise<{ ok: boolean; detail: string }> {
    try {
      const { mod, s3 } = await this.sdk();
      await s3.send(new mod.HeadBucketCommand({ Bucket: this.bucket }));
      return { ok: true, detail: `S3 bucket ${this.bucket} in ${this.region}` };
    } catch (e) {
      return { ok: false, detail: (e as Error).message };
    }
  }
}
