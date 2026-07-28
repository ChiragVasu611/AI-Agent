import { dumpHierarchy, focusedComponent } from './device';
import { parseHierarchy, visibleText } from './ui-parser';

/**
 * Adaptive waiting. The engine never sleeps for a fixed duration to "let the
 * UI settle" — it polls the real hierarchy until the screen stops changing,
 * the focused activity stabilizes, and any loading indicator disappears.
 * Every wait is bounded so a permanently-animating screen cannot hang a run.
 */

/**
 * Poll pacing.
 *
 * A single `uiautomator dump` costs ~2s on a real device, so the number of polls
 * — not the delay between them — is what determines how long a settle takes.
 * One confirming poll (i.e. two dumps: observe, then confirm unchanged) is
 * enough to establish the screen has stopped changing, and halves the cost of
 * every settle versus requiring two consecutive confirmations. The inter-poll
 * delay is small because the dump itself already paces the loop.
 */
const POLL_MS = 120;
const DEFAULT_STABLE_POLLS = 1;
const DEFAULT_TIMEOUT_MS = 6_000;

/** Tiny yield used only between polls — never as a substitute for a real signal. */
function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Structural fingerprint used to decide "did anything change?". Bounds are
 * quantized so sub-pixel animation jitter doesn't read as a change, while a
 * genuine layout/content change always does.
 */
function snapshotSignature(xml: string): string {
  const { nodes } = parseHierarchy(xml);
  const parts = nodes.map((n) => {
    const b = n.bounds;
    const qx = Math.round(b.left / 8);
    const qy = Math.round(b.top / 8);
    return `${n.className}|${n.resourceId}|${n.text}|${n.contentDesc}|${qx},${qy}`;
  });
  return `${parts.length}#${hash(parts.join('\n'))}`;
}

function hash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

const LOADING_HINTS = /progress|loading|spinner|shimmer|skeleton|please wait|buffering/i;

function looksBusy(xml: string): boolean {
  const { nodes } = parseHierarchy(xml);
  const byClass = nodes.some((n) => /ProgressBar|CircularProgress|LoadingView|Shimmer/i.test(n.className));
  if (byClass) return true;
  const byId = nodes.some((n) => LOADING_HINTS.test(n.resourceId));
  if (byId) return true;
  return LOADING_HINTS.test(visibleText(nodes).slice(0, 400));
}

export interface StableResult {
  xml: string;
  activity: string;
  /** True when the screen genuinely settled; false when we hit the timeout. */
  settled: boolean;
  waitedMs: number;
}

/**
 * Waits until the UI hierarchy is unchanged for `stablePolls` consecutive polls
 * AND the focused activity has stopped changing AND no loading indicator is
 * present. Returns the last hierarchy so callers don't need to re-dump.
 */
export async function waitForStableUi(
  serial: string,
  opts: { timeoutMs?: number; stablePolls?: number; ignoreBusy?: boolean } = {},
): Promise<StableResult> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const need = opts.stablePolls ?? DEFAULT_STABLE_POLLS;
  const started = Date.now();

  let lastSig = '';
  let lastActivity = '';
  let stable = 0;
  let xml = '';
  let activity = '';

  while (Date.now() - started < timeoutMs) {
    xml = await dumpHierarchy(serial);

    if (!xml) {
      // Hierarchy unavailable (mid-transition or secure window) — keep polling.
      stable = 0;
      await delay(POLL_MS);
      continue;
    }

    const sig = snapshotSignature(xml);
    const busy = opts.ignoreBusy ? false : looksBusy(xml);

    // The focused activity is only read when the hierarchy itself looks settled.
    // Reading it on every poll added a `dumpsys window` round-trip per poll for
    // information that only matters at the moment we decide we're stable.
    if (sig === lastSig && !busy) {
      activity = await focusedComponent(serial);
      // First read has nothing to compare against, so it cannot itself signal
      // instability — otherwise every settle would cost an extra full dump.
      const activityStable = lastActivity === '' || activity === lastActivity;
      lastActivity = activity;
      if (activityStable) {
        stable += 1;
        if (stable >= need) {
          return { xml, activity, settled: true, waitedMs: Date.now() - started };
        }
      } else {
        stable = 0;
      }
    } else {
      stable = 0;
    }

    lastSig = sig;
    await delay(POLL_MS);
  }

  return { xml, activity, settled: false, waitedMs: Date.now() - started };
}

/**
 * Waits for the screen to change away from a known signature — used after an
 * interaction to detect whether it actually navigated anywhere.
 */
export async function waitForChangeFrom(
  serial: string,
  previousSignature: string,
  timeoutMs = 4_000,
): Promise<boolean> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const xml = await dumpHierarchy(serial);
    if (xml && snapshotSignature(xml) !== previousSignature) return true;
    await delay(POLL_MS);
  }
  return false;
}

/**
 * Polls a predicate against the live hierarchy until it holds. Used by the ad
 * handler to wait for a dismiss control to become available, replacing any
 * fixed countdown sleep.
 */
export async function waitUntil(
  serial: string,
  predicate: (xml: string) => boolean,
  timeoutMs: number,
): Promise<boolean> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const xml = await dumpHierarchy(serial);
    if (xml && predicate(xml)) return true;
    await delay(POLL_MS);
  }
  return false;
}

export { snapshotSignature, delay };
