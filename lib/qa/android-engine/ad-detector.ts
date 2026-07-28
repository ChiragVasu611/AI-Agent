import type { UiNode } from './types';
import { centerOf, labelOf, visibleText, area, width as bw, height as bh } from './ui-parser';
import { dumpHierarchy, tap, pressKey, KEY } from './device';
import { parseHierarchy } from './ui-parser';
import { waitUntil, waitForStableUi } from './smart-wait';

/**
 * Advertisement detection and dismissal.
 *
 * Ads are identified by the SDK surfaces they render — package names, view
 * class names and resource-id namespaces published by the ad networks — plus
 * structural signals (a full-screen overlay owned by a different package than
 * the app under test). No creative text, button label or coordinate is ever
 * hardcoded: the dismiss control is located in the live hierarchy, and when a
 * countdown is present the engine polls until the control actually becomes
 * available instead of sleeping for a guessed duration.
 */

/** View/class/id namespaces published by the major ad SDKs. */
const AD_SDK_SIGNATURES = [
  /com\.google\.android\.gms\.ads/i,       // Google Mobile Ads / AdMob
  /com\.google\.ads/i,
  /admob/i,
  /doubleclick/i,
  /com\.facebook\.ads/i,                    // Meta Audience Network
  /audiencenetwork/i,
  /com\.applovin/i,                         // AppLovin / MAX
  /com\.unity3d\.(ads|services)/i,          // Unity Ads
  /com\.ironsource/i,                       // ironSource
  /com\.chartboost/i,
  /com\.mbridge|mintegral/i,
  /com\.vungle/i,
  /com\.adcolony/i,
  /com\.inmobi/i,
  /com\.startapp/i,
  /com\.smaato/i,
  /com\.pubmatic|openwrap/i,
  /com\.tapjoy/i,
  /com\.bytedance\.sdk|pangle/i,
  /com\.yandex\.mobile\.ads/i,
];

const AD_VIEW_CLASSES = /AdView|AdActivity|InterstitialActivity|MraidActivity|AudienceNetworkActivity|AdOverlay|NativeAdView|RewardedVideo|BannerView|AppOpenAd/i;

const AD_ID_HINTS = /(^|[_/.])(ad|ads|advert|advertisement|banner|interstitial|rewarded|sponsored)([_./]|$)/i;

/** Words the ad industry uses for the dismiss affordance, in the accessibility layer. */
const DISMISS_LABELS = /^(x|✕|✖|×|close|close ad|skip|skip ad|skip >|dismiss|no thanks|not now|continue to app|maybe later)$/i;
const DISMISS_LOOSE = /\b(close|skip|dismiss|no thanks|continue to app)\b/i;
const DISMISS_ID = /(close|skip|dismiss|cancel)(_?(btn|button|icon|ad|view))?$/i;

/** A countdown that gates the dismiss control, e.g. "5", "Skip in 5s", "00:05". */
const COUNTDOWN = /\b(\d{1,2})\s*(s|sec|seconds)?\b|\bskip in\b|\d{1,2}:\d{2}/i;

export interface AdVerdict {
  isAd: boolean;
  /** Which signal fired — recorded as evidence, never invented. */
  reason: string;
  network: string | null;
  fullScreen: boolean;
}

function sdkMatch(value: string): string | null {
  for (const re of AD_SDK_SIGNATURES) {
    const m = re.exec(value);
    if (m) return m[0];
  }
  return null;
}

/**
 * Detects an advertisement surface. `appPackage` is the app under test so an
 * overlay owned by a foreign package can be recognised structurally.
 */
export function detectAd(nodes: UiNode[], activity: string, appPackage: string, w: number, h: number): AdVerdict {
  const screenArea = Math.max(1, w * h);

  // 1. SDK signature anywhere in the hierarchy or the resolved activity.
  const haystacks: string[] = [activity];
  for (const n of nodes) {
    haystacks.push(n.packageName, n.className, n.resourceId);
  }
  for (const value of haystacks) {
    const net = sdkMatch(value || '');
    if (net) {
      const fullScreen = nodes.some((n) => area(n.bounds) > screenArea * 0.75 && sdkMatch(`${n.packageName}${n.className}${n.resourceId}`));
      return { isAd: true, reason: `Ad SDK surface detected: ${net}`, network: net, fullScreen };
    }
  }

  // 2. Ad view classes (some networks obfuscate package but keep view names).
  const adView = nodes.find((n) => AD_VIEW_CLASSES.test(n.className));
  if (adView) {
    return {
      isAd: true,
      reason: `Ad view class detected: ${adView.className}`,
      network: null,
      fullScreen: area(adView.bounds) > screenArea * 0.6,
    };
  }

  // 3. Resource-id namespace, but only when the surface is substantial —
  //    a tiny "ad_label" text node must not flag the whole screen.
  const adId = nodes.find((n) => AD_ID_HINTS.test(n.resourceId) && area(n.bounds) > screenArea * 0.25);
  if (adId) {
    return { isAd: true, reason: `Ad container id: ${adId.resourceId}`, network: null, fullScreen: area(adId.bounds) > screenArea * 0.7 };
  }

  // 4. A near-fullscreen surface owned by a package other than the app under
  //    test, while the app is nominally foreground, is an ad/webview overlay.
  if (appPackage) {
    const foreign = nodes.find((n) =>
      n.packageName
      && n.packageName !== appPackage
      && !n.packageName.startsWith('com.android.systemui')
      && area(n.bounds) > screenArea * 0.8);
    if (foreign) {
      return {
        isAd: true,
        reason: `Full-screen overlay owned by ${foreign.packageName}`,
        network: foreign.packageName,
        fullScreen: true,
      };
    }
  }

  return { isAd: false, reason: '', network: null, fullScreen: false };
}

/** Ranks candidate dismiss controls found in the live hierarchy. */
function findDismissControls(nodes: UiNode[], w: number, h: number): UiNode[] {
  const scored: Array<{ n: UiNode; score: number }> = [];

  for (const n of nodes) {
    if (!n.enabled) continue;
    const label = labelOf(n);
    const id = n.resourceId;
    let score = 0;

    if (DISMISS_LABELS.test(label)) score += 6;
    else if (DISMISS_LOOSE.test(label)) score += 4;
    if (DISMISS_ID.test(id)) score += 5;
    if (/ImageButton|ImageView/i.test(n.className) && !label && n.clickable) {
      // Unlabeled icon button in a corner is the classic close affordance.
      const c = centerOf(n.bounds);
      const inTopCorner = c.y < h * 0.2 && (c.x < w * 0.2 || c.x > w * 0.8);
      const small = bw(n.bounds) < w * 0.25 && bh(n.bounds) < h * 0.12;
      if (inTopCorner && small) score += 3;
    }
    if (!n.clickable) score -= 2;

    if (score >= 3) scored.push({ n, score });
  }

  return scored.sort((a, b) => b.score - a.score).map((s) => s.n);
}

/** True when the current hierarchy still shows an ad surface. */
function stillAd(xml: string, appPackage: string, w: number, h: number): boolean {
  const { nodes } = parseHierarchy(xml);
  const activityGuess = '';
  return detectAd(nodes, activityGuess, appPackage, w, h).isAd;
}

export interface AdDismissResult {
  dismissed: boolean;
  attempts: string[];
  waitedMs: number;
}

/**
 * Dismisses an ad the way a person would: look for a usable close control; if
 * a countdown is blocking it, poll until a control appears (bounded), then tap
 * it. Falls back to Back. Never uses fixed sleeps or fixed coordinates.
 */
export async function dismissAd(
  serial: string,
  appPackage: string,
  w: number,
  h: number,
  maxWaitMs = 30_000,
): Promise<AdDismissResult> {
  const attempts: string[] = [];
  const started = Date.now();

  // Wait — adaptively — for a dismiss control to exist. Rewarded/interstitial
  // ads gate the close button behind a countdown; we poll the real hierarchy
  // rather than guessing how long that countdown is.
  const appeared = await waitUntil(
    serial,
    (xml) => {
      const { nodes } = parseHierarchy(xml);
      return findDismissControls(nodes, w, h).length > 0;
    },
    maxWaitMs,
  );
  attempts.push(appeared ? 'dismiss control became available' : `no dismiss control within ${maxWaitMs}ms`);

  // Try each candidate control, best-ranked first.
  const xml = await dumpHierarchy(serial);
  const { nodes } = parseHierarchy(xml);
  const candidates = findDismissControls(nodes, w, h);

  for (const c of candidates.slice(0, 4)) {
    const p = centerOf(c.bounds);
    await tap(serial, p.x, p.y);
    attempts.push(`tapped "${labelOf(c) || c.resourceId || c.className}"`);
    await waitForStableUi(serial, { timeoutMs: 3_500 });
    const after = await dumpHierarchy(serial);
    if (after && !stillAd(after, appPackage, w, h)) {
      return { dismissed: true, attempts, waitedMs: Date.now() - started };
    }
  }

  // System Back is the universal escape hatch.
  await pressKey(serial, KEY.BACK);
  attempts.push('pressed BACK');
  await waitForStableUi(serial, { timeoutMs: 3_500 });
  const after = await dumpHierarchy(serial);
  const dismissed = !after || !stillAd(after, appPackage, w, h);

  return { dismissed, attempts, waitedMs: Date.now() - started };
}

/** Countdown text present — reported as evidence when an ad delays testing. */
export function hasCountdown(nodes: UiNode[]): boolean {
  const text = visibleText(nodes);
  return /skip in|\bad\b.*\d{1,2}\s*s\b/i.test(text) || COUNTDOWN.test(text.slice(0, 120));
}
