import type { Bounds, UiNode } from './types';
import { centerOf, labelOf, visibleText, area, width as bw, height as bh } from './ui-parser';
import { dumpHierarchy, tap, pressKey, KEY, isAppForeground, startAppTimed } from './device';
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
  /**
   * True only when the ad actually BLOCKS the app — a full-screen interstitial,
   * rewarded video, or app-open ad that must be dismissed to continue.
   *
   * An inline banner or native ad embedded in an otherwise usable app screen is
   * `isAd: true, blocking: false`: it is recorded as evidence and its nodes are
   * avoided, but the screen is still explored normally. Treating those as
   * blocking is what previously made the engine hammer BACK on a perfectly good
   * screen until it exited the app to the launcher.
   */
  blocking: boolean;
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
  /** Largest area covered by any node matching an ad signal. */
  const adSurfaceArea = (predicate: (n: UiNode) => boolean): number =>
    nodes.filter(predicate).reduce((max, n) => Math.max(max, area(n.bounds)), 0);

  /**
   * The app's own screen is still usable when interactive, app-owned controls
   * exist outside the ad surface. Interstitials cover everything; banners
   * don't. This is the signal that separates "must dismiss" from "just avoid".
   */
  const appOwnedInteractive = nodes.filter(
    (n) => n.enabled && (n.clickable || n.scrollable)
      && (!n.packageName || n.packageName === appPackage)
      && !AD_VIEW_CLASSES.test(n.className)
      && !AD_ID_HINTS.test(n.resourceId)
      && !sdkMatch(`${n.packageName}${n.className}${n.resourceId}`),
  ).length;

  // The activity itself being an ad activity is always blocking — the ad SDK
  // owns the whole window at that point.
  const activityIsAd = Boolean(sdkMatch(activity || '')) || AD_VIEW_CLASSES.test(activity || '');

  // 1. SDK signature anywhere in the hierarchy or the resolved activity.
  const sdkNode = nodes.find((n) => sdkMatch(`${n.packageName} ${n.className} ${n.resourceId}`));
  const sdkNet = sdkMatch(activity || '') ?? (sdkNode ? sdkMatch(`${sdkNode.packageName} ${sdkNode.className} ${sdkNode.resourceId}`) : null);
  if (sdkNet) {
    const covered = adSurfaceArea((n) => Boolean(sdkMatch(`${n.packageName} ${n.className} ${n.resourceId}`)));
    const fullScreen = covered > screenArea * 0.75;
    return {
      isAd: true,
      reason: `Ad SDK surface detected: ${sdkNet}`,
      network: sdkNet,
      fullScreen,
      // Blocking only when it owns the window, or covers most of the screen and
      // leaves the app with no usable controls of its own.
      blocking: activityIsAd || (fullScreen && appOwnedInteractive === 0),
    };
  }

  // 2. Ad view classes (some networks obfuscate package but keep view names).
  const adView = nodes.find((n) => AD_VIEW_CLASSES.test(n.className));
  if (adView) {
    const covered = area(adView.bounds);
    const fullScreen = covered > screenArea * 0.75;
    return {
      isAd: true,
      reason: `Ad view class detected: ${adView.className}`,
      network: null,
      fullScreen,
      blocking: activityIsAd || (fullScreen && appOwnedInteractive === 0),
    };
  }

  // 3. Resource-id namespace, but only when the surface is substantial —
  //    a tiny "ad_label" text node must not flag the whole screen.
  const adId = nodes.find((n) => AD_ID_HINTS.test(n.resourceId) && area(n.bounds) > screenArea * 0.25);
  if (adId) {
    const fullScreen = area(adId.bounds) > screenArea * 0.75;
    return {
      isAd: true,
      reason: `Ad container id: ${adId.resourceId}`,
      network: null,
      fullScreen,
      blocking: fullScreen && appOwnedInteractive === 0,
    };
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
        blocking: true,
      };
    }
  }

  return { isAd: false, reason: '', network: null, fullScreen: false, blocking: false };
}

/** True when a node itself carries an ad signature. */
export function isAdNode(n: UiNode): boolean {
  return Boolean(sdkMatch(`${n.packageName} ${n.className} ${n.resourceId}`))
    || AD_VIEW_CLASSES.test(n.className)
    || AD_ID_HINTS.test(n.resourceId);
}

/**
 * Bounding boxes of every ad container on the screen.
 *
 * Signature matching alone is not enough to avoid tapping ads: a native ad or a
 * WebView-rendered banner puts plain FrameLayouts/TextViews/ImageViews (no
 * ad-ish class or resource-id) INSIDE an ad container. Those children look like
 * ordinary app controls, and tapping one opens the advertiser's browser or store
 * page. Excluding anything geometrically inside an ad container catches them all.
 */
export function adRegions(nodes: UiNode[]): Bounds[] {
  return nodes
    .filter((n) => isAdNode(n) && area(n.bounds) > 0)
    .map((n) => n.bounds);
}

/** True when the node's centre falls inside any ad region — never tap these. */
export function isInsideAdRegion(n: UiNode, regions: Bounds[]): boolean {
  if (regions.length === 0) return false;
  const c = centerOf(n.bounds);
  return regions.some((r) => c.x >= r.left && c.x <= r.right && c.y >= r.top && c.y <= r.bottom);
}

/**
 * Ranks candidate dismiss controls found in the live hierarchy.
 *
 * `withinRegions` constrains candidates to controls that sit geometrically
 * inside an ad container. That matters for an ad merely OVERLAID on a usable
 * screen: the app's own chrome routinely offers "Close", "Cancel" or "Skip"
 * buttons, and tapping one of those believing it closes the ad would navigate
 * the app and corrupt the flow under test. A full-screen interstitial owns the
 * window, so there is nothing else to confuse and no constraint is needed.
 */
function findDismissControls(nodes: UiNode[], w: number, h: number, withinRegions?: Bounds[]): UiNode[] {
  const scored: Array<{ n: UiNode; score: number }> = [];

  for (const n of nodes) {
    if (!n.enabled) continue;
    if (withinRegions && withinRegions.length > 0 && !isInsideAdRegion(n, withinRegions)) continue;
    const label = labelOf(n);
    const id = n.resourceId;
    let score = 0;

    if (DISMISS_LABELS.test(label)) score += 6;
    else if (DISMISS_LOOSE.test(label)) score += 4;
    if (DISMISS_ID.test(id)) score += 5;
    if (/ImageButton|ImageView|View/i.test(n.className) && !label && n.clickable) {
      // Unlabeled icon button in a top corner is the classic close affordance.
      // The vertical band covers the top 30%, not 20%: measured on a real device,
      // ad and paywall close buttons sit below the status bar and the creative's
      // own padding (one was 22.6% down), so a tighter band missed them entirely.
      const c = centerOf(n.bounds);
      const inTopCorner = c.y < h * 0.3 && (c.x < w * 0.25 || c.x > w * 0.75);
      const small = bw(n.bounds) < w * 0.25 && bh(n.bounds) < h * 0.12;
      if (inTopCorner && small) score += 4;
    }
    if (!n.clickable) score -= 2;

    if (score >= 3) scored.push({ n, score });
  }

  return scored.sort((a, b) => b.score - a.score).map((s) => s.n);
}

/**
 * True when the hierarchy still shows a BLOCKING ad. An inline banner left on
 * the screen does not count as "still blocked" — otherwise dismissal would
 * loop forever on a screen that is perfectly usable.
 *
 * The resolved activity must be passed in: an ad SDK's own activity is the
 * strongest blocking signal there is, and omitting it (as this used to) made a
 * still-displayed interstitial read as successfully dismissed whenever its
 * hierarchy carried no other ad signature.
 */
function stillAd(xml: string, activity: string, appPackage: string, w: number, h: number): boolean {
  const { nodes } = parseHierarchy(xml);
  return detectAd(nodes, activity, appPackage, w, h).blocking;
}

/**
 * Whether a usable dismiss affordance exists right now. Lets callers close an
 * ad that is merely overlaid (a banner or a partial native ad) when a close
 * control is genuinely present, without paying the countdown wait an
 * interstitial needs.
 */
export function hasDismissControl(
  nodes: UiNode[], w: number, h: number, opts: { withinAdOnly?: boolean } = {},
): boolean {
  const regions = opts.withinAdOnly ? adRegions(nodes) : undefined;
  return findDismissControls(nodes, w, h, regions).length > 0;
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
  opts: { allowBack?: boolean; withinAdOnly?: boolean } = {},
): Promise<AdDismissResult> {
  const attempts: string[] = [];
  const started = Date.now();
  const allowBack = opts.allowBack ?? true;
  /** Constrain taps to the ad's own container — see findDismissControls(). */
  const scoped = opts.withinAdOnly ?? false;
  const regionsFor = (ns: UiNode[]): Bounds[] | undefined => (scoped ? adRegions(ns) : undefined);

  // Wait — adaptively — for a dismiss control to exist. Rewarded/interstitial
  // ads gate the close button behind a countdown; we poll the real hierarchy
  // rather than guessing how long that countdown is. A control that is already
  // present returns on the first poll, so this costs nothing when the ad is
  // immediately closable.
  const appeared = await waitUntil(
    serial,
    (xml) => {
      const { nodes } = parseHierarchy(xml);
      return findDismissControls(nodes, w, h, regionsFor(nodes)).length > 0;
    },
    maxWaitMs,
  );
  attempts.push(appeared ? 'dismiss control became available' : `no dismiss control within ${maxWaitMs}ms`);

  // Try each candidate control, best-ranked first.
  const xml = await dumpHierarchy(serial);
  const { nodes } = parseHierarchy(xml);
  const candidates = findDismissControls(nodes, w, h, regionsFor(nodes));

  for (const c of candidates.slice(0, 4)) {
    const p = centerOf(c.bounds);
    await tap(serial, p.x, p.y);
    attempts.push(`tapped "${labelOf(c) || c.resourceId || c.className}"`);
    const settled = await waitForStableUi(serial, { timeoutMs: 3_500 });
    const after = settled.xml || (await dumpHierarchy(serial));
    if (after && !stillAd(after, settled.activity, appPackage, w, h)) {
      return { dismissed: true, attempts, waitedMs: Date.now() - started };
    }
  }

  // System Back is the universal escape hatch — but it can also back out of the
  // app entirely. Callers handling a merely-overlaid ad opt out of it, because
  // BACK on a usable screen navigates the app instead of closing anything.
  if (!allowBack) {
    const settled = await waitForStableUi(serial, { timeoutMs: 2_000 });
    const after = settled.xml || (await dumpHierarchy(serial));
    return {
      dismissed: !after || !stillAd(after, settled.activity, appPackage, w, h),
      attempts,
      waitedMs: Date.now() - started,
    };
  }

  // Press it ONCE, then make sure we're still in the app under test; if Back
  // exited to the launcher, relaunch so the run continues instead of stranding
  // the agent on the home screen.
  await pressKey(serial, KEY.BACK);
  attempts.push('pressed BACK');
  const settledBack = await waitForStableUi(serial, { timeoutMs: 3_500 });

  if (!(await isAppForeground(serial, appPackage))) {
    attempts.push('BACK exited the app — relaunching');
    const relaunch = await startAppTimed(serial, appPackage);
    attempts.push(relaunch.ok ? 'relaunched' : 'relaunch failed');
    await waitForStableUi(serial, { timeoutMs: 4_000 });
    return { dismissed: relaunch.ok, attempts, waitedMs: Date.now() - started };
  }

  const after = settledBack.xml || (await dumpHierarchy(serial));
  const dismissed = !after || !stillAd(after, settledBack.activity, appPackage, w, h);

  return { dismissed, attempts, waitedMs: Date.now() - started };
}

/** Countdown text present — reported as evidence when an ad delays testing. */
export function hasCountdown(nodes: UiNode[]): boolean {
  const text = visibleText(nodes);
  return /skip in|\bad\b.*\d{1,2}\s*s\b/i.test(text) || COUNTDOWN.test(text.slice(0, 120));
}
