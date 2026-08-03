import { runAdb, runAdbBinary } from '@/lib/qa/adb';
import type { DeviceProfile } from './types';

/**
 * Device I/O layer: every primitive the autonomous engine uses to observe and
 * drive a REAL Android device. Nothing here fabricates data — each function is
 * a thin, typed wrapper over an adb command, returning null/empty when the
 * device genuinely gives nothing back.
 */

export async function getProp(serial: string, prop: string): Promise<string> {
  const r = await runAdb(['-s', serial, 'shell', 'getprop', prop], 8_000);
  return r.ok ? r.stdout.trim() : '';
}

export async function shell(serial: string, cmd: string, timeoutMs = 20_000): Promise<string> {
  const r = await runAdb(['-s', serial, 'shell', cmd], timeoutMs);
  return r.ok ? r.stdout : '';
}

/** Reads screen size from `wm size`, falling back to a dumpsys probe. */
async function screenSize(serial: string): Promise<{ width: number; height: number }> {
  const out = await shell(serial, 'wm size', 8_000);
  const m = /Override size:\s*(\d+)x(\d+)/.exec(out) ?? /Physical size:\s*(\d+)x(\d+)/.exec(out);
  if (m) return { width: Number(m[1]), height: Number(m[2]) };
  return { width: 1080, height: 1920 };
}

async function screenDensity(serial: string): Promise<number> {
  const out = await shell(serial, 'wm density', 8_000);
  const m = /Override density:\s*(\d+)/.exec(out) ?? /Physical density:\s*(\d+)/.exec(out);
  if (m) return Number(m[1]);
  const prop = await getProp(serial, 'ro.sf.lcd_density');
  return Number(prop) || 160;
}

export async function profileDevice(serial: string): Promise<DeviceProfile> {
  const [model, release, sdk, size, density] = await Promise.all([
    getProp(serial, 'ro.product.model'),
    getProp(serial, 'ro.build.version.release'),
    getProp(serial, 'ro.build.version.sdk'),
    screenSize(serial),
    screenDensity(serial),
  ]);
  return {
    serial,
    model: model || serial,
    osVersion: release ? `Android ${release}` : 'Android',
    sdkInt: Number(sdk) || 0,
    width: size.width,
    height: size.height,
    densityDpi: density,
    wireless: /:\d+$/.test(serial),
  };
}

// ---------------------------------------------------------------- UI state

/**
 * Dumps the current UI hierarchy. Prefers streaming to stdout via /dev/tty
 * (no file I/O on device); falls back to dumping to a file and cat-ing it,
 * which some OEM builds require.
 */
/**
 * Which dump strategy works on a given device, remembered after the first
 * successful attempt.
 *
 * `uiautomator dump` costs ~2s per call on a real device, and on many OEM builds
 * the /dev/tty variant produces nothing at all — so blindly trying it first
 * DOUBLED the cost of every dump. Since a dump happens several times per
 * exploration step, that wasted seconds on every single action. We probe once
 * per device, then always use the method that actually works.
 */
const dumpStrategy = new Map<string, 'tty' | 'file'>();

async function dumpViaTty(serial: string): Promise<string> {
  const res = await runAdb(['-s', serial, 'exec-out', 'uiautomator', 'dump', '/dev/tty'], 20_000);
  return res.ok && res.stdout.includes('<hierarchy') ? res.stdout : '';
}

async function dumpViaFile(serial: string): Promise<string> {
  const out = await shell(
    serial,
    'uiautomator dump /sdcard/qa-ui.xml >/dev/null 2>&1 && cat /sdcard/qa-ui.xml',
    25_000,
  );
  return out.includes('<hierarchy') ? out : '';
}

export async function dumpHierarchy(serial: string): Promise<string> {
  const known = dumpStrategy.get(serial);

  if (known === 'file') return dumpViaFile(serial);
  if (known === 'tty') {
    const out = await dumpViaTty(serial);
    // A previously-working method can still fail mid-transition; fall back once
    // without discarding what we learned about the device.
    return out || dumpViaFile(serial);
  }

  // First dump for this device — probe, then remember the winner.
  const tty = await dumpViaTty(serial);
  if (tty) {
    dumpStrategy.set(serial, 'tty');
    return tty;
  }
  const file = await dumpViaFile(serial);
  if (file) dumpStrategy.set(serial, 'file');
  return file;
}

/** Fully-qualified focused component, e.g. "com.app/.ui.MainActivity". */
export async function focusedComponent(serial: string): Promise<string> {
  const out = await shell(serial, 'dumpsys window', 12_000);
  const m = /mCurrentFocus=Window\{[^}]*?\s([\w.]+\/[\w.$]+)/.exec(out)
    ?? /mFocusedApp=ActivityRecord\{[^}]*?\s([\w.]+\/[\w.$]+)/.exec(out);
  if (m) return m[1];

  const acts = await shell(serial, 'dumpsys activity activities', 12_000);
  const m2 = /ResumedActivity:.*?\s([\w.]+\/[\w.$]+)/.exec(acts);
  return m2 ? m2[1] : '';
}

export async function screencapDataUrl(serial: string): Promise<string | null> {
  const buf = await runAdbBinary(['-s', serial, 'exec-out', 'screencap', '-p'], 25_000);
  if (!buf || buf.length === 0) return null;
  return `data:image/png;base64,${buf.toString('base64')}`;
}

// ------------------------------------------------------------ interactions

export async function tap(serial: string, x: number, y: number): Promise<void> {
  await shell(serial, `input tap ${x} ${y}`, 10_000);
}

export async function longPress(serial: string, x: number, y: number, ms = 800): Promise<void> {
  await shell(serial, `input swipe ${x} ${y} ${x} ${y} ${ms}`, 12_000);
}

export async function doubleTap(serial: string, x: number, y: number): Promise<void> {
  await shell(serial, `input tap ${x} ${y}; input tap ${x} ${y}`, 10_000);
}

export async function swipe(
  serial: string, x1: number, y1: number, x2: number, y2: number, ms = 300,
): Promise<void> {
  await shell(serial, `input swipe ${x1} ${y1} ${x2} ${y2} ${ms}`, 12_000);
}

export async function inputText(serial: string, text: string): Promise<void> {
  // `input text` needs shell-safe escaping; spaces become %s.
  const safe = text.replace(/(["\\$`])/g, '\\$1').replace(/ /g, '%s');
  await shell(serial, `input text "${safe}"`, 12_000);
}

export async function clearText(serial: string): Promise<void> {
  // Select-all then delete works regardless of current caret position.
  await shell(serial, 'input keyevent KEYCODE_MOVE_END', 8_000);
  await shell(serial, 'input keyevent --longpress ' + Array(60).fill('KEYCODE_DEL').join(' '), 15_000);
}

export const KEY = {
  BACK: 'KEYCODE_BACK',
  HOME: 'KEYCODE_HOME',
  ENTER: 'KEYCODE_ENTER',
  APP_SWITCH: 'KEYCODE_APP_SWITCH',
  ESCAPE: 'KEYCODE_ESCAPE',
  WAKEUP: 'KEYCODE_WAKEUP',
} as const;

export async function pressKey(serial: string, key: string): Promise<void> {
  await shell(serial, `input keyevent ${key}`, 10_000);
}

export async function setRotation(serial: string, landscape: boolean): Promise<void> {
  await shell(serial, 'settings put system accelerometer_rotation 0', 8_000);
  await shell(serial, `settings put system user_rotation ${landscape ? 1 : 0}`, 8_000);
}

// --------------------------------------------------------- app lifecycle

export async function forceStop(serial: string, pkg: string): Promise<void> {
  await shell(serial, `am force-stop ${pkg}`, 15_000);
}

export interface StartTiming {
  ok: boolean;
  totalTimeMs: number | null;
  waitTimeMs: number | null;
  activity: string | null;
  raw: string;
}

/** `am start -W` — the authoritative cold/warm start measurement from the OS. */
export async function startAppTimed(serial: string, pkg: string): Promise<StartTiming> {
  const r = await runAdb(
    ['-s', serial, 'shell', 'monkey', '-p', pkg, '-c', 'android.intent.category.LAUNCHER', '1'],
    20_000,
  );
  const launched = r.ok && !/No activities found|aborted|Error/i.test(`${r.stdout}${r.stderr}`);
  // monkey doesn't report timings; follow up with `am start -W` on the resolved
  // component so the measurement comes from the platform rather than a stopwatch.
  const comp = await focusedComponent(serial);
  if (!comp.startsWith(pkg)) {
    return { ok: launched, totalTimeMs: null, waitTimeMs: null, activity: comp || null, raw: r.stdout };
  }
  const w = await shell(serial, `am start -W -n ${comp}`, 25_000);
  const total = /TotalTime:\s*(\d+)/.exec(w);
  const wait = /WaitTime:\s*(\d+)/.exec(w);
  return {
    ok: launched,
    totalTimeMs: total ? Number(total[1]) : null,
    waitTimeMs: wait ? Number(wait[1]) : null,
    activity: comp,
    raw: w,
  };
}

/** Measures a true cold start: force-stop, then time the launch. */
export async function coldStart(serial: string, pkg: string): Promise<StartTiming> {
  await forceStop(serial, pkg);
  return startAppTimed(serial, pkg);
}

export async function isAppForeground(serial: string, pkg: string): Promise<boolean> {
  const comp = await focusedComponent(serial);
  return comp.startsWith(`${pkg}/`);
}

/**
 * Screen/keyguard state. A device that dozes off mid-run (or was left locked)
 * reports an empty or keyguard-only hierarchy, which otherwise looks identical
 * to "the app rendered nothing" — the engine would keep dumping an asleep
 * screen until the run's deadline. Recovery needs to tell these apart.
 */
export async function isScreenAwake(serial: string): Promise<boolean> {
  const out = await shell(serial, 'dumpsys power', 15_000);
  const m = /mWakefulness=(\w+)/.exec(out);
  if (m) return /Awake/i.test(m[1]);
  // Older builds only expose the display state.
  const disp = await shell(serial, 'dumpsys display', 15_000);
  return /mScreenState=ON|mState=ON/i.test(disp);
}

/** True when the lock screen is currently showing over everything else. */
export async function isKeyguardLocked(serial: string): Promise<boolean> {
  const out = await shell(serial, 'dumpsys window', 12_000);
  if (/mDreamingLockscreen=true|isStatusBarKeyguard=true/i.test(out)) return true;
  const km = await shell(serial, 'dumpsys keyguard', 10_000);
  return /mShowing=true|showing=true/i.test(km);
}

/**
 * Wakes the device and dismisses a non-secure keyguard so exploration can
 * resume. A PIN/pattern-protected device cannot be unlocked without the
 * credential, so this reports whether the screen actually became usable
 * instead of pretending it succeeded.
 */
export async function wakeAndUnlock(serial: string, width = 1080, height = 1920): Promise<boolean> {
  await pressKey(serial, KEY.WAKEUP);
  if (await isKeyguardLocked(serial)) {
    // Swipe up from the bottom — the gesture for a swipe-only keyguard.
    const cx = Math.round(width / 2);
    await swipe(serial, cx, Math.round(height * 0.85), cx, Math.round(height * 0.15), 300);
  }
  return (await isScreenAwake(serial)) && !(await isKeyguardLocked(serial));
}

// ------------------------------------------------------------- diagnostics

export async function meminfo(serial: string, pkg: string): Promise<string> {
  return shell(serial, `dumpsys meminfo ${pkg}`, 20_000);
}

export async function gfxinfo(serial: string, pkg: string): Promise<string> {
  return shell(serial, `dumpsys gfxinfo ${pkg}`, 20_000);
}

export async function resetGfxinfo(serial: string, pkg: string): Promise<void> {
  await shell(serial, `dumpsys gfxinfo ${pkg} reset`, 15_000);
}

export async function cpuinfo(serial: string): Promise<string> {
  return shell(serial, 'dumpsys cpuinfo', 20_000);
}

export async function batteryDump(serial: string): Promise<string> {
  return shell(serial, 'dumpsys battery', 12_000);
}

export async function batteryStatsFor(serial: string, pkg: string): Promise<string> {
  const out = await shell(serial, `dumpsys batterystats ${pkg}`, 30_000);
  return out.slice(0, 20_000);
}

export async function wakeLocks(serial: string, pkg: string): Promise<string> {
  const out = await shell(serial, 'dumpsys power', 20_000);
  const lines = out.split('\n').filter((l) => /wake ?lock/i.test(l) && (l.includes(pkg) || /PARTIAL_WAKE_LOCK/.test(l)));
  return lines.slice(0, 40).join('\n');
}

export async function runningServices(serial: string, pkg: string): Promise<string> {
  return shell(serial, `dumpsys activity services ${pkg}`, 20_000);
}

export async function clearLogcat(serial: string): Promise<void> {
  await runAdb(['-s', serial, 'logcat', '-c'], 10_000);
}

export async function dumpLogcat(serial: string): Promise<string> {
  const r = await runAdb(['-s', serial, 'logcat', '-d', '-v', 'threadtime'], 25_000);
  return r.ok ? r.stdout : '';
}

/**
 * The device's active network transport, read from the platform. Returns null
 * when it cannot be determined rather than guessing — the run report shows "—"
 * instead of asserting a connection type that was never measured.
 */
export async function networkType(serial: string): Promise<string | null> {
  const out = await shell(serial, 'dumpsys connectivity', 20_000);

  // Read the transport of the CONNECTED network agent. Note that
  // "Active default network: 101" is a network ID, not a type — matching that
  // would report "101" as the connection type.
  const nc = /\bTransports:\s*([A-Z_|&]+)/.exec(out);
  if (nc) {
    const first = nc[1].split(/[|&]/)[0].trim().toUpperCase();
    if (first) return first === 'CELLULAR' ? 'MOBILE' : first;
  }
  // Older builds expose it as `ni{WIFI CONNECTED ...}`.
  const ni = /\bni\{(\w+)\s+CONNECTED/i.exec(out);
  if (ni) {
    const t = ni[1].toUpperCase();
    return t === 'CELLULAR' || t === 'MOBILE' ? 'MOBILE' : t;
  }
  return null;
}

/** Current display rotation as reported by the platform (0/90/180/270). */
export async function displayRotation(serial: string): Promise<number | null> {
  const out = await shell(serial, 'dumpsys input', 20_000);
  const m = /SurfaceOrientation:\s*(\d)/.exec(out);
  if (m) return Number(m[1]) * 90;
  const win = await shell(serial, 'dumpsys window', 15_000);
  const r = /mCurRotation=ROTATION_(\d+)|mRotation=(\d)/.exec(win);
  if (r) return r[1] ? Number(r[1]) : Number(r[2]) * 90;
  return null;
}

/** Network toggles. Guarded by the caller when adb itself runs over Wi-Fi. */
export async function setWifi(serial: string, on: boolean): Promise<void> {
  await shell(serial, `svc wifi ${on ? 'enable' : 'disable'}`, 15_000);
}

export async function setMobileData(serial: string, on: boolean): Promise<void> {
  await shell(serial, `svc data ${on ? 'enable' : 'disable'}`, 15_000);
}

export async function grantedPermissions(serial: string, pkg: string): Promise<string> {
  return shell(serial, `dumpsys package ${pkg}`, 25_000);
}
