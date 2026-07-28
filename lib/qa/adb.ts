import { execFile } from 'child_process';
import type { QaDeviceInfo } from '@/lib/types';

/**
 * Thin wrapper around the Android Debug Bridge (adb) CLI. Every real-device
 * capability in the QA workspace — listing connected phones, wireless
 * connect/pair, installing/launching an APK, capturing real screenshots, and
 * reading logcat for crashes — flows through here. The binary path is taken
 * from the ADB_PATH env var, falling back to `adb` on PATH.
 */
const ADB = process.env.ADB_PATH || 'adb';

interface AdbResult {
  ok: boolean;
  stdout: string;
  stderr: string;
}

/** Run adb with text output. Never throws — failures come back as { ok:false }. */
export function runAdb(args: string[], timeoutMs = 30_000): Promise<AdbResult> {
  return new Promise((resolve) => {
    execFile(ADB, args, { timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) => {
      resolve({ ok: !err, stdout: String(stdout ?? ''), stderr: String(stderr ?? err?.message ?? '') });
    });
  });
}

/** Run adb and return raw binary stdout (used for `exec-out screencap -p`). */
export function runAdbBinary(args: string[], timeoutMs = 30_000): Promise<Buffer | null> {
  return new Promise((resolve) => {
    execFile(ADB, args, { timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024, encoding: 'buffer' }, (err, stdout) => {
      if (err) return resolve(null);
      resolve(stdout as unknown as Buffer);
    });
  });
}

/** True if the adb binary is present and responds to `adb version`. */
export async function adbAvailable(): Promise<boolean> {
  const res = await runAdb(['version'], 5_000);
  return res.ok;
}

async function getProp(serial: string, prop: string): Promise<string | null> {
  const res = await runAdb(['-s', serial, 'shell', 'getprop', prop], 8_000);
  const v = res.stdout.trim();
  return res.ok && v ? v : null;
}

async function getBattery(serial: string): Promise<number | null> {
  const res = await runAdb(['-s', serial, 'shell', 'dumpsys', 'battery'], 8_000);
  if (!res.ok) return null;
  const m = res.stdout.match(/level:\s*(\d+)/);
  return m ? Number(m[1]) : null;
}

/**
 * Parses `adb devices -l` into structured device info, enriching each online
 * device with model, Android version, and battery via getprop/dumpsys.
 */
export async function listDevices(): Promise<QaDeviceInfo[]> {
  const res = await runAdb(['devices', '-l'], 10_000);
  if (!res.ok) return [];

  const lines = res.stdout.split('\n').slice(1).map((l) => l.trim()).filter(Boolean);
  const devices: QaDeviceInfo[] = [];

  for (const line of lines) {
    if (line.startsWith('*') || line.startsWith('List of')) continue;
    const parts = line.split(/\s+/);
    const serial = parts[0];
    const state = parts[1]; // device | offline | unauthorized
    if (!serial) continue;

    const isEmulator = serial.startsWith('emulator-');
    const isWireless = /:\d+$/.test(serial); // host:port form
    const online = state === 'device';

    let model: string | null = null;
    let osVersion: string | null = null;
    let battery: number | null = null;
    if (online) {
      [model, osVersion, battery] = await Promise.all([
        getProp(serial, 'ro.product.model'),
        getProp(serial, 'ro.build.version.release'),
        getBattery(serial),
      ]);
    }

    const label = model ?? serial;
    devices.push({
      id: serial,
      name: isWireless ? `${label} (Wi-Fi)` : label,
      type: isEmulator ? 'emulator_android' : 'real_android',
      osVersion: osVersion ? `Android ${osVersion}` : (state === 'unauthorized' ? 'Unauthorized — allow USB debugging on device' : '—'),
      status: online ? 'online' : 'offline',
      battery,
      isStub: false,
    });
  }

  return devices;
}

/** Returns the first online real/emulator Android device, or null. */
export async function firstOnlineDevice(): Promise<QaDeviceInfo | null> {
  const devices = await listDevices();
  return devices.find((d) => d.status === 'online') ?? null;
}

/** `adb connect host:port` for a device already in wireless-debugging mode. */
export async function connectWireless(host: string, port: number): Promise<{ ok: boolean; message: string }> {
  const res = await runAdb(['connect', `${host}:${port}`], 15_000);
  const out = `${res.stdout} ${res.stderr}`.trim();
  // adb prints "connected to ..." / "already connected ..." on success, and
  // "failed to connect ..." / "cannot connect ..." on failure — exit code
  // alone is unreliable, so classify on the message.
  const ok = /connected to|already connected/i.test(out) && !/failed|cannot|unable/i.test(out);
  return { ok, message: out || (ok ? 'Connected.' : 'Could not connect.') };
}

/** `adb pair host:port code` — the Android 11+ Wi-Fi pairing flow. */
export async function pairWireless(host: string, port: number, code: string): Promise<{ ok: boolean; message: string }> {
  const res = await runAdb(['pair', `${host}:${port}`, code], 20_000);
  const out = `${res.stdout} ${res.stderr}`.trim();
  const ok = /successfully paired/i.test(out);
  return { ok, message: out || (ok ? 'Paired.' : 'Pairing failed.') };
}

/** `adb disconnect host:port`. */
export async function disconnectWireless(target: string): Promise<{ ok: boolean; message: string }> {
  const res = await runAdb(['disconnect', target], 10_000);
  const out = `${res.stdout} ${res.stderr}`.trim();
  return { ok: res.ok, message: out };
}

/** Installs (reinstalling, granting runtime perms) an APK onto a device. */
export async function installApk(serial: string, apkPath: string): Promise<{ ok: boolean; message: string }> {
  // -r reinstall keeping data, -g grant all runtime permissions, -t allow test packages.
  const res = await runAdb(['-s', serial, 'install', '-r', '-g', '-t', apkPath], 300_000);
  const out = `${res.stdout} ${res.stderr}`.trim();
  const ok = /success/i.test(out);
  return { ok, message: out };
}

export interface InstalledApp {
  packageName: string;
  versionName: string | null;
  versionCode: string | null;
}

/**
 * Lists the third-party (user-installed) apps on a connected device so a run
 * can target an app that is ALREADY on the phone instead of uploading an APK.
 *
 * `-3` excludes system packages, which keeps the list to apps a person would
 * actually want to test. Versions are read per package from `dumpsys`; that is
 * a handful of fast shell calls, and any package whose dump fails is still
 * listed (without a version) rather than dropped.
 *
 * Human-readable labels and icons are deliberately NOT resolved here: the only
 * way to get them is to pull the APK off the device, which is hundreds of MB
 * and ~10s per app. The package name plus version is what identifies an app
 * unambiguously for QA anyway.
 */
export async function listInstalledApps(serial: string): Promise<InstalledApp[]> {
  const res = await runAdb(['-s', serial, 'shell', 'pm', 'list', 'packages', '-3'], 30_000);
  if (!res.ok) return [];

  const packages = res.stdout
    .split('\n')
    .map((l) => l.replace(/^package:/, '').trim())
    .filter((l) => l.length > 0 && /^[A-Za-z][\w.]*$/.test(l))
    .sort((a, b) => a.localeCompare(b));

  // Resolve versions with bounded concurrency so a 50-app device stays snappy.
  const out: InstalledApp[] = [];
  const BATCH = 8;
  for (let i = 0; i < packages.length; i += BATCH) {
    const slice = packages.slice(i, i + BATCH);
    const dumps = await Promise.all(
      slice.map((pkg) =>
        runAdb(['-s', serial, 'shell', 'dumpsys', 'package', pkg], 15_000)
          .then((r) => (r.ok ? r.stdout : ''))
          .catch(() => '')),
    );
    slice.forEach((packageName, idx) => {
      const dump = dumps[idx] ?? '';
      out.push({
        packageName,
        versionName: /versionName=(\S+)/.exec(dump)?.[1] ?? null,
        versionCode: /versionCode=(\d+)/.exec(dump)?.[1] ?? null,
      });
    });
  }
  return out;
}

/** True when the package is currently installed on the device. */
export async function isPackageInstalled(serial: string, packageName: string): Promise<boolean> {
  const res = await runAdb(['-s', serial, 'shell', 'pm', 'path', packageName], 15_000);
  return res.ok && /package:/.test(res.stdout);
}

/**
 * Wipes the app's data so an ALREADY-INSTALLED app starts from a clean slate:
 * no cached session, no completed onboarding, no prior state. Without this a
 * re-run of an installed app skips login/onboarding entirely and tests a
 * completely different (already-signed-in) app than a first-time user sees.
 *
 * `pm clear` also revokes runtime permissions, so the engine re-exercises the
 * real permission flows on every run.
 */
export async function clearAppData(serial: string, packageName: string): Promise<{ ok: boolean; message: string }> {
  const res = await runAdb(['-s', serial, 'shell', 'pm', 'clear', packageName], 60_000);
  const out = `${res.stdout} ${res.stderr}`.trim();
  return { ok: /success/i.test(out), message: out };
}

/** Launches the app's default LAUNCHER activity via monkey. */
export async function launchApp(serial: string, packageName: string): Promise<boolean> {
  const res = await runAdb(
    ['-s', serial, 'shell', 'monkey', '-p', packageName, '-c', 'android.intent.category.LAUNCHER', '1'],
    20_000,
  );
  return res.ok && !/No activities found|aborted/i.test(`${res.stdout} ${res.stderr}`);
}

/** Sends a random-input exploration burst (adb monkey) — optional coverage aid. */
export async function monkey(serial: string, packageName: string, events: number): Promise<void> {
  await runAdb(['-s', serial, 'shell', 'monkey', '-p', packageName, '--throttle', '300', String(events)], 30_000);
}

/** Captures a real PNG screenshot from the device as a data URL, or null. */
export async function screencapDataUrl(serial: string): Promise<string | null> {
  const buf = await runAdbBinary(['-s', serial, 'exec-out', 'screencap', '-p'], 20_000);
  if (!buf || buf.length === 0) return null;
  return `data:image/png;base64,${buf.toString('base64')}`;
}

/** Reads the resumed activity as a human-readable screen name. */
export async function currentActivity(serial: string): Promise<string | null> {
  const res = await runAdb(['-s', serial, 'shell', 'dumpsys', 'activity', 'activities'], 10_000);
  if (!res.ok) return null;
  const m = res.stdout.match(/ResumedActivity:.*\{[^}]*\s([\w.]+\/[\w.$]+)/)
    ?? res.stdout.match(/mResumedActivity:.*\s([\w.]+\/[\w.$]+)/);
  if (!m) return null;
  const comp = m[1]; // e.g. com.app/.ui.MainActivity
  const activity = comp.split('/')[1] ?? comp;
  return activity.replace(/^\./, '').split('.').pop() ?? activity;
}

/** Clears the logcat buffer so a run only sees its own output. */
export async function clearLogcat(serial: string): Promise<void> {
  await runAdb(['-s', serial, 'logcat', '-c'], 8_000);
}

export interface CrashSignal {
  kind: 'crash' | 'anr';
  title: string;
  excerpt: string;
}

/**
 * Dumps logcat and extracts fatal crashes (FATAL EXCEPTION / AndroidRuntime)
 * and ANRs. Returns at most a handful of distinct signals.
 */
export async function collectCrashes(serial: string): Promise<CrashSignal[]> {
  const res = await runAdb(['-s', serial, 'logcat', '-d', '-v', 'brief'], 15_000);
  if (!res.ok) return [];
  const lines = res.stdout.split('\n');
  const signals: CrashSignal[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/FATAL EXCEPTION|E AndroidRuntime/.test(line) && signals.filter((s) => s.kind === 'crash').length < 3) {
      const excerpt = lines.slice(i, i + 8).join('\n').slice(0, 1200);
      const titleMatch = lines.slice(i, i + 4).find((l) => /Exception|Error/.test(l));
      signals.push({ kind: 'crash', title: (titleMatch?.trim().slice(0, 140)) || 'Fatal runtime exception', excerpt });
    } else if (/ANR in /.test(line) && signals.filter((s) => s.kind === 'anr').length < 2) {
      const excerpt = lines.slice(i, i + 6).join('\n').slice(0, 1000);
      signals.push({ kind: 'anr', title: line.trim().slice(0, 140), excerpt });
    }
  }
  return signals;
}

/** Uninstalls the app (best-effort cleanup after a run). */
export async function uninstall(serial: string, packageName: string): Promise<void> {
  await runAdb(['-s', serial, 'uninstall', packageName], 30_000);
}
