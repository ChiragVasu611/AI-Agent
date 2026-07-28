import { QaScreenshot } from '@/lib/mongodb/models/QaScreenshot';
import { screencapDataUrl } from './device';

/**
 * Screenshot capture and persistence.
 *
 * Every image stored by this engine is a real PNG pulled off the device with
 * `screencap`. There is no placeholder path — if the device cannot produce a
 * frame (secure window, transient black screen) the capture is skipped and
 * recorded as such rather than substituted with generated art.
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
  /** Guards against unbounded growth on very long runs (data URLs live in Mongo). */
  constructor(private serial: string, private maxCaptures = 120) {}

  /** Captures without persisting — used when a caller needs the frame inline. */
  async grab(): Promise<string | null> {
    return screencapDataUrl(this.serial);
  }

  /**
   * Captures and persists a frame. Returns the data URL so callers can attach
   * the same image to a bug report without capturing twice.
   */
  async capture(opts: CaptureOptions): Promise<string | null> {
    if (this.captured >= this.maxCaptures) return null;

    const dataUrl = await screencapDataUrl(this.serial);
    if (!dataUrl) {
      this.skipped += 1;
      return null;
    }

    await QaScreenshot.create({
      runId: opts.runId,
      screenName: opts.screenName || 'Screen',
      testStep: opts.step ? `${opts.reason}: ${opts.step}` : opts.reason,
      imageDataUrl: dataUrl,
    });
    this.captured += 1;
    return dataUrl;
  }

  get stats(): { captured: number; skipped: number } {
    return { captured: this.captured, skipped: this.skipped };
  }

  get atLimit(): boolean {
    return this.captured >= this.maxCaptures;
  }
}
