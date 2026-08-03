import { Schema } from 'mongoose';
import { defineModel } from '@/lib/mongodb/define-model';

/**
 * A captured frame from a run.
 *
 * Bytes live in the evidence store (see `lib/qa/evidence/`), and this document
 * holds only metadata plus `storageKey`. Frames used to be embedded here as
 * base64 `data:` URLs, which measured 662 KB on average and made a single run
 * 17.7 MB — the run report then re-fetched up to 60 of them every 1.5s.
 *
 * `imageDataUrl` is retained as OPTIONAL for two reasons, both real:
 *  1. every frame captured before the migration still carries one, and history
 *     is never rewritten or discarded here;
 *  2. the AI Test Case Execution engine still writes inline payloads, and its
 *     UI reads them directly.
 * Readers must therefore accept either shape — prefer `storageKey`, fall back to
 * `imageDataUrl`.
 *
 * Registered through `defineModel` so schema edits take effect on hot reload;
 * with the plain `models.X ?? model(...)` guard, the previously-compiled schema
 * (which had `imageDataUrl` required) would keep rejecting storage-only frames
 * until the dev server was restarted.
 */
const qaScreenshotSchema = new Schema({
  runId: { type: Schema.Types.ObjectId, ref: 'QaTestRun', required: true, index: true },
  screenName: { type: String, required: true },
  testStep: { type: String, default: '' },

  /** Key into the evidence store. Present on everything captured post-migration. */
  storageKey: { type: String, default: null },
  contentType: { type: String, default: null },
  bytes: { type: Number, default: null },
  /** Content hash — enables duplicate-frame detection and visual diffing. */
  sha256: { type: String, default: null, index: true },
  width: { type: Number, default: null },
  height: { type: Number, default: null },

  /** Legacy/inline payload. See the note above before removing this. */
  imageDataUrl: { type: String, default: null },
}, { timestamps: { createdAt: true, updatedAt: false } });

// A frame is only meaningful if its bytes are reachable one way or the other.
qaScreenshotSchema.pre('validate', function preValidate(next) {
  const doc = this as unknown as { storageKey?: string | null; imageDataUrl?: string | null };
  if (!doc.storageKey && !doc.imageDataUrl) {
    next(new Error('QaScreenshot requires either storageKey or imageDataUrl.'));
    return;
  }
  next();
});

export const QaScreenshot = defineModel('QaScreenshot', qaScreenshotSchema);
