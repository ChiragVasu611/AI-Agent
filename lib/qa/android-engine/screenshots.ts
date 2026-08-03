import { randomUUID } from 'crypto';
import { QaScreenshot } from '@/lib/mongodb/models/QaScreenshot';
import { screencapDataUrl } from './device';
import {
  decodeDataUrl, evidenceKey, getEvidenceStore, pngSize,
} from '@/lib/qa/evidence/store';

/**
 * Screenshot capture and persistence.
 *
 * Every image stored by this engine is a real PNG pulled off the device with
 * `screencap`. There is no placeholder path — if the device cannot produce a
 * frame (secure window, transient black screen) the capture is skipped and
 * recorded as such rather than substituted with generated art.
 *
 * The bytes go to the evidence store and the database keeps metadata plus a key.
 * Embedding them as base64 made frames average 662 KB inside documents, which
 * the run report then re-fetched wholesale on every 1.5s poll.
 */

export type CaptureReason =
  | 'launch' | 'before_interaction' | 'after_interaction' | 'navigation'
  | 'crash' | 'anr' | 'failure' | 'state_change' | 'ad' | 'paywall'
  | 'permission' | 'rotation' | 'final';

export interface CaptureOptions {
  runId: string;
  screenName: string;
  reason: CaptureReason;
  /** Extra context stored alongside the frame, e.g. the action that caused it. */
  step?: string;
}

export class ScreenshotManager {
  private captured = 0;
  private skipped = 0;
  private storeFailures = 0;
  private bytesStored = 0;
  /** Guards against unbounded growth on very long runs. */
  constructor(private serial: string, private maxCaptures = 120) {}

  /** Captures without persisting — used when a caller needs the frame inline. */
  async grab(): Promise<string | null> {
    return screencapDataUrl(this.serial);
  }

  /**
   * Captures and persists a frame. Returns the data URL so callers can attach
   * the same image to a bug report without capturing twice.
   *
   * The returned value is still a data URL because bug documents embed their own
   * evidence image; only the screenshot gallery moved to the store.
   */
  async capture(opts: CaptureOptions): Promise<string | null> {
    if (this.captured >= this.maxCaptures) return null;

    const dataUrl = await screencapDataUrl(this.serial);
    if (!dataUrl) {
      this.skipped += 1;
      return null;
    }

    const decoded = decodeDataUrl(dataUrl);
    const testStep = opts.step ? `${opts.reason}: ${opts.step}` : opts.reason;
    const screenName = opts.screenName || 'Screen';

    if (decoded) {
      try {
        const store = await getEvidenceStore();
        const key = evidenceKey(opts.runId, 'screenshot', `${Date.now()}-${randomUUID()}.png`);
        const stored = await store.put(key, decoded.data, decoded.contentType || 'image/png');
        const size = pngSize(decoded.data);
        await QaScreenshot.create({
          runId: opts.runId,
          screenName,
          testStep,
          storageKey: stored.key,
          contentType: stored.contentType,
          bytes: stored.bytes,
          sha256: stored.sha256,
          width: size?.width ?? null,
          height: size?.height ?? null,
          // Deliberately omitted: the bytes are in the store.
          imageDataUrl: null,
        });
        this.captured += 1;
        this.bytesStored += stored.bytes;
        return dataUrl;
      } catch (e) {
        // The frame is real and must not be lost because storage misbehaved.
        // Fall back to the inline payload and count the failure so the run can
        // report it rather than silently changing where evidence lives.
        this.storeFailures += 1;
        // eslint-disable-next-line no-console
        console.error('QA evidence store write failed; falling back to inline payload', (e as Error)?.message);
      }
    }

    await QaScreenshot.create({
      runId: opts.runId, screenName, testStep, imageDataUrl: dataUrl,
    });
    this.captured += 1;
    return dataUrl;
  }

  get stats(): { captured: number; skipped: number; storeFailures: number; bytesStored: number } {
    return {
      captured: this.captured,
      skipped: this.skipped,
      storeFailures: this.storeFailures,
      bytesStored: this.bytesStored,
    };
  }

  get atLimit(): boolean {
    return this.captured >= this.maxCaptures;
  }
}
