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
import { mkdtemp, readFile, rm, writeFile } from 'fs/promises';
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

/**
 * Commands that change what is on screen. Matched here, at the single choke
 * point every device command passes through, so a cached view hierarchy can
 * never outlive the screen it described — including for callers that build an
 * `input keyevent` batch themselves rather than going through pressKey().
 */
const MUTATING_CMD_RE = /^\s*(?:input\b|monkey\b|am\s+(?:start|force-stop|kill)|pm\s+clear|svc\b|settings\s+put)/;

export async function shell(serial: string, command: string, timeout?: number): Promise<string> {
  if (MUTATING_CMD_RE.test(command)) invalidateUiCache();
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
    // Remove the DIRECTORY, not just the two files inside it. Unlinking only
    // in.png/out.jpg left the mkdtemp dir behind on every single screenshot —
    // one empty dir per captured frame, tens per run, unbounded (133 had
    // accumulated in $TMPDIR here before this was fixed).
    await rm(dir, { recursive: true, force: true }).catch(() => {});
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
 * Is the device still attached and responding to adb?
 *
 * A USB drop mid-run makes every subsequent device read come back empty, which
 * is indistinguishable from "the app left the foreground" unless it is checked
 * explicitly — so a disconnected cable used to be reported as an application
 * defect. This separates a harness problem from a genuine app problem.
 */
export async function deviceOnline(serial: string): Promise<boolean> {
  const out = await shell(serial, 'echo online', 8000);
  return /online/.test(out);
}

/**
 * Stop the screen sleeping for the duration of a run.
 *
 * Long sheets take many minutes, and when the display sleeps the app leaves the
 * foreground — and on some devices adb over USB drops with it — which strands
 * every remaining test case. Best-effort: if the settings write is not permitted
 * the run continues exactly as before.
 */
export async function keepDeviceAwake(serial: string): Promise<{ ok: boolean; detail: string }> {
  try {
    // 7 = stay on while plugged into AC, USB, or wireless.
    await shell(serial, 'settings put global stay_on_while_plugged_in 7', 10000);
    await shell(serial, 'svc power stayon usb', 10000).catch(() => '');
    return { ok: true, detail: 'Device set to stay awake while connected for the duration of the run.' };
  } catch (e) {
    return { ok: false, detail: `Could not stop the device sleeping: ${(e as Error).message.split('\n')[0]}` };
  }
}

/**
 * Wake and unlock the screen. `am start` silently succeeds against a sleeping
 * or locked device while the app never actually reaches the foreground, so this
 * must run before any launch or interaction.
 */
/**
 * Poll a device condition until it holds, instead of sleeping a guessed
 * duration. A fixed sleep is wrong twice over: it idles on a fast device and
 * still races on a slow one. Returns whether the condition became true.
 */
async function waitForCondition(
  check: () => Promise<boolean>,
  opts: { timeoutMs?: number; pollMs?: number } = {},
): Promise<boolean> {
  const timeoutMs = opts.timeoutMs ?? 5000;
  const pollMs = opts.pollMs ?? 200;
  const started = Date.now();
  do {
    if (await check().catch(() => false)) return true;
    await new Promise((r) => setTimeout(r, pollMs));
  } while (Date.now() - started < timeoutMs);
  return false;
}

export async function ensureAwake(serial: string): Promise<{ awake: boolean; locked: boolean; detail: string }> {
  const power = await shell(serial, 'dumpsys power | grep -E "mWakefulness="', 12000);
  const asleep = /mWakefulness=(Asleep|Dozing)/i.test(power);
  if (asleep) {
    await shell(serial, 'input keyevent KEYCODE_WAKEUP', 10000);
    // Poll the wakefulness state the keyevent actually changes, rather than
    // sleeping a guessed 800ms: a fast device is ready in ~100ms and a slow one
    // sometimes needs longer than the guess did.
    await waitForCondition(
      async () => /mWakefulness=Awake/i.test(await shell(serial, 'dumpsys power | grep -E "mWakefulness="', 8000)),
      { timeoutMs: 4000, pollMs: 150 },
    );
  }

  const isLocked = async () => /mDreamingLockscreen=true|isStatusBarKeyguard=true/i.test(
    await shell(serial, 'dumpsys window | grep -E "mDreamingLockscreen|isStatusBarKeyguard"', 12000),
  );

  // Waking is asynchronous: KEYCODE_WAKEUP flips wakefulness to Awake a moment
  // BEFORE the lockscreen finishes presenting. Reading the keyguard state
  // immediately therefore saw "not locked", skipped the unlock swipe entirely,
  // and then the final check found the lockscreen up and reported the device as
  // secured — with nothing having tried to unlock it. Give the keyguard a beat
  // to appear before deciding whether one is there.
  if (asleep) {
    await waitForCondition(isLocked, { timeoutMs: 2000, pollMs: 200 });
  }

  // Dismiss a non-secure keyguard with a swipe up. A PIN/pattern lock cannot be
  // bypassed — that is reported so the user knows to unlock the device.
  //
  // Retried: the first swipe can land while the lockscreen is still animating
  // in and be swallowed, and on some skins it opens the notification shade
  // instead, which then has to be closed before another swipe can reach the
  // keyguard. One attempt made an unlockable device look permanently locked.
  const locked = await isLocked();
  if (locked) {
    const { width, height } = await screenSize(serial);
    for (let attempt = 0; attempt < 3; attempt++) {
      // A pulled-down shade covers the keyguard and eats the swipe.
      if (/NotificationShade/i.test(await shell(serial, 'dumpsys window | grep mCurrentFocus', 8000))) {
        await pressKey(serial, 'KEYCODE_BACK');
      }
      await swipe(serial, Math.round(width / 2), Math.round(height * 0.9), Math.round(width / 2), Math.round(height * 0.1), 250);
      const cleared = await waitForCondition(async () => !(await isLocked()), { timeoutMs: 3000, pollMs: 200 });
      if (cleared) break;
      // A menu key is the other standard way to dismiss a non-secure keyguard.
      await pressKey(serial, 'KEYCODE_MENU');
      if (await waitForCondition(async () => !(await isLocked()), { timeoutMs: 1500, pollMs: 200 })) break;
    }
  }

  const stillLocked = await isLocked();
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

  // Send the SAME intent the home-screen launcher sends: action MAIN, category
  // LAUNCHER. With a bare `am start -n <activity>` the activity can be started
  // as a fresh instance pushed onto the task, which resets the visible screen —
  // so an app merely sitting in the background came back at its first screen and
  // lost the place the sheet had walked it to. The launcher intent resumes the
  // existing task when there is one, and starts the app when there is not, so
  // the same call serves both the initial launch and a warm bring-to-front.
  const startCmd = activity
    ? `am start -W -a android.intent.action.MAIN -c android.intent.category.LAUNCHER -n ${activity}`
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
  /** Container can be scrolled — lets "the screen should be scrollable" be
   *  asserted against the real hierarchy instead of guessed from prose. */
  scrollable: boolean;
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
/**
 * The view hierarchy is the hottest read in the whole engine — an overlay check,
 * the step itself, each settle poll, the expectation assertion and the screen
 * name all want it, several times per step. Two things make that affordable:
 *
 *  - `exec-out uiautomator dump /dev/tty` streams the XML back in ONE adb round
 *    trip instead of three (dump to a file, `cat` it, `rm` it).
 *  - Consecutive reads with no input in between cannot differ, so they are
 *    served from a short-lived cache. Every function that touches the device
 *    (tap, swipe, text, keyevent, launch) drops the cache, so a cached read can
 *    never describe a screen the engine has already changed.
 */
/**
 * Measured on real hardware, a single `uiautomator dump` costs ~2.2s — it is by
 * far the most expensive thing the engine does, and everything else (activity,
 * logcat, screen size) is ~100ms. The TTL therefore has to comfortably exceed
 * one dump, or a cached reading expires before the next caller can ever use it
 * and the cache buys nothing.
 *
 * Correctness does NOT rest on this number: it rests on invalidation, which is
 * driven by input (see MUTATING_CMD_RE). The TTL only bounds how long a reading
 * can survive a change the engine did not cause — an ad appearing on a timer,
 * say — so it is kept to a few seconds rather than minutes.
 */
const UI_CACHE_TTL_MS = 5000;
let uiCache: { serial: string; nodes: UiNode[]; at: number } | null = null;

/** Drop the cached hierarchy — called by anything that can change the screen. */
export function invalidateUiCache(): void {
  uiCache = null;
}

function parseUiXml(xml: string): UiNode[] {
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
      scrollable: attr(frag, 'scrollable') === 'true',
      bounds,
      center: { x: Math.round((bounds.x1 + bounds.x2) / 2), y: Math.round((bounds.y1 + bounds.y2) / 2) },
    });
  }
  return nodes;
}

/**
 * Dump the live view hierarchy. This is what makes real native step execution
 * possible without Appium: every node carries its text, id, and screen bounds,
 * so a step like "Click the Login button" resolves to a genuine tap coordinate.
 *
 * Pass `fresh` when the caller is specifically watching for change (settle
 * polling), so it is never handed the reading it is trying to compare against.
 */
export async function dumpUi(serial: string, opts: { fresh?: boolean } = {}): Promise<UiNode[]> {
  if (!opts.fresh && uiCache && uiCache.serial === serial
      && Date.now() - uiCache.at < UI_CACHE_TTL_MS) {
    return uiCache.nodes;
  }

  // One round trip: uiautomator writes the XML straight to stdout.
  const streamed = await adb(serial, ['exec-out', 'uiautomator', 'dump', '/dev/tty'], 20000);
  let nodes = /<node\b/.test(streamed.stdout) ? parseUiXml(streamed.stdout) : [];

  // Some OEM builds/older uiautomator ignore /dev/tty and only write to a file.
  if (nodes.length === 0) {
    const remote = '/sdcard/qa-ui-dump.xml';
    const dump = await shell(serial, `uiautomator dump ${remote}`, 20000);
    if (/dumped to/i.test(dump)) {
      const xml = await shell(serial, `cat ${remote}`, 20000);
      nodes = parseUiXml(xml);
      await shell(serial, `rm -f ${remote}`, 8000).catch(() => {});
    }
  }

  uiCache = { serial, nodes, at: Date.now() };
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
  // Each poll IS a ~2.2s hierarchy dump, so the dump latency already provides
  // the spacing an explicit sleep used to. Adding a sleep on top only idles.
  const pollMs = opts.pollMs ?? 0;
  // One repeat means two identical readings taken ~2.2s apart — genuinely more
  // settling evidence than the original 2 repeats gave at 600ms polling, and it
  // removes a whole dump (~2.2s) from every single step.
  const stableChecks = opts.stableChecks ?? 1;

  const started = Date.now();
  let lastSig = '';
  let stable = 0;
  let nodes: UiNode[] = [];

  while (Date.now() - started < timeoutMs) {
    // `fresh` is essential, not an optimisation: this loop detects change by
    // comparing successive readings, so a cached repeat would look like the
    // screen had gone stable the instant it was asked.
    nodes = await dumpUi(serial, { fresh: true });
    const sig = uiSignature(nodes);

    // Still loading, judged by the two signals that genuinely mean "not ready":
    //  - a progress indicator is showing AND nothing is interactive yet. The
    //    old test required EVERY node to be a spinner, which a real loading
    //    screen never satisfies (it keeps its toolbar and title), so mid-load
    //    screens were called settled. Requiring only "a spinner exists" is the
    //    opposite mistake: a screen that legitimately keeps an inline spinner
    //    next to real, usable content would then never settle at all. Pairing
    //    it with "nothing to interact with" separates the two cases.
    //  - nothing on screen carries any label at all (a bare render pass).
    const interactive = nodes.some((n) => n.clickable || /EditText|Button/i.test(n.className));
    const spinning = nodes.some((n) => /ProgressBar|Loading|Shimmer|Skeleton/i.test(n.className));
    const busy = nodes.length > 0 && (
      (spinning && !interactive)
      || nodes.every((n) => !n.text && !n.contentDesc)
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
 * Wait only as long as the screen actually takes to react.
 *
 * A fixed sleep after a tap pays the worst case every single time: too long on a
 * fast device, still not long enough on a slow one. This returns the moment the
 * hierarchy differs from `beforeSignature`, so the common case costs one dump
 * instead of a full second of idling — and the timeout still bounds a tap that
 * legitimately changed nothing.
 */
export async function waitForUiChange(
  serial: string,
  beforeSignature: string,
  timeoutMs = 1500,
  // A dump already takes ~2.2s, which is the wait; sleeping on top only idles.
  pollMs = 0,
): Promise<{ changed: boolean; nodes: UiNode[] }> {
  const started = Date.now();
  let nodes = await dumpUi(serial, { fresh: true });
  while (Date.now() - started < timeoutMs) {
    if (uiSignature(nodes) !== beforeSignature) return { changed: true, nodes };
    await new Promise((r) => setTimeout(r, pollMs));
    nodes = await dumpUi(serial, { fresh: true });
  }
  return { changed: uiSignature(nodes) !== beforeSignature, nodes };
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
  // At most ONE relaunch per call. This guard lives outside the loop on
  // purpose: the recovery below used to sit inside it, so an app that keeps
  // self-exiting (an ad SDK tearing down its host Activity, or an OEM
  // background killer) got relaunched on every iteration for the full timeout —
  // which is exactly the "app repeatedly opening and closing" symptom. One
  // attempt distinguishes a recoverable drift from a genuinely dead launch;
  // repeating it just fights the thing that is killing the app.
  let relaunched = false;
  // Ad-escape attempts made while waiting for readiness. Bounded so an ad that
  // reappears on every relaunch cannot drive an endless exit/relaunch cycle.
  const MAX_AD_ESCAPES = 2;
  let adEscapes = 0;

  while (Date.now() - started < timeoutMs) {
    const settle = await waitForUiSettle(serial, { timeoutMs: 6000 });
    const activity = settle.activity;

    // Lost the app entirely — or so it looks. `dumpsys window` can report
    // `mCurrentFocus=null` for a single frame while one Activity/Window is
    // swapping in for another, and `foregroundPackage()` falls back to
    // whatever `mFocusedApp` shows in that instant — occasionally the
    // launcher's own task. Treating that one blip as a crash aborted
    // otherwise-healthy launches, so re-check a few times before believing it.
    let fg = await foregroundPackage(serial);
    if (fg !== pkg) {
      // Budget by elapsed time, not a fixed attempt count — over a wireless
      // ADB link each `foregroundPackage` round trip itself has variable
      // latency, so a small fixed retry count can still run out before the
      // transition has actually finished on a slow link.
      const recheckDeadline = Date.now() + 5000;
      while (fg !== pkg && Date.now() < recheckDeadline) {
        await new Promise((r) => setTimeout(r, 500));
        fg = await foregroundPackage(serial);
      }
      // Confirmed live: this is not always a transient blip — the app can
      // genuinely, durably exit to the home screen mid-startup (an ad SDK
      // tearing down its host Activity, or the OEM's aggressive background
      // killer) and it does NOT recover on its own no matter how long this
      // waits. But a plain re-launch reliably brings it straight back — the
      // same recovery `ensureAppForeground` already relies on when the app
      // drifts away mid-run. Try that once before declaring the launch dead.
      if (fg !== pkg && launchActivity && !relaunched) {
        relaunched = true;
        await shell(serial, `am start -W -n ${launchActivity}`, 30000).catch(() => '');
        const relaunchDeadline = Date.now() + 5000;
        while (fg !== pkg && Date.now() < relaunchDeadline) {
          await new Promise((r) => setTimeout(r, 500));
          fg = await foregroundPackage(serial);
        }
      }
      if (fg !== pkg) {
        return {
          ready: false,
          activity,
          detail: relaunched
            ? `The app left the foreground during startup (now: ${fg ?? 'unknown'}) and did not come back after a relaunch attempt. It may have crashed on launch.`
            : `The app left the foreground during startup (now: ${fg ?? 'unknown'}). It may have crashed on launch.`,
        };
      }
    }

    // The settle above was captured BEFORE the foreground check, so its nodes
    // and activity can describe a screen that is no longer showing — most
    // importantly the launcher, if the app dropped out and then came back
    // during the re-check/relaunch window. Judging readiness on those nodes
    // certified the HOME SCREEN as the app being ready: 32 "interactive
    // elements" that were really the launcher's own icons. Re-settle instead of
    // ruling on a hierarchy that belongs to another package.
    if (activity && !activity.startsWith(pkg)) continue;

    // A full-screen ad has its own close/skip button, which reads as
    // "interactive content" — without this check, "the app is ready" fired
    // the instant an interstitial appeared on launch, so every case behind it
    // ran against the ad instead of the app. Escaping it here defines
    // readiness as the APP's own content, never a third-party ad surface.
    // Checked two ways: a dedicated AdActivity component (activity name), or
    // an ad rendered as an overlay INSIDE the app's own activity — confirmed
    // live that the latter happens on this exact app and leaves the
    // Activity name unchanged, so relying on the name alone missed it.
    if (isAdActivity(activity) || looksLikeAdCreative(settle.nodes)) {
      // Bounded. Escaping an interstitial that sits on the app's LAUNCH screen
      // has nothing behind it to return to, so the back-press exits the app;
      // the loop below then relaunches, the ad is served again, and the cycle
      // repeats — the app visibly opening and closing until this whole function
      // times out and reports the launch dead. Confirmed live on a real app
      // whose AdMob interstitial appears ~9s after a first-run launch.
      adEscapes += 1;
      const escape = await escapeAdSurface(serial, 2, pkg);

      if (!escape.escaped && adEscapes >= MAX_AD_ESCAPES) {
        // Stop fighting it. The app is installed, launched and alive — an ad on
        // the launch screen is an honest condition, not a failed launch. Put the
        // app back if the escape took it away, then declare it ready and let the
        // per-step ad handling deal with the interstitial, which prefers the
        // ad's own labelled close control over a destructive back-press.
        if (launchActivity && (await foregroundPackage(serial)) !== pkg) {
          await shell(serial, `am start -W -a android.intent.action.MAIN -c android.intent.category.LAUNCHER -n ${launchActivity}`, 30000).catch(() => '');
          await new Promise((r) => setTimeout(r, 1500));
        }
        return {
          ready: true,
          activity: await currentActivity(serial),
          detail: `The app launched and is running, with an advertisement on its launch screen. ${escape.detail} Execution will start and each step dismisses the ad using its own close control rather than a back-press.`,
        };
      }
      continue;
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
  // Onboarding carousels and tutorial overlays: the last slide's control is
  // usually one of these rather than "Next".
  'lets go', "let's go", 'start now', 'begin', 'explore', 'try it', 'understood',
];
const GRANT_LABELS = [
  'while using the app', 'only this time', 'allow all the time', 'allow', 'grant', 'turn on',
];
const DISMISS_LABELS = [
  'skip', 'skip for now', 'not now', 'no thanks', 'later', 'maybe later', 'close', 'dismiss', 'cancel', '×', '✕', 'x',
  // Update / "new version available" prompts. These are the app-store nag, not
  // the app under test — taking the update would install a DIFFERENT build than
  // the one the sheet is meant to be validating, so the decline path is the only
  // correct one and it must outrank the ADVANCE list's "ok"/"yes".
  'no, thanks', 'update later', 'remind me later', 'ask me later', 'not right now', 'ignore',
  // Cookie / tracking-consent notices. Declining is both the privacy-preserving
  // choice and the one that leaves the app in its default state, which is what
  // the sheet's later steps were written against.
  'reject all', 'decline all', 'decline', 'reject', 'only necessary', 'necessary only',
  'essential only', 'manage preferences', 'deny',
];

/**
 * Screens that are a gate in front of the app rather than the app itself, keyed
 * by the vocabulary that identifies them. Used only to LABEL what was crossed —
 * the actual forward move is still made by the generic affordance search, so no
 * app-specific flow is encoded here.
 */
const GATE_SCREEN_KINDS: Array<{ kind: string; re: RegExp }> = [
  { kind: 'language selection', re: /\b(?:select|choose|pick)\s+(?:your\s+)?language\b|\blanguage\b.{0,20}\b(?:selection|preference)\b|\bchoose\s+your\s+region\b/i },
  { kind: 'cookie/consent notice', re: /\bcookies?\b|\bwe\s+use\s+cookies\b|\bconsent\b|\bgdpr\b|\bprivacy\s+(?:policy|preferences)\b|\btracking\s+preferences\b/i },
  { kind: 'update prompt', re: /\bupdate\s+(?:available|now|required)\b|\bnew\s+version\b|\bupgrade\s+(?:now|available)\b|\bplease\s+update\b/i },
  { kind: 'onboarding', re: /\bwelcome\b|\bget\s+started\b|\btutorial\b|\bwalkthrough\b|\bswipe\s+to\s+continue\b|\bhow\s+it\s+works\b/i },
  { kind: 'rating prompt', re: /\brate\s+(?:us|this\s+app)\b|\benjoying\s+the\s+app\b|\bleave\s+a\s+review\b/i },
  { kind: 'sign-in wall', re: /\bsign\s+in\s+to\s+continue\b|\blog\s+in\s+to\s+continue\b|\bcreate\s+an\s+account\s+to\b/i },
];

/** Name the kind of gate currently on screen, for an honest execution log. */
export function classifyGateScreen(nodes: UiNode[]): string | null {
  const text = nodes.map((n) => `${n.text} ${n.contentDesc}`).join(' ');
  return GATE_SCREEN_KINDS.find((g) => g.re.test(text))?.kind ?? null;
}

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

  // On a consent or update prompt the "forward" control is the wrong one to
  // take. "Accept all" on a cookie notice opts the session into tracking, and
  // "Update now" leaves the Play Store installing a different build than the
  // one under test — both would be chosen by the default advance-first order,
  // because ADVANCE_LABELS contains "accept" and "ok". Declining is what leaves
  // the app in the default state the sheet's remaining steps were written
  // against, so on exactly these two gates dismissal is tried first.
  const gate = classifyGateScreen(nodes);
  const order = gate === 'cookie/consent notice' || gate === 'update prompt' || gate === 'rating prompt'
    ? (['dismiss', 'advance', 'grant'] as ForwardIntent[])
    : preferred;

  for (const intent of order) {
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
        const beforeCrashTap = uiSignature(nodes);
        await tap(serial, btn.center.x, btn.center.y);
        await waitForUiChange(serial, beforeCrashTap, 2000);
        continue;
      }
    }

    const dialogPkg = await systemDialogPackage(serial);
    if (dialogPkg) {
      const btn = findForwardAffordance(nodes, ['grant', 'advance', 'dismiss']);
      if (btn) {
        handled.push(`permission dialog: tapped "${(btn.node.text || btn.node.contentDesc).trim()}"`);
        const beforePermTap = uiSignature(nodes);
        await tap(serial, btn.node.center.x, btn.node.center.y);
        await waitForUiChange(serial, beforePermTap, 2000);
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
  /**
   * Skip when the test case currently running is itself about ad behaviour —
   * an interstitial must never be auto-dismissed out from under a case whose
   * whole point is to verify it.
   */
  avoidAds = true,
  /**
   * Permit the last-resort force-stop + cold start.
   *
   * DEFAULT FALSE, and that default is the whole point. This helper runs once
   * per test case, and its final rung force-stops the process and cold-starts
   * it. On any app that leaves the foreground by itself — an ad SDK tearing
   * down its Activity, an OEM background killer, a share sheet that owns the
   * window — that rung fired on case after case, so the app visibly closed and
   * reopened throughout the run and every case restarted from the splash
   * screen instead of continuing the session the sheet describes.
   *
   * A warm `am start` re-fronts the existing task and preserves app state,
   * which is what "bring it back to the foreground" means. Killing the process
   * is only correct when the process is already broken, so the engine passes
   * true here exclusively after it has detected a genuine crash/ANR.
   */
  opts: { allowColdRestart?: boolean } = {},
): Promise<{ ok: boolean; recovered: boolean; detail: string; deviceLost?: boolean }> {
  // Distinguish "the cable dropped" from "the app moved". Without this a
  // disconnected device reads as an application defect on every remaining case.
  if (!(await deviceOnline(serial))) {
    return {
      ok: false, recovered: false, deviceLost: true,
      detail: `The device ${serial} is no longer responding to adb — it was disconnected, powered off, or its USB authorisation was revoked mid-run. Reconnect it and start a new run.`,
    };
  }

  const dialogs = await dismissSystemDialogs(serial);

  // A slept screen takes the app out of the foreground; wake first so a sleeping
  // device is not misreported as the app having crashed or drifted.
  await ensureAwake(serial).catch(() => null);

  const fg = await foregroundPackage(serial);
  if (fg === pkg) {
    // The package matches, but a full-screen ad SDK Activity is declared
    // inside the app's OWN package — package equality alone cannot tell an ad
    // apart from real content, which is exactly what let every case behind an
    // interstitial silently run against the ad instead of the app.
    if (avoidAds) {
      if (await adSurfacePresent(serial)) {
        const cleared = await escapeAdSurface(serial, 5, pkg);
        return {
          ok: cleared.escaped, recovered: cleared.escaped,
          detail: `${cleared.detail}${dialogs.handled.length > 0 ? ` ${dialogs.handled.join('; ')}.` : ''}`,
        };
      }
    }
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
    const beforeBack = uiSignature(await dumpUi(serial));
    await pressKey(serial, 'KEYCODE_BACK');
    await waitForUiChange(serial, beforeBack, 1200);
  }

  if ((await foregroundPackage(serial)) === pkg) {
    if (avoidAds && (await adSurfacePresent(serial))) await escapeAdSurface(serial, 5, pkg);
    return { ok: true, recovered: true, detail: `App had drifted to "${fg ?? 'unknown'}"; backed out of it and returned to the app.` };
  }

  const relaunch = await launchApp(serial, pkg, 20000);
  if ((await foregroundPackage(serial)) === pkg) {
    if (avoidAds && (await adSurfacePresent(serial))) await escapeAdSurface(serial, 5, pkg);
    return {
      ok: true, recovered: true,
      detail: `App had drifted to "${fg ?? 'unknown'}" and was brought back to the foreground.${dialogs.crashed ? ' A crash/ANR dialog was cleared first.' : ''}`,
    };
  }

  // A warm relaunch could not re-front the app. The only rung left is a cold
  // start, which force-stops the process first — so it is gated: see the
  // `allowColdRestart` docs above for why doing this per-case is exactly the
  // open/close thrashing this engine must not produce.
  if (!opts.allowColdRestart) {
    const stillFg = await foregroundPackage(serial);
    return {
      ok: false,
      recovered: false,
      detail: `App is not in the foreground (currently "${stillFg ?? 'unknown'}") and a warm relaunch did not restore it (${relaunch.message}). The process was deliberately NOT force-stopped: restarting it would discard the session under test. A cold restart is only performed after a genuine crash is detected.`,
    };
  }

  // Cold start. A warm relaunch reuses the existing task, which stays broken if
  // that task is what drifted (or was backed out of entirely); force-stopping
  // first guarantees a clean process.
  await stopApp(serial, pkg).catch(() => {});
  // Wait for the process to actually be gone rather than guessing 800ms —
  // relaunching while it is still dying reuses the very task we force-stopped.
  await waitForCondition(
    async () => !(await shell(serial, `pidof ${pkg}`, 8000)).trim(),
    { timeoutMs: 4000, pollMs: 150 },
  );
  const cold = await launchApp(serial, pkg, 25000);
  const nowFg = await foregroundPackage(serial);
  const ok = nowFg === pkg;
  return {
    ok,
    recovered: ok,
    detail: ok
      ? `App had drifted to "${fg ?? 'unknown'}" and was restored with a cold restart.${dialogs.crashed ? ' A crash/ANR dialog was cleared first.' : ''}`
      : `App is not in the foreground (currently "${nowFg ?? 'unknown'}") and could not be restored after a warm relaunch (${relaunch.message}) or a cold restart (${cold.message}).`,
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
    const before = uiSignature(nodes);
    await tap(serial, target.center.x, target.center.y);
    // Continue as soon as the overlay is actually gone rather than always
    // paying a fixed pause — this runs before every step, so it is on the
    // hottest path in the engine.
    await waitForUiChange(serial, before, 1500);
    handled.push(`dismissed overlay ("${label}")`);
  }

  return { handled };
}

/**
 * Labels that are a screen's own way forward, so they must never be mistaken
 * for one of the *choices* on a selection gate.
 */
const GATE_CONTROL_LABELS = new Set([
  ...ADVANCE_LABELS, ...GRANT_LABELS, ...DISMISS_LABELS,
]);

/**
 * Resource ids belonging to embedded advertising. Delimiter-anchored so ordinary
 * words that merely contain "ad" ("download", "header", "loading") are not
 * caught. Ad views sit inside the app's own screens and are fully clickable —
 * tapping one opens the Play Store or a browser and takes the run out of the app
 * under test entirely, so they are excluded from every automatic interaction.
 */
const AD_ID_RE = /(?:^|[_.\/])ads?(?:[_.]|$)|native_?ad|ad_?view|ad_?container|advert/i;

function isAdNode(nodes: UiNode[], node: UiNode): boolean {
  if (AD_ID_RE.test(node.resourceId)) return true;
  return nodes.some((o) => o !== node && AD_ID_RE.test(o.resourceId) && containsNode(o, node));
}

/**
 * A confirm/next control that carries no text, no accessibility label and no
 * resource id — just an icon. These are common on first-run gates (a tick or
 * arrow in the header's trailing corner) and are invisible to label- and
 * id-based matching, which is what left a language picker impassable.
 *
 * Identified by position and shape only: a small, isolated clickable icon in the
 * header's trailing corner, or a wide control in the bottom action bar. Ads are
 * excluded, and a screen must have real content for this to apply.
 */
function findIconAffordance(
  nodes: UiNode[],
  screen: { width: number; height: number },
): UiNode | null {
  if (screen.width <= 0 || screen.height <= 0) return null;

  const scrollers = nodes.filter((n) => n.scrollable);
  const candidates = nodes.filter((n) => {
    if (!n.clickable || !n.enabled) return false;
    if ((n.text || n.contentDesc).trim().length > 0) return false;
    if (isAdNode(nodes, n)) return false;
    // An unlabelled icon inside a scrolling list is part of a row (a radio, a
    // thumbnail), never the screen's confirm action.
    if (scrollers.some((s) => s !== n && containsNode(s, n))) return false;
    const w = n.bounds.x2 - n.bounds.x1;
    const h = n.bounds.y2 - n.bounds.y1;
    if (w <= 0 || h <= 0) return false;
    // A full-screen clickable overlay is not a button.
    if (w >= screen.width * 0.98 && h >= screen.height * 0.5) return false;
    return true;
  });
  if (candidates.length === 0) return null;

  const topBand = screen.height * 0.18;
  const bottomBand = screen.height * 0.82;

  // Trailing corner of the header — where "Done"/"Next" lives on a gate screen.
  const headerTrailing = candidates
    .filter((n) => n.bounds.y1 <= topBand && n.center.x >= screen.width * 0.6)
    .sort((a, b) => b.center.x - a.center.x)[0];
  if (headerTrailing) return headerTrailing;

  // Otherwise a control in the bottom action bar.
  const bottomBar = candidates
    .filter((n) => n.bounds.y1 >= bottomBand && (n.bounds.x2 - n.bounds.x1) >= screen.width * 0.4)
    .sort((a, b) => b.bounds.y1 - a.bounds.y1)[0];
  return bottomBar ?? null;
}

/**
 * Pick a plausible selectable choice on a gate screen (a language, theme, or
 * plan picker). Identified structurally — a clickable, labelled item that lives
 * in a scrollable container or sits among several similar siblings — never by
 * matching a specific app's option names.
 */
export function findSelectableChoice(nodes: UiNode[]): UiNode | null {
  const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');
  const scrollers = nodes.filter((n) => n.scrollable);

  const candidates = nodes.filter((n) => {
    if (!n.clickable || !n.enabled) return false;
    const label = (n.text || n.contentDesc).trim();
    if (label.length < 2) return false;
    // Never treat the screen's forward/dismiss control as a choice.
    if (GATE_CONTROL_LABELS.has(norm(label))) return false;
    // An embedded ad's headline and call-to-action are clickable and labelled,
    // so they look exactly like options — tapping one leaves the app.
    if (isAdNode(nodes, n)) return false;
    const area = nodeArea(n);
    if (area <= 0) return false;
    return true;
  });

  // Prefer choices inside a scrollable list — the classic picker shape.
  const inScroller = candidates.filter((c) => scrollers.some((s) => containsNode(s, c)));
  const pool = inScroller.length >= 2 ? inScroller : candidates;
  // Several comparable siblings is what distinguishes a list of options from a
  // lone action button, so require more than one before treating these as choices.
  if (pool.length < 2) return null;

  // Topmost option: on a picker the first row is the safest, most predictable
  // choice, and matches what a tester reaching for "select any option" does.
  return pool.slice().sort((a, b) => a.bounds.y1 - b.bounds.y1)[0] ?? null;
}

/**
 * Move the app forward off an intermediate "gate" screen — a language picker,
 * onboarding slide, consent notice, or permission prompt — that the sheet's
 * current step never mentions but which blocks every element lookup behind it.
 *
 * Entirely structural: it reads the live hierarchy for a forward affordance,
 * and when that control is gated behind making a selection it picks an option
 * first. No app-specific screen names, ids, or flow order are encoded, so this
 * works on a screen the engine has never seen. Only ever called as a recovery
 * step after the step's own target could not be found, so it cannot race the
 * sheet's intended interaction.
 */
export async function advancePastGateScreen(
  serial: string,
  pkg: string | null,
): Promise<{ advanced: boolean; detail: string }> {
  const nodes = await dumpUi(serial);
  if (nodes.length === 0) return { advanced: false, detail: 'The screen exposed no view hierarchy to work with.' };

  const before = uiSignature(nodes);
  const beforeActivity = await currentActivity(serial);
  const screen = await screenSize(serial).catch(() => ({ width: 0, height: 0 }));
  const actions: string[] = [];

  const iconForward = (ns: UiNode[]) => {
    const icon = findIconAffordance(ns, screen);
    return icon ? { node: icon, intent: 'advance' as ForwardIntent } : null;
  };

  // An explicitly labelled control is the least ambiguous way forward.
  let forward = findForwardAffordance(nodes, ['advance', 'grant', 'dismiss']);

  // Otherwise behave like a tester on a picker: choose an option, then confirm.
  // Selecting first matters — a confirm control is often inert or absent until
  // a choice has been made.
  if (!forward) {
    const choice = findSelectableChoice(nodes);
    if (choice) {
      const label = (choice.text || choice.contentDesc).trim();
      await tap(serial, choice.center.x, choice.center.y);
      // Selecting an option usually enables or reveals the confirm control;
      // wait for that to actually happen instead of guessing a duration.
      await waitForUiChange(serial, before, 1500);
      actions.push(`selected the option "${label}"`);
      const after = await dumpUi(serial);
      forward = findForwardAffordance(after, ['advance', 'grant', 'dismiss']) ?? iconForward(after);
      // Choosing an option can itself advance the screen (single-tap pickers).
      if (!forward && uiSignature(after) !== before) {
        return { advanced: true, detail: `Advanced past an intermediate screen: ${actions.join(', then ')}.` };
      }
    }
  }

  // Last resort: an unlabelled confirm icon on a screen with no options to pick.
  if (!forward) forward = iconForward(nodes);

  if (!forward) {
    return {
      advanced: false,
      detail: actions.length > 0
        ? `Tried to advance (${actions.join(', then ')}) but no control was available to continue.`
        : 'No forward control or selectable option was available to move past this screen.',
    };
  }

  const label = (forward.node.text || forward.node.contentDesc).trim() || forward.intent;
  await tap(serial, forward.node.center.x, forward.node.center.y);
  const settled = await waitForUiSettle(serial, { timeoutMs: 12000 });
  actions.push(`tapped "${label}" (${forward.intent})`);

  const moved = settled.signature !== before || settled.activity !== beforeActivity;
  if (!moved) {
    return { advanced: false, detail: `Tried to advance (${actions.join(', then ')}) but the screen did not change.` };
  }

  // Landing on a different app means we advanced out of the app under test,
  // which is worse than being stuck — report it rather than calling it progress.
  if (pkg) {
    const fg = await foregroundPackage(serial);
    if (fg !== pkg) {
      return { advanced: false, detail: `Advancing (${actions.join(', then ')}) left the app under test and landed on "${fg ?? 'unknown'}".` };
    }
  }

  return { advanced: true, detail: `Advanced past an intermediate screen: ${actions.join(', then ')}.` };
}

/**
 * Class-name conventions of the Activity a third-party ad SDK uses to render a
 * full-screen interstitial. These are generic ad-network SDK internals used
 * across thousands of unrelated apps (not this app's own code), which is why
 * matching on them is not "hardcoding an app's flow" — it is exactly the same
 * kind of vocabulary-based detection used for permission dialogs.
 *
 * This exists because such an Activity is declared inside the HOST APP'S OWN
 * package (that is how the Google/Meta/etc. ad SDKs integrate), so it passes a
 * plain foregroundPackage() === pkg check even though it is not the app's real
 * content — an ad was silently treated as "the current screen" and every
 * lookup against it failed for the wrong reason.
 */
const AD_ACTIVITY_RE = /\b(?:ads?\.AdActivity|com\.google\.android\.gms\.ads|com\.unity3d\.services\.ads|com\.applovin\.(?:mediation|sdk)|com\.ironsource\.(?:mediationsdk|sdk)|com\.vungle|com\.chartboost|com\.mbridge|com\.adcolony|com\.inmobi\.ads|com\.startapp|com\.facebook\.ads|com\.mopub|com\.tapjoy|com\.pubmatic|com\.smaato|com\.fyber)\b/i;

/** Is the given Activity a third-party ad SDK's own rendering surface? */
export function isAdActivity(activity: string | null): boolean {
  return !!activity && AD_ACTIVITY_RE.test(activity);
}

/**
 * Ad-vendor branding and creative artifacts, for the case an interstitial is
 * rendered as an overlay INSIDE the app's own Activity rather than a separate
 * AdActivity component — confirmed live: a real interstitial covered the
 * screen while `mCurrentFocus` never left the app's own MainActivity, so
 * `isAdActivity()` never fired and a genuine tap on the real UI underneath
 * silently hit the ad instead. This is generic ad-industry vocabulary (test-ad
 * labelling, ad-network branding, a raw tracking-URL left visible when a
 * creative fails to render) — not anything specific to one app.
 */
const AD_CONTENT_RE = /\btest\s*ad\b|\bgoogle\s*ad(?:mob|s)\b|\bad\s*choices\b|%3F\w+%3D[\w%.-]*|^https?:\/\/\S|\bgclid\b|\butm_source\b|\binterstitial\b/i;

/** Does the live screen show ad-vendor branding or creative artifacts? */
function looksLikeAdCreative(nodes: UiNode[]): boolean {
  return nodes.some((n) => AD_CONTENT_RE.test(`${n.text} ${n.contentDesc}`));
}

async function adSurfacePresent(serial: string): Promise<boolean> {
  const [activity, nodes] = await Promise.all([currentActivity(serial), dumpUi(serial)]);
  return isAdActivity(activity) || looksLikeAdCreative(nodes);
}

/**
 * Get a full-screen interstitial off the screen and confirm the app's own
 * activity is back in front, without ever tapping the ad's own creative.
 *
 * Bounded and patient: many ad SDKs only reveal their close/skip control after
 * a few seconds, so this retries a few times with a real pause rather than
 * giving up after one look — but it is only ever invoked when an ad surface
 * was genuinely detected, so it costs nothing on the (overwhelmingly common)
 * steps where no ad is showing.
 */
export async function escapeAdSurface(
  serial: string,
  maxAttempts = 5,
  /**
   * The app under test. When given, BACK-presses are checked for collateral
   * damage: an interstitial hosted on the app's own splash has nothing behind it
   * yet, so BACK dismisses the ad by killing the APP. Without this the helper
   * then found no ad on the launcher and cheerfully reported "Advertisement
   * cleared", while the app it was protecting was gone — and the caller
   * relaunched, drew another interstitial, pressed BACK again. That is a large
   * part of why the app appeared to open and close over and over.
   */
  pkg?: string,
): Promise<{ escaped: boolean; detail: string }> {
  let sawAd = false;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (!(await adSurfacePresent(serial))) {
      // No ad — but "no ad" is also what the launcher looks like. Only call it
      // cleared if the app under test is what is actually on screen.
      if (pkg && (await foregroundPackage(serial)) !== pkg) {
        return {
          escaped: false,
          detail: `The advertisement is gone, but so is the app: dismissing it left "${pkg}" out of the foreground. The interstitial was most likely hosted on the app's own launch screen, where a back-press exits the app instead of closing the ad.`,
        };
      }
      return {
        escaped: true,
        detail: sawAd ? `Advertisement cleared after ${attempt} dismissal attempt(s).` : 'No advertisement was blocking the screen.',
      };
    }
    sawAd = true;
    const dismissed = await dismissBlockingOverlay(serial, 1);
    if (dismissed.handled.length === 0) {
      // No labelled close/skip control (often true — an interstitial's own X
      // icon is frequently invisible to the accessibility tree even though it
      // is visibly on screen). Back out rather than tap anywhere on the ad's
      // own creative — BACK genuinely dismisses an interstitial that is layered
      // over a running app.
      await pressKey(serial, 'KEYCODE_BACK');
      // ...but stop immediately if that BACK took the app with it. Pressing it
      // again would only keep exiting whatever the caller relaunches.
      if (pkg && (await foregroundPackage(serial)) !== pkg) {
        return {
          escaped: false,
          detail: `Backing out of the advertisement exited the app itself ("${pkg}" is no longer in the foreground), so no further back-presses were attempted. This interstitial is shown on the app's launch screen, which has nothing behind it to return to.`,
        };
      }
    }
    await new Promise((r) => setTimeout(r, 1200));
  }
  const stillAd = await adSurfacePresent(serial);
  return {
    escaped: !stillAd,
    detail: stillAd
      ? `An advertisement is still on screen after ${maxAttempts} dismissal attempts.`
      : `Advertisement cleared after ${maxAttempts} dismissal attempt(s).`,
  };
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

/**
 * Wait for the control a step names to actually appear, instead of demanding it
 * already be there.
 *
 * Element lookup used to be one-shot: dump the hierarchy once, and if the label
 * was not in it, fail the step with "no on-screen element matching". That turns
 * ordinary lateness — a list still binding, a dialog still animating in, a
 * fragment committed a frame after the settle returned — into a reported defect,
 * which is exactly the false failure a human tester would never file. They would
 * look again for a moment before concluding the control is missing.
 *
 * Returns as soon as the element resolves, so the common case (already present)
 * costs a single dump and no extra delay. Only genuinely absent controls pay the
 * full timeout, and those are the ones that deserve to fail.
 */
export async function waitForElement(
  serial: string,
  label: string,
  opts: { editable?: boolean; clickable?: boolean; timeoutMs?: number } = {},
): Promise<{ node: UiNode | null; nodes: UiNode[]; waitedMs: number }> {
  const timeoutMs = opts.timeoutMs ?? 6000;
  const started = Date.now();

  // First look uses the cache: the caller has usually just settled the screen,
  // so re-dumping immediately would pay ~2.2s to learn nothing new.
  let nodes = await dumpUi(serial);
  let node = findNode(nodes, label, opts);

  // Each retry IS a fresh ~2.2s dump, so the dump latency provides the spacing;
  // an added sleep would only idle.
  while (!node && Date.now() - started < timeoutMs) {
    // An interstitial can appear AFTER the caller's pre-step ad escape, part way
    // through this wait. Sitting out the full timeout against an ad wastes the
    // budget and then reports the ad's own creative as "the visible elements",
    // which reads as an app defect. Bail out immediately so the caller's
    // ad-escape-and-retry path runs while the wait budget is still useful.
    if (looksLikeAdCreative(nodes)) break;
    nodes = await dumpUi(serial, { fresh: true });
    node = findNode(nodes, label, opts);
  }

  return { node, nodes, waitedMs: Date.now() - started };
}

/**
 * Does this screen expose no readable content at all?
 *
 * Everything here resolves elements from the accessibility tree. A surface drawn
 * straight to a canvas (a game, some Flutter/Unity builds, a video player) can
 * be fully populated visually while exposing nothing to uiautomator. Reporting
 * that as "the element is missing" blames the app for a harness limitation, so
 * callers use this to say plainly that the screen is unreadable instead.
 */
export function isTreeUnreadable(nodes: UiNode[]): boolean {
  return nodes.length === 0 || nodes.every((n) => !n.text && !n.contentDesc && !n.resourceId);
}

// --------------------------------------------------------------------- input

// Every input below changes what is on screen, so each drops the cached
// hierarchy. That invariant is what makes caching reads safe.

export async function tap(serial: string, x: number, y: number): Promise<void> {
  invalidateUiCache();
  await shell(serial, `input tap ${x} ${y}`, 12000);
}

export async function inputText(serial: string, value: string): Promise<void> {
  invalidateUiCache();
  // adb input text has no escaping for spaces/specials — encode them.
  const escaped = value
    .replace(/(["'\\$`&|<>();*~#])/g, '\\$1')
    .replace(/ /g, '%s');
  await shell(serial, `input text "${escaped}"`, 15000);
}

export async function pressKey(serial: string, keycode: string): Promise<void> {
  invalidateUiCache();
  await shell(serial, `input keyevent ${keycode}`, 12000);
}

export async function swipe(serial: string, x1: number, y1: number, x2: number, y2: number, ms = 300): Promise<void> {
  invalidateUiCache();
  await shell(serial, `input swipe ${x1} ${y1} ${x2} ${y2} ${ms}`, 15000);
}

/**
 * Physical screen size. Fixed for the life of a run, so it is read once per
 * device rather than on every gesture and gate check.
 */
const screenSizeCache = new Map<string, { width: number; height: number }>();

export async function screenSize(serial: string): Promise<{ width: number; height: number }> {
  const hit = screenSizeCache.get(serial);
  if (hit) return hit;
  const out = await shell(serial, 'wm size', 10000);
  const m = (out.match(/Override size:\s*(\d+)x(\d+)/) ?? out.match(/Physical size:\s*(\d+)x(\d+)/));
  const size = m ? { width: Number(m[1]), height: Number(m[2]) } : { width: 1080, height: 1920 };
  // Only remember a genuine reading, so a transient adb failure is not cached.
  if (m) screenSizeCache.set(serial, size);
  return size;
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
    // Attribute the crash to the app under test only when its package actually
    // appears in the trace. The previous condition ended in `|| fatalIdx >= 0`,
    // which is unconditionally true inside this branch — so the `pkg` filter
    // never filtered anything and any unrelated process dying (a system
    // service, another app, the launcher) was reported as this app's crash.
    // That matters more now: a crash is what authorises a cold restart, so a
    // foreign crash would restart a perfectly healthy app under test.
    if (!pkg || block.includes(pkg)) signals.push({ type: 'crash', detail: block.trim() });
  }
  // Same attribution rule for ANRs: "ANR in com.other.app" is not our defect.
  const anrLine = lines.find((l) => /ANR in|Application Not Responding/i.test(l)
    && (!pkg || l.includes(pkg)));
  if (anrLine) signals.push({ type: 'anr', detail: anrLine.trim() });

  return signals;
}

/**
 * Stable identity for a crash signal, so the same crash is not acted on twice.
 *
 * `detectCrashes` reads a trailing window of the log and never clears it, so one
 * FATAL EXCEPTION keeps reappearing on every subsequent call for the rest of the
 * run. Anything that *reacts* to a crash — restarting the app, failing a step,
 * filing a bug — therefore has to remember which signals it has already seen, or
 * a single crash restarts the app on every step from then on.
 *
 * Keyed on the exception's own first lines rather than the whole block, because
 * the block's trailing context shifts as new log lines arrive.
 */
export function crashSignature(signal: CrashSignal): string {
  const head = signal.detail
    .split('\n')
    .slice(0, 3)
    // Timestamps and pids differ between reads of the same crash.
    .map((l) => l.replace(/^\s*\d[\d\-:. ]*/, '').replace(/\b\d{2,}\b/g, '#').trim())
    .join(' | ');
  return `${signal.type}:${head}`;
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
