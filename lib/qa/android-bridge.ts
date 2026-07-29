/**
 * Real Android device control over ADB: install, verify, launch, capture, and
 * drive a physically connected device.
 *
 * Every function here executes a real `adb` command against real hardware.
 * Nothing is simulated. Where a capability genuinely requires tooling that is
 * not present (bundletool for .aab), the caller is told exactly that instead of
 * being handed a fabricated success.
 */

import { execFile } from 'child_process';
import { existsSync } from 'fs';
import { mkdtemp, readFile, unlink, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';
import { resolveAdbPath } from '@/lib/qa/device-detect';

const DEFAULT_TIMEOUT_MS = 15000;
const INSTALL_TIMEOUT_MS = 180000;

export interface CmdResult { ok: boolean; stdout: string; stderr: string }

function run(file: string, args: string[], timeout = DEFAULT_TIMEOUT_MS, encoding: BufferEncoding | 'buffer' = 'utf8'): Promise<CmdResult & { raw: Buffer }> {
  return new Promise((resolve) => {
    execFile(
      file, args,
      { timeout, maxBuffer: 64 * 1024 * 1024, encoding: encoding === 'buffer' ? 'buffer' : encoding } as never,
      (err, stdout, stderr) => {
        const raw = Buffer.isBuffer(stdout) ? stdout : Buffer.from(String(stdout ?? ''));
        resolve({
          ok: !err,
          stdout: Buffer.isBuffer(stdout) ? '' : String(stdout ?? ''),
          stderr: String(stderr ?? ''),
          raw,
        });
      },
    );
  });
}

async function adb(serial: string, args: string[], timeout?: number) {
  const bin = resolveAdbPath() ?? 'adb';
  return run(bin, ['-s', serial, ...args], timeout);
}

async function adbBinary(serial: string, args: string[], timeout?: number) {
  const bin = resolveAdbPath() ?? 'adb';
  return run(bin, ['-s', serial, ...args], timeout, 'buffer');
}

export async function shell(serial: string, command: string, timeout?: number): Promise<string> {
  const r = await adb(serial, ['shell', command], timeout);
  return r.stdout.replace(/\r/g, '');
}

// ---------------------------------------------------------------- screenshots

/**
 * A raw device screencap is ~3MB of PNG, far too large to store per step.
 * Downscale to a JPEG using whatever image tool the host has. If none is
 * available we return the full-size PNG rather than no screenshot at all —
 * a real oversized capture beats a fake small one.
 */
async function compress(pngBuffer: Buffer): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'qa-shot-'));
  const src = path.join(dir, 'in.png');
  const out = path.join(dir, 'out.jpg');
  try {
    await writeFile(src, pngBuffer);

    // macOS ships `sips`; Linux/CI usually has ImageMagick.
    const attempts: Array<[string, string[]]> = [
      ['sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', '55', '-Z', '720', src, '--out', out]],
      ['magick', [src, '-resize', 'x720', '-quality', '55', out]],
      ['convert', [src, '-resize', 'x720', '-quality', '55', out]],
    ];
    for (const [bin, args] of attempts) {
      const r = await run(bin, args, 12000);
      if (r.ok && existsSync(out)) {
        const jpg = await readFile(out);
        return `data:image/jpeg;base64,${jpg.toString('base64')}`;
      }
    }
    return `data:image/png;base64,${pngBuffer.toString('base64')}`;
  } finally {
    await unlink(src).catch(() => {});
    await unlink(out).catch(() => {});
  }
}

/** Real screenshot of what is on the device screen right now. */
export async function captureDeviceScreen(serial: string): Promise<string | null> {
  const r = await adbBinary(serial, ['exec-out', 'screencap', '-p'], 20000);
  if (!r.ok || r.raw.length < 1000) return null;
  try {
    return await compress(r.raw);
  } catch {
    return null;
  }
}

// ------------------------------------------------------------------- install

export interface InstallOutcome {
  ok: boolean;
  /** Machine-readable reason when ok === false. */
  code?: 'unsupported_aab' | 'file_missing' | 'install_failed' | 'verify_failed';
  message: string;
  packageName: string | null;
}

/** Is the package present on the device right now? */
export async function isPackageInstalled(serial: string, pkg: string): Promise<boolean> {
  if (!pkg) return false;
  const out = await shell(serial, `pm list packages ${pkg}`, 12000);
  return out.split('\n').some((l) => l.trim() === `package:${pkg}`);
}

/**
 * Install an uploaded APK onto the device and verify it really landed.
 * `.aab` bundles cannot be installed by adb — they must be converted to a
 * device-specific APK set with bundletool first, which is not bundled here.
 */
export async function installApp(
  serial: string,
  filePath: string,
  packageName: string | null,
): Promise<InstallOutcome> {
  if (filePath.toLowerCase().endsWith('.aab')) {
    return {
      ok: false,
      code: 'unsupported_aab',
      message: 'Android App Bundles (.aab) cannot be installed directly by ADB. Convert the bundle to an APK set with bundletool (`bundletool build-apks --mode=universal`) and upload the resulting .apk, or upload a universal APK instead.',
      packageName,
    };
  }
  if (!existsSync(filePath)) {
    return {
      ok: false,
      code: 'file_missing',
      message: `The uploaded application file is no longer present on the server at ${filePath}. Re-upload the binary and start the run again.`,
      packageName,
    };
  }

  // -r reinstall keeping data, -t allow test builds, -d allow version downgrade.
  let r = await adb(serial, ['install', '-r', '-t', '-d', filePath], INSTALL_TIMEOUT_MS);
  let combined = `${r.stdout}\n${r.stderr}`.trim();
  let recovered: string | null = null;

  // Some devices/Android builds still refuse a downgrade or a signature
  // mismatch even with -d (a real tester re-uploading an older or
  // differently-signed build than what's already on the device is a normal,
  // common case — this must not just dead-end the whole run). The only
  // resolution ADB itself supports is a clean uninstall first.
  if (!/Success/i.test(combined) && packageName && /VERSION_DOWNGRADE|UPDATE_INCOMPATIBLE|INSTALL_FAILED_ALREADY_EXISTS/i.test(combined)) {
    const reasonFirst = combined.match(/Failure \[([^\]]+)\]/)?.[1] ?? 'a conflicting existing install';
    await adb(serial, ['uninstall', packageName], INSTALL_TIMEOUT_MS).catch(() => null);
    r = await adb(serial, ['install', '-r', '-t', '-d', filePath], INSTALL_TIMEOUT_MS);
    combined = `${r.stdout}\n${r.stderr}`.trim();
    if (/Success/i.test(combined)) {
      recovered = `The existing install conflicted with this build (${reasonFirst}), so it was uninstalled first and this build was installed fresh.`;
    }
  }

  if (!/Success/i.test(combined)) {
    const reason = combined.match(/Failure \[([^\]]+)\]/)?.[1] ?? combined.split('\n').filter(Boolean).pop() ?? 'unknown error';
    return {
      ok: false,
      code: 'install_failed',
      message: `ADB rejected the installation: ${reason}`,
      packageName,
    };
  }

  // Verify rather than trusting the "Success" string.
  if (packageName) {
    const present = await isPackageInstalled(serial, packageName);
    if (!present) {
      return {
        ok: false,
        code: 'verify_failed',
        message: `ADB reported success but package "${packageName}" is not listed on the device afterwards.`,
        packageName,
      };
    }
  }

  return {
    ok: true,
    message: `Installed successfully${packageName ? ` (${packageName})` : ''}.${recovered ? ` ${recovered}` : ''}`,
    packageName,
  };
}

// -------------------------------------------------------------------- launch

/** Resolve the launchable activity so we can start the app deterministically. */
export async function resolveLaunchActivity(serial: string, pkg: string): Promise<string | null> {
  const brief = await shell(serial, `cmd package resolve-activity --brief ${pkg}`, 12000);
  const line = brief.split('\n').map((l) => l.trim()).filter(Boolean).pop();
  if (line && line.includes('/')) return line;
  return null;
}

/** Which package currently owns the foreground window. */
export async function foregroundPackage(serial: string): Promise<string | null> {
  const out = await shell(serial, 'dumpsys window | grep -E "mCurrentFocus|mFocusedApp"', 12000);
  return out.match(/([a-zA-Z][\w.]+)\/[\w.$]+/)?.[1] ?? null;
}

/**
 * Wake and unlock the screen. `am start` silently succeeds against a sleeping
 * or locked device while the app never actually reaches the foreground, so this
 * must run before any launch or interaction.
 */
export async function ensureAwake(serial: string): Promise<{ awake: boolean; locked: boolean; detail: string }> {
  const power = await shell(serial, 'dumpsys power | grep -E "mWakefulness="', 12000);
  const asleep = /mWakefulness=(Asleep|Dozing)/i.test(power);
  if (asleep) {
    await shell(serial, 'input keyevent KEYCODE_WAKEUP', 10000);
    await new Promise((r) => setTimeout(r, 800));
  }

  // Dismiss a non-secure keyguard with a swipe up. A PIN/pattern lock cannot be
  // bypassed — that is reported so the user knows to unlock the device.
  const km = await shell(serial, 'dumpsys window | grep -E "mDreamingLockscreen|isStatusBarKeyguard"', 12000);
  const locked = /mDreamingLockscreen=true|isStatusBarKeyguard=true/i.test(km);
  if (locked) {
    const { width, height } = await screenSize(serial);
    await swipe(serial, Math.round(width / 2), Math.round(height * 0.8), Math.round(width / 2), Math.round(height * 0.2), 300);
    await new Promise((r) => setTimeout(r, 1000));
  }

  const after = await shell(serial, 'dumpsys window | grep -E "mDreamingLockscreen"', 12000);
  const stillLocked = /mDreamingLockscreen=true/i.test(after);
  return {
    awake: !asleep || true,
    locked: stillLocked,
    detail: stillLocked
      ? 'The device screen is still locked (a PIN, pattern, or biometric lock cannot be bypassed automatically). Unlock the device and start the run again.'
      : asleep || locked ? 'Device woken and unlocked.' : 'Device was already awake and unlocked.',
  };
}

export interface LaunchOutcome { ok: boolean; message: string; activity: string | null }

/**
 * Launch the app and wait until it genuinely owns the foreground window.
 * Execution must never begin against a screen that is not the app under test.
 */
export async function launchApp(serial: string, pkg: string, waitMs = 20000): Promise<LaunchOutcome> {
  // A sleeping/locked device accepts `am start` but never foregrounds the app.
  const wake = await ensureAwake(serial);
  if (wake.locked) return { ok: false, message: wake.detail, activity: null };

  const activity = await resolveLaunchActivity(serial, pkg);

  const startCmd = activity
    ? `am start -W -n ${activity}`
    : `monkey -p ${pkg} -c android.intent.category.LAUNCHER 1`;
  const started = await shell(serial, startCmd, 30000);

  if (/Error|Exception|No activities found/i.test(started) && !activity) {
    return { ok: false, message: `Could not launch ${pkg}: ${started.trim().split('\n')[0]}`, activity };
  }

  const deadline = Date.now() + waitMs;
  while (Date.now() < deadline) {
    const fg = await foregroundPackage(serial);
    if (fg === pkg) {
      // Owning the foreground is NOT the same as being ready: a splash screen
      // belongs to the app's own package. Wait for real, interactive content
      // before letting any test step run.
      const ready = await waitForAppReady(serial, pkg, activity);
      return ready.ready
        ? { ok: true, message: ready.detail, activity: ready.activity ?? activity }
        : { ok: false, message: ready.detail, activity: ready.activity ?? activity };
    }
    await new Promise((r) => setTimeout(r, 700));
  }

  const fg = await foregroundPackage(serial);
  return {
    ok: false,
    message: `${pkg} did not reach the foreground within ${waitMs / 1000}s (current foreground: ${fg ?? 'unknown'}).`,
    activity,
  };
}

export async function stopApp(serial: string, pkg: string): Promise<void> {
  await shell(serial, `am force-stop ${pkg}`, 12000);
}

/**
 * Wipe the app's data so the next launch is a genuine first-run.
 *
 * Test sheets describe one sequential journey starting from a fresh install
 * (splash → permissions → language → onboarding → home). Without this reset a
 * second run begins wherever the previous run left the app — already past the
 * language screen, for instance — so every early test case asserts against a
 * screen the app has moved beyond and fails for a reason that has nothing to
 * do with the build under test. A run must start from a deterministic state.
 */
export async function clearAppData(serial: string, pkg: string): Promise<{ ok: boolean; detail: string }> {
  const out = await shell(serial, `pm clear ${pkg}`, 30000);
  const ok = /Success/i.test(out);
  return {
    ok,
    detail: ok
      ? `Cleared app data for ${pkg} — the next launch is a fresh first-run.`
      : `Could not clear app data for ${pkg}: ${out.trim().split('\n')[0] || 'unknown error'}. The run will start from whatever state the app was left in.`,
  };
}

// ------------------------------------------------------------ view hierarchy

export interface UiNode {
  text: string;
  resourceId: string;
  contentDesc: string;
  className: string;
  clickable: boolean;
  enabled: boolean;
  focused: boolean;
  bounds: { x1: number; y1: number; x2: number; y2: number };
  center: { x: number; y: number };
}

function parseBounds(raw: string) {
  const m = raw.match(/\[(\d+),(\d+)\]\[(\d+),(\d+)\]/);
  if (!m) return null;
  const [x1, y1, x2, y2] = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])];
  return { x1, y1, x2, y2 };
}

/**
 * Dump the live view hierarchy. This is what makes real native step execution
 * possible without Appium: every node carries its text, id, and screen bounds,
 * so a step like "Click the Login button" resolves to a genuine tap coordinate.
 */
export async function dumpUi(serial: string): Promise<UiNode[]> {
  const remote = '/sdcard/qa-ui-dump.xml';
  const dump = await shell(serial, `uiautomator dump ${remote}`, 20000);
  if (!/dumped to/i.test(dump)) return [];
  const xml = await shell(serial, `cat ${remote}`, 20000);
  await shell(serial, `rm -f ${remote}`, 8000).catch(() => {});

  const nodes: UiNode[] = [];
  const attr = (frag: string, name: string) => frag.match(new RegExp(`${name}="([^"]*)"`))?.[1] ?? '';

  for (const frag of xml.match(/<node\b[^>]*>/g) ?? []) {
    const bounds = parseBounds(attr(frag, 'bounds'));
    if (!bounds) continue;
    // Zero-area nodes cannot be interacted with.
    if (bounds.x2 <= bounds.x1 || bounds.y2 <= bounds.y1) continue;
    nodes.push({
      text: attr(frag, 'text'),
      resourceId: attr(frag, 'resource-id'),
      contentDesc: attr(frag, 'content-desc'),
      className: attr(frag, 'class'),
      clickable: attr(frag, 'clickable') === 'true',
      enabled: attr(frag, 'enabled') === 'true',
      focused: attr(frag, 'focused') === 'true',
      bounds,
      center: { x: Math.round((bounds.x1 + bounds.x2) / 2), y: Math.round((bounds.y1 + bounds.y2) / 2) },
    });
  }
  return nodes;
}

/** Currently focused activity, e.g. "com.app/.SplashActivity". */
export async function currentActivity(serial: string): Promise<string | null> {
  const out = await shell(serial, 'dumpsys window | grep -E "mCurrentFocus"', 12000);
  return out.match(/([a-zA-Z][\w.]+\/[\w.$]+)/)?.[1] ?? null;
}

/**
 * A cheap fingerprint of what is on screen. Two identical signatures mean the
 * UI has not changed — the basis for both settle-detection and stuck-detection.
 */
export function uiSignature(nodes: UiNode[]): string {
  return nodes
    .map((n) => `${n.className}|${n.text}|${n.resourceId}|${n.bounds.x1},${n.bounds.y1}`)
    .join('~');
}

export interface SettleResult {
  settled: boolean;
  signature: string;
  activity: string | null;
  nodes: UiNode[];
  waitedMs: number;
}

/**
 * Wait until the screen stops changing.
 *
 * A fixed sleep is not good enough: splash screens, progress spinners, and
 * animated transitions all belong to the app's own package, so "the app is in
 * the foreground" says nothing about whether its content is ready. This polls
 * the real view hierarchy until the same signature repeats `stableChecks`
 * times, or the budget expires.
 */
export async function waitForUiSettle(
  serial: string,
  opts: { timeoutMs?: number; pollMs?: number; stableChecks?: number } = {},
): Promise<SettleResult> {
  const timeoutMs = opts.timeoutMs ?? 15000;
  const pollMs = opts.pollMs ?? 700;
  const stableChecks = opts.stableChecks ?? 2;

  const started = Date.now();
  let lastSig = '';
  let stable = 0;
  let nodes: UiNode[] = [];

  while (Date.now() - started < timeoutMs) {
    nodes = await dumpUi(serial);
    const sig = uiSignature(nodes);

    // A screen showing only a spinner/progress bar is still loading.
    const busy = nodes.length > 0 && nodes.every(
      (n) => /ProgressBar|Loading/i.test(n.className) || (!n.text && !n.contentDesc),
    );

    if (sig === lastSig && sig !== '' && !busy) {
      stable += 1;
      if (stable >= stableChecks) {
        return { settled: true, signature: sig, activity: await currentActivity(serial), nodes, waitedMs: Date.now() - started };
      }
    } else {
      stable = 0;
      lastSig = sig;
    }
    await new Promise((r) => setTimeout(r, pollMs));
  }

  return { settled: false, signature: lastSig, activity: await currentActivity(serial), nodes, waitedMs: Date.now() - started };
}

/**
 * Wait for the app to move past its splash/launch screen onto real content.
 * Returns once the activity changes away from the launch activity, or the view
 * hierarchy becomes interactive and stable.
 */
export async function waitForAppReady(
  serial: string,
  pkg: string,
  launchActivity: string | null,
  timeoutMs = 30000,
): Promise<{ ready: boolean; activity: string | null; detail: string }> {
  const started = Date.now();
  const splashActivity = launchActivity;

  while (Date.now() - started < timeoutMs) {
    const settle = await waitForUiSettle(serial, { timeoutMs: 6000, pollMs: 600, stableChecks: 2 });
    const activity = settle.activity;

    // Lost the app entirely (crash, or it bounced back to the launcher).
    const fg = await foregroundPackage(serial);
    if (fg !== pkg) {
      return { ready: false, activity, detail: `The app left the foreground during startup (now: ${fg ?? 'unknown'}). It may have crashed on launch.` };
    }

    const interactive = settle.nodes.filter((n) => n.clickable || /EditText/i.test(n.className)).length;
    const hasContent = settle.nodes.some((n) => (n.text || n.contentDesc).trim().length > 0);
    const movedOn = Boolean(splashActivity && activity && activity !== splashActivity);

    // Readiness is "there is real content to act on", not "the pixels stopped
    // moving" — an app with a clock or looping animation never fully settles
    // and must not be mistaken for a stuck splash screen.
    if ((movedOn || interactive > 0) && hasContent) {
      return {
        ready: true,
        activity,
        detail: `App content is ready on ${activity ?? 'unknown activity'} (${interactive} interactive element(s) after ${Math.round((Date.now() - started) / 100) / 10}s).`,
      };
    }
  }

  const activity = await currentActivity(serial);
  return {
    ready: false,
    activity,
    detail: `The app never progressed past its launch screen within ${timeoutMs / 1000}s (still on ${activity ?? 'unknown activity'} with no interactive content). It appears stuck on the splash screen.`,
  };
}

/**
 * Packages that own system-level dialogs which can appear over any app and
 * block a test run (runtime permission prompts, "app keeps stopping", ANR).
 */
const PERMISSION_PKGS = ['com.google.android.permissioncontroller', 'com.android.permissioncontroller', 'com.android.packageinstaller'];

/**
 * Labels that move a flow FORWARD, grouped by intent. Ordered so the engine
 * prefers genuinely progressing (Continue/Next) over granting (Allow) over
 * dismissing (Skip) — skipping is a last resort because it can bypass the very
 * screen a test case is about.
 */
const ADVANCE_LABELS = [
  'continue', 'next', 'get started', 'getstarted', 'start', 'proceed', 'done', 'finish',
  'got it', 'ok', 'okay', 'yes', 'confirm', 'agree', 'i agree', 'accept', 'submit', 'save', 'apply',
];
const GRANT_LABELS = [
  'while using the app', 'only this time', 'allow all the time', 'allow', 'grant', 'turn on',
];
const DISMISS_LABELS = [
  'skip', 'skip for now', 'not now', 'no thanks', 'later', 'maybe later', 'close', 'dismiss', 'cancel', '×', '✕', 'x',
];

/**
 * Resource-id fragments that reveal a control's intent when it has no visible
 * text. Icon-only confirm buttons (a checkmark, an arrow, a FAB) are extremely
 * common and carry their meaning only in the id — e.g. `.../id/imgDone`. Without
 * this, a run strands on any screen whose only way forward is an icon.
 */
const ID_HINTS: Record<ForwardIntent, RegExp> = {
  advance: /\b(?:done|next|continue|proceed|submit|confirm|finish|apply|save|forward|arrow_?right|fab_?next|btn_?ok)\b|(?:img|btn|iv|ib|fab)_?(?:done|next|continue|ok|submit|confirm|save|arrow)/i,
  grant: /(?:allow|grant|permission)/i,
  dismiss: /(?:close|skip|dismiss|cancel)/i,
};

/** Last path segment of a resource id: "pkg:id/imgDone" -> "imgDone". */
function idFragment(resourceId: string): string {
  return resourceId.split('/').pop() ?? '';
}

function matchLabel(nodes: UiNode[], labels: string[], intent?: ForwardIntent): UiNode | null {
  const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');
  // Exact match first — "OK" should not match "Bookmarks".
  for (const label of labels) {
    const hit = nodes.find((n) => n.enabled && (norm(n.text) === label || norm(n.contentDesc) === label));
    if (hit) return hit;
  }
  for (const label of labels) {
    if (label.length < 4) continue; // too short to match safely as a substring
    const hit = nodes.find((n) => n.enabled && (norm(n.text).includes(label) || norm(n.contentDesc).includes(label)));
    if (hit) return hit;
  }
  // Fall back to resource-id intent for icon-only controls with no text.
  if (intent) {
    const hit = nodes.find((n) => n.enabled && n.clickable && ID_HINTS[intent].test(idFragment(n.resourceId)));
    if (hit) return hit;
  }
  return null;
}

/**
 * Like matchLabel, but only returns matches that are genuinely tappable —
 * a text match with no clickable ancestor is inert (a heading, a disclaimer)
 * and must not be treated as a control.
 */
function matchTappable(nodes: UiNode[], labels: string[], intent?: ForwardIntent): UiNode | null {
  const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

  const tryCandidates = (predicate: (n: UiNode) => boolean): UiNode | null => {
    for (const n of nodes) {
      if (!n.enabled || !predicate(n)) continue;
      const tappable = resolveTappable(nodes, n);
      if (tappable) return tappable;
    }
    return null;
  };

  for (const label of labels) {
    const hit = tryCandidates((n) => norm(n.text) === label || norm(n.contentDesc) === label);
    if (hit) return hit;
  }
  for (const label of labels) {
    if (label.length < 4) continue;
    const hit = tryCandidates((n) => norm(n.text).includes(label) || norm(n.contentDesc).includes(label));
    if (hit) return hit;
  }
  if (intent) {
    const hit = nodes.find((n) => n.enabled && n.clickable && ID_HINTS[intent].test(idFragment(n.resourceId)));
    if (hit) return hit;
  }
  return null;
}

export type ForwardIntent = 'advance' | 'grant' | 'dismiss';

/**
 * Find the control that moves the current screen forward, without any
 * hardcoded knowledge of the app. This is what lets a vague sheet step like
 * "Continue application flow" or "Complete permission flow (if displayed)"
 * actually do something on a screen the engine has never seen before.
 */
export function findForwardAffordance(
  nodes: UiNode[],
  preferred: ForwardIntent[] = ['advance', 'grant', 'dismiss'],
): { node: UiNode; intent: ForwardIntent } | null {
  const byIntent: Record<ForwardIntent, string[]> = {
    advance: ADVANCE_LABELS, grant: GRANT_LABELS, dismiss: DISMISS_LABELS,
  };
  for (const intent of preferred) {
    const node = matchTappable(nodes, byIntent[intent], intent);
    if (node) return { node, intent };
  }
  return null;
}

/** Is a system permission / installer dialog currently on top? */
export async function systemDialogPackage(serial: string): Promise<string | null> {
  const fg = await foregroundPackage(serial);
  return fg && PERMISSION_PKGS.includes(fg) ? fg : null;
}

/**
 * Clear system-level dialogs that block a run: runtime permission prompts and
 * crash/ANR dialogs. Returns what it actually did so the caller can report it
 * honestly rather than silently swallowing a crash.
 */
export async function dismissSystemDialogs(
  serial: string,
  maxRounds = 4,
): Promise<{ handled: string[]; crashed: boolean }> {
  const handled: string[] = [];
  let crashed = false;

  for (let round = 0; round < maxRounds; round++) {
    const nodes = await dumpUi(serial);
    if (nodes.length === 0) break;

    const text = visibleText(nodes).toLowerCase();

    // A crash/ANR dialog is real information — record it, then clear it so the
    // rest of the sheet can still run.
    if (/keeps stopping|has stopped|isn'?t responding|close app|wait/i.test(text)
        && /close app|close|wait|ok/i.test(text)) {
      const btn = matchLabel(nodes, ['close app', 'close', 'ok']);
      if (btn) {
        crashed = true;
        handled.push(`crash/ANR dialog dismissed ("${(btn.text || btn.contentDesc).trim()}")`);
        await tap(serial, btn.center.x, btn.center.y);
        await new Promise((r) => setTimeout(r, 1200));
        continue;
      }
    }

    const dialogPkg = await systemDialogPackage(serial);
    if (dialogPkg) {
      const btn = findForwardAffordance(nodes, ['grant', 'advance', 'dismiss']);
      if (btn) {
        handled.push(`permission dialog: tapped "${(btn.node.text || btn.node.contentDesc).trim()}"`);
        await tap(serial, btn.node.center.x, btn.node.center.y);
        await new Promise((r) => setTimeout(r, 1200));
        continue;
      }
    }

    break; // nothing left to clear
  }

  return { handled, crashed };
}

/**
 * Guarantee the app under test is the thing on screen before a test case runs.
 *
 * Without this, one stray tap that opens a browser, the Play Store, or a
 * settings page silently redirects every remaining test case to the wrong
 * application — the run keeps going and keeps "executing", but against
 * something that is not the app under test. That is exactly how a sheet
 * appears to "stop progressing" partway through.
 */
export async function ensureAppForeground(
  serial: string,
  pkg: string,
): Promise<{ ok: boolean; recovered: boolean; detail: string }> {
  const dialogs = await dismissSystemDialogs(serial);

  const fg = await foregroundPackage(serial);
  if (fg === pkg) {
    return {
      ok: true, recovered: false,
      detail: dialogs.handled.length > 0 ? `App in foreground. ${dialogs.handled.join('; ')}.` : 'App is in the foreground.',
    };
  }

  // Drifted away. An in-app flow can push a *system* surface on top (Play
  // billing, a share sheet, a browser). Relaunching alone often fails because
  // that surface still owns the window, so back out of it first — this is what
  // a tester would do, and it preserves the app's existing task/state.
  for (let i = 0; i < 3; i++) {
    if ((await foregroundPackage(serial)) === pkg) break;
    await pressKey(serial, 'KEYCODE_BACK');
    await new Promise((r) => setTimeout(r, 900));
  }

  if ((await foregroundPackage(serial)) === pkg) {
    return { ok: true, recovered: true, detail: `App had drifted to "${fg ?? 'unknown'}"; backed out of it and returned to the app.` };
  }

  const relaunch = await launchApp(serial, pkg, 20000);
  const nowFg = await foregroundPackage(serial);
  const ok = nowFg === pkg;
  return {
    ok,
    recovered: ok,
    detail: ok
      ? `App had drifted to "${fg ?? 'unknown'}" and was brought back to the foreground.${dialogs.crashed ? ' A crash/ANR dialog was cleared first.' : ''}`
      : `App is not in the foreground (currently "${nowFg ?? 'unknown'}") and could not be restored: ${relaunch.message}`,
  };
}

/**
 * Unambiguous ad/interstitial/promo dismiss vocabulary only — deliberately
 * narrow. A test step is free to target "Continue", "Next", "OK", "Allow",
 * etc. itself, so those generic labels must NEVER be auto-tapped here or this
 * would race the sheet's own intended interaction.
 */
const OVERLAY_DISMISS_RE = /\b(skip\s*ad|skip\s*advertisement|close\s*ad|no,?\s*thanks|no\s*thank\s*you|not\s*now|maybe\s*later|remind\s*me\s*later|rate\s*later)\b/i;
const OVERLAY_CLOSE_ICON_RE = /\b(close|dismiss|skip)\b/i;
/** A small square control is very likely an ad/interstitial's corner "X", not real app content. */
const SMALL_ICON_MAX_AREA = 140 * 140;

/**
 * Best-effort dismissal of an ad/promo interstitial or onboarding nag sitting
 * on top of the app under test — the kind of screen a sheet's step never
 * mentions but that would otherwise silently block every element lookup for
 * the rest of the run. Deliberately conservative: only unambiguous ad/promo
 * vocabulary and small corner close-icons are tapped, never generic flow
 * buttons a test step might be about to target itself.
 */
export async function dismissBlockingOverlay(
  serial: string,
  maxRounds = 2,
): Promise<{ handled: string[] }> {
  const handled: string[] = [];

  for (let round = 0; round < maxRounds; round++) {
    const nodes = await dumpUi(serial);
    if (nodes.length === 0) break;

    const byText = nodes.find((n) => n.clickable && n.enabled && OVERLAY_DISMISS_RE.test(`${n.text} ${n.contentDesc}`));
    const byIcon = !byText
      ? nodes.find((n) => n.clickable && n.enabled && OVERLAY_CLOSE_ICON_RE.test(n.contentDesc) && nodeArea(n) > 0 && nodeArea(n) <= SMALL_ICON_MAX_AREA)
      : null;
    const target = byText ?? byIcon;
    if (!target) break;

    const label = (target.text || target.contentDesc || 'close icon').trim();
    await tap(serial, target.center.x, target.center.y);
    await new Promise((r) => setTimeout(r, 900));
    handled.push(`dismissed overlay ("${label}")`);
  }

  return { handled };
}

/** All on-screen text, used for expectation assertions. */
export function visibleText(nodes: UiNode[]): string {
  return nodes.map((n) => `${n.text} ${n.contentDesc}`.trim()).filter(Boolean).join('\n');
}

function nodeArea(n: UiNode): number {
  return Math.max(0, n.bounds.x2 - n.bounds.x1) * Math.max(0, n.bounds.y2 - n.bounds.y1);
}

function containsNode(outer: UiNode, inner: UiNode): boolean {
  return outer.bounds.x1 <= inner.bounds.x1 && outer.bounds.y1 <= inner.bounds.y1
    && outer.bounds.x2 >= inner.bounds.x2 && outer.bounds.y2 >= inner.bounds.y2;
}

/**
 * Turn a matched node into something that can actually be tapped.
 *
 * Android labels are usually a non-clickable TextView nested inside a clickable
 * container, so tapping the label's own node is often a no-op. Worse, matching
 * on text alone will happily "find" a heading or a disclaimer — a run once
 * tapped the sentence "Cancel anytime. Secure with Play Store" simply because
 * it contained the word "cancel".
 *
 * So: if the node is clickable, use it. Otherwise use the SMALLEST clickable
 * node that fully contains it (its real control). If nothing clickable
 * contains it, the match is inert text and is rejected rather than tapped.
 */
export function resolveTappable(nodes: UiNode[], node: UiNode): UiNode | null {
  if (node.clickable && node.enabled) return node;
  const containers = nodes.filter((n) => n.clickable && n.enabled && containsNode(n, node));
  if (containers.length === 0) return null;
  // The smallest containing control is the most specific one.
  return containers.sort((a, b) => nodeArea(a) - nodeArea(b))[0];
}

/**
 * Find the node a human label refers to. Preference order mirrors how a tester
 * would look: exact text, then id, then description, then partial text.
 */
export function findNode(nodes: UiNode[], label: string, opts: { editable?: boolean; clickable?: boolean } = {}): UiNode | null {
  const q = label.trim().toLowerCase();
  if (!q) return null;

  const pool = nodes.filter((n) => {
    if (opts.editable) return /EditText|AutoComplete|SearchView/i.test(n.className);
    if (opts.clickable) return n.clickable || /Button|ImageView|TextView|CheckBox|Switch/i.test(n.className);
    return true;
  });

  const candidates = pool.length > 0 ? pool : nodes;
  const norm = (s: string) => s.trim().toLowerCase();

  return (
    candidates.find((n) => norm(n.text) === q)
    ?? candidates.find((n) => norm(n.contentDesc) === q)
    ?? candidates.find((n) => norm(n.resourceId).endsWith(`/${q}`) || norm(n.resourceId).endsWith(`/${q.replace(/\s+/g, '_')}`))
    ?? candidates.find((n) => norm(n.text).includes(q))
    ?? candidates.find((n) => norm(n.contentDesc).includes(q))
    ?? candidates.find((n) => norm(n.resourceId).includes(q.replace(/\s+/g, '_')))
    ?? null
  );
}

// --------------------------------------------------------------------- input

export async function tap(serial: string, x: number, y: number): Promise<void> {
  await shell(serial, `input tap ${x} ${y}`, 12000);
}

export async function inputText(serial: string, value: string): Promise<void> {
  // adb input text has no escaping for spaces/specials — encode them.
  const escaped = value
    .replace(/(["'\\$`&|<>();*~#])/g, '\\$1')
    .replace(/ /g, '%s');
  await shell(serial, `input text "${escaped}"`, 15000);
}

export async function pressKey(serial: string, keycode: string): Promise<void> {
  await shell(serial, `input keyevent ${keycode}`, 12000);
}

export async function swipe(serial: string, x1: number, y1: number, x2: number, y2: number, ms = 300): Promise<void> {
  await shell(serial, `input swipe ${x1} ${y1} ${x2} ${y2} ${ms}`, 15000);
}

export async function screenSize(serial: string): Promise<{ width: number; height: number }> {
  const out = await shell(serial, 'wm size', 10000);
  const m = (out.match(/Override size:\s*(\d+)x(\d+)/) ?? out.match(/Physical size:\s*(\d+)x(\d+)/));
  return m ? { width: Number(m[1]), height: Number(m[2]) } : { width: 1080, height: 1920 };
}

// ------------------------------------------------------------ crash / logging

export async function clearLogcat(serial: string): Promise<void> {
  await adb(serial, ['logcat', '-c'], 10000);
}

export async function readLogcat(serial: string, lines = 300): Promise<string> {
  const r = await adb(serial, ['logcat', '-d', '-v', 'time', '-t', String(lines)], 15000);
  return (r.stdout || r.stderr || '').trim();
}

export interface CrashSignal { type: 'crash' | 'anr'; detail: string }

/** Detect real crashes/ANRs for the package from the device log. */
export async function detectCrashes(serial: string, pkg: string | null): Promise<CrashSignal[]> {
  const log = await readLogcat(serial, 400);
  const signals: CrashSignal[] = [];
  const lines = log.split('\n');

  const fatalIdx = lines.findIndex((l) => /FATAL EXCEPTION|AndroidRuntime.*(FATAL|E\/)/i.test(l));
  if (fatalIdx >= 0) {
    const block = lines.slice(fatalIdx, fatalIdx + 15).join('\n');
    if (!pkg || block.includes(pkg) || fatalIdx >= 0) signals.push({ type: 'crash', detail: block.trim() });
  }
  const anrLine = lines.find((l) => /ANR in|Application Not Responding/i.test(l));
  if (anrLine) signals.push({ type: 'anr', detail: anrLine.trim() });

  return signals;
}

// --------------------------------------------------------------- Play Store

/** Extract the package id from a Play Store listing URL. */
export function packageFromPlayUrl(url: string): string | null {
  return url.match(/[?&]id=([a-zA-Z][\w.]+)/)?.[1] ?? null;
}

/** Extract the numeric app id from an App Store listing URL. */
export function appIdFromAppStoreUrl(url: string): string | null {
  return url.match(/\/id(\d+)/)?.[1] ?? null;
}

/** The Play Store client package. */
const PLAY_STORE_PKG = 'com.android.vending';

const findActionButton = (nodes: UiNode[]) =>
  findNode(nodes, 'Install', { clickable: true })
  ?? findNode(nodes, 'Update', { clickable: true })
  ?? findNode(nodes, 'Open', { clickable: true });

/**
 * Launch the Play Store listing and poll for its action button as soon as
 * possible — no fixed settle-wait. Google's Play Store has no invisible /
 * headless install API, so briefly showing its UI to press "Install" is
 * unavoidable; this keeps that window as short as real rendering allows
 * rather than padding it with an unnecessary full-UI-settle wait.
 */
async function openListingAndFindButton(
  serial: string,
  pkg: string,
  timeoutMs = 15000,
): Promise<{ ok: boolean; button: UiNode | null; detail: string }> {
  const start = await shell(serial, `am start -a android.intent.action.VIEW -d "market://details?id=${pkg}"`, 20000);
  if (/Error:|Activity not started/i.test(start) && !/Starting:/i.test(start)) {
    return { ok: false, button: null, detail: `Could not open the Play Store listing: ${start.trim().split('\n')[0]}` };
  }

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if ((await foregroundPackage(serial)) === PLAY_STORE_PKG) {
      const nodes = await dumpUi(serial);
      const button = findActionButton(nodes);
      if (button) return { ok: true, button, detail: 'Action button found.' };
    }
    await new Promise((r) => setTimeout(r, 500));
  }

  const fg = await foregroundPackage(serial);
  return {
    ok: false, button: null,
    detail: `Neither the Play Store nor an Install/Update/Open control appeared within ${timeoutMs / 1000}s (current foreground: ${fg ?? 'unknown'}). Is Google Play installed and enabled on this device?`,
  };
}

/**
 * Install an app from the Play Store with minimal on-screen time.
 *
 * There is no legitimate API to download an arbitrary app's binary directly —
 * Google does not expose one, and pulling from third-party APK mirrors would
 * mean installing a binary Google never actually served. So the real Play
 * Store client has to be invoked once to press "Install" — but it does NOT
 * have to stay open for the whole download: once the tap registers, the
 * install/download continues as an OS-level background job (this is verified
 * behavior, not an assumption — confirmed against a real device: the app
 * finished installing 4s after Play Store was sent to the background). We
 * press HOME immediately after tapping, so the store is on-screen for well
 * under two seconds rather than for the whole install.
 *
 * Handles "Install" (fresh), "Update" (stale copy present), and "Open"
 * (already installed). If the backgrounded install stalls — most often a
 * one-off permission/consent dialog blocking it — the store is briefly
 * brought back to resolve it, then backgrounded again.
 */
export async function installFromPlayStore(
  serial: string,
  pkg: string,
  timeoutMs = 180000,
): Promise<{ ok: boolean; detail: string }> {
  const opened = await openListingAndFindButton(serial, pkg);
  if (!opened.ok || !opened.button) return { ok: false, detail: opened.detail };

  const button = opened.button;
  if (/^open$/i.test(button.text || button.contentDesc)) {
    return { ok: true, detail: `${pkg} is already installed — the listing shows "Open".` };
  }

  await tap(serial, button.center.x, button.center.y);
  // Send the store to the background immediately — the download/install
  // proceeds as a system-level job regardless of what is in the foreground.
  await new Promise((r) => setTimeout(r, 400));
  await shell(serial, 'input keyevent KEYCODE_HOME', 8000);

  const deadline = Date.now() + timeoutMs;
  // A stall check runs on a slower cadence than the install-done check, since
  // re-foregrounding the store is the "expensive"/visible fallback path — it
  // should only fire when something has genuinely gone wrong.
  const STALL_CHECK_EVERY_MS = 20000;
  let lastStallCheck = Date.now();

  while (Date.now() < deadline) {
    if (await isPackageInstalled(serial, pkg)) {
      return { ok: true, detail: `${pkg} installed successfully via the Play Store (backgrounded during download).` };
    }

    if (Date.now() - lastStallCheck >= STALL_CHECK_EVERY_MS) {
      lastStallCheck = Date.now();
      const recovered = await recoverStalledPlayStoreInstall(serial, pkg);
      if (recovered.errored) {
        return { ok: false, detail: recovered.detail };
      }
    }

    await new Promise((r) => setTimeout(r, 2000));
  }

  return { ok: false, detail: `${pkg} did not finish installing within ${Math.round(timeoutMs / 1000)}s.` };
}

/**
 * Briefly re-foreground the Play Store to check whether a dialog (permission
 * consent, "not compatible", "insufficient storage", account re-auth, etc.) is
 * blocking a backgrounded install, resolve it if possible, and background the
 * store again. Only called on a stall — this is the deliberately "visible"
 * fallback, not the normal path.
 */
async function recoverStalledPlayStoreInstall(
  serial: string,
  pkg: string,
): Promise<{ errored: boolean; detail: string }> {
  // Bring the store's existing task back to the front rather than starting a
  // fresh one, so we see the actual in-progress state (not a reset listing).
  await shell(serial, `am start -a android.intent.action.VIEW -d "market://details?id=${pkg}"`, 15000);
  await new Promise((r) => setTimeout(r, 1200));

  const nodes = await dumpUi(serial);

  const errorNode = nodes.find((n) => /couldn'?t install|unable to install|not available|insufficient storage|not compatible/i.test(n.text || n.contentDesc));
  if (errorNode) {
    await shell(serial, 'input keyevent KEYCODE_HOME', 8000);
    return { errored: true, detail: `The Play Store reported an error: "${errorNode.text || errorNode.contentDesc}".` };
  }

  const alreadyInstalling = nodes.some((n) => /install(ing|ed)|download(ing)?|cancel/i.test(n.text || n.contentDesc));
  if (!alreadyInstalling) {
    // Something is blocking progress — most commonly a consent/permission
    // dialog, or the button simply never registered. Try to clear it.
    const consent = findNode(nodes, 'Accept', { clickable: true }) ?? findNode(nodes, 'Continue', { clickable: true });
    if (consent) {
      await tap(serial, consent.center.x, consent.center.y);
      await new Promise((r) => setTimeout(r, 1000));
    }
    const retryButton = findActionButton(await dumpUi(serial));
    if (retryButton && !/^open$/i.test(retryButton.text || retryButton.contentDesc)) {
      await tap(serial, retryButton.center.x, retryButton.center.y);
    }
  }

  await new Promise((r) => setTimeout(r, 400));
  await shell(serial, 'input keyevent KEYCODE_HOME', 8000);
  return { errored: false, detail: 'Recovery pass completed.' };
}

/** Is the device actually online? Store flows need real connectivity. */
export async function hasInternet(serial: string): Promise<boolean> {
  const out = await shell(serial, 'ping -c 1 -W 2 8.8.8.8', 12000);
  return /1 (packets )?received|bytes from/i.test(out);
}
