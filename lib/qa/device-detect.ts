/**
 * Real USB device detection for Android (ADB) and iOS (libimobiledevice / Xcode).
 *
 * Everything here shells out to the actual toolchain on the host and parses its
 * real output. Nothing is simulated — when a tool is missing or a device is not
 * usable, we report the specific reason and how to fix it rather than inventing
 * a device entry.
 */

import { execFile } from 'child_process';
import { existsSync } from 'fs';
import os from 'os';
import path from 'path';

const EXEC_TIMEOUT_MS = 8000;

export type DetectionCode =
  | 'adb_not_found' | 'adb_not_running' | 'no_device' | 'unauthorized'
  | 'usb_debugging_disabled' | 'device_offline' | 'no_permissions' | 'ios_tools_missing';

export interface DetectionIssue {
  code: DetectionCode;
  platform: 'android' | 'ios';
  title: string;
  detail: string;
  /** Concrete steps the user can take, in order. */
  remediation: string[];
}

export interface DetectedDevice {
  id: string;
  name: string;
  model: string;
  manufacturer: string;
  platform: 'android' | 'ios';
  type: 'real_android' | 'emulator_android' | 'real_ios' | 'simulator_ios';
  osVersion: string;
  apiLevel: string | null;
  resolution: string | null;
  battery: number | null;
  charging: boolean | null;
  connection: 'usb' | 'wifi' | 'unknown';
  authorization: 'authorized' | 'unauthorized' | 'unknown';
  state: 'online' | 'offline';
}

export interface DeviceScan {
  devices: DetectedDevice[];
  issues: DetectionIssue[];
  android: { toolAvailable: boolean; toolPath: string | null; version: string | null };
  ios: { toolAvailable: boolean; toolName: string | null };
  scannedAt: string;
}

interface ExecResult { ok: boolean; stdout: string; stderr: string; code: number | null }

function run(file: string, args: string[], timeout = EXEC_TIMEOUT_MS): Promise<ExecResult> {
  return new Promise((resolve) => {
    execFile(file, args, { timeout, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
      resolve({
        ok: !err,
        stdout: String(stdout ?? ''),
        stderr: String(stderr ?? ''),
        code: err && typeof (err as NodeJS.ErrnoException).code === 'number' ? Number((err as NodeJS.ErrnoException).code) : null,
      });
    });
  });
}

/**
 * The Next.js server process does not necessarily inherit the developer's shell
 * PATH, so probe the standard SDK install locations as well as PATH.
 */
let cachedAdbPath: string | null | undefined;
export function resolveAdbPath(): string | null {
  if (cachedAdbPath !== undefined) return cachedAdbPath;

  const home = os.homedir();
  const candidates = [
    process.env.ADB_PATH,
    process.env.ANDROID_HOME ? path.join(process.env.ANDROID_HOME, 'platform-tools', 'adb') : null,
    process.env.ANDROID_SDK_ROOT ? path.join(process.env.ANDROID_SDK_ROOT, 'platform-tools', 'adb') : null,
    path.join(home, 'Library/Android/sdk/platform-tools/adb'),      // macOS default
    path.join(home, 'Android/Sdk/platform-tools/adb'),              // Linux default
    path.join(home, 'AppData/Local/Android/Sdk/platform-tools/adb.exe'), // Windows default
    '/usr/local/bin/adb',
    '/opt/homebrew/bin/adb',
    '/usr/bin/adb',
  ].filter(Boolean) as string[];

  for (const c of candidates) {
    if (existsSync(c)) {
      cachedAdbPath = c;
      return c;
    }
  }
  // Last resort: rely on PATH resolution.
  cachedAdbPath = 'adb';
  return cachedAdbPath;
}

/** Clear the memoised adb lookup — used after the user installs/moves the SDK. */
export function resetAdbPathCache() {
  cachedAdbPath = undefined;
}

async function adb(args: string[], timeout?: number): Promise<ExecResult> {
  const bin = resolveAdbPath();
  if (!bin) return { ok: false, stdout: '', stderr: 'adb not found', code: null };
  return run(bin, args, timeout);
}

/** One line of `adb devices -l` output. */
interface AdbListEntry {
  serial: string;
  state: string;
  meta: Record<string, string>;
}

function parseAdbDevices(stdout: string): AdbListEntry[] {
  return stdout
    .split(/\r?\n/)
    .slice(1) // drop "List of devices attached"
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith('*'))
    .map((line) => {
      const parts = line.split(/\s+/);
      const serial = parts[0];
      const state = parts[1] ?? 'unknown';
      const meta: Record<string, string> = {};
      for (const p of parts.slice(2)) {
        const idx = p.indexOf(':');
        if (idx > 0) meta[p.slice(0, idx)] = p.slice(idx + 1);
      }
      return { serial, state, meta };
    })
    .filter((e) => Boolean(e.serial));
}

async function getProp(serial: string, prop: string): Promise<string> {
  const r = await adb(['-s', serial, 'shell', 'getprop', prop], 5000);
  return r.stdout.trim().replace(/\r/g, '');
}

async function androidBattery(serial: string): Promise<{ level: number | null; charging: boolean | null }> {
  const r = await adb(['-s', serial, 'shell', 'dumpsys', 'battery'], 6000);
  if (!r.ok) return { level: null, charging: null };
  const text = r.stdout.replace(/\r/g, '');
  // Vendor builds (e.g. OPLUS) prepend their own section — anchor on the
  // standard "level:" line, which only appears in the AOSP battery block.
  const level = text.match(/^\s*level:\s*(\d+)/m)?.[1];
  const usb = /^\s*USB powered:\s*true/m.test(text);
  const ac = /^\s*AC powered:\s*true/m.test(text);
  const wireless = /^\s*Wireless powered:\s*true/m.test(text);
  return {
    level: level != null ? Number(level) : null,
    charging: usb || ac || wireless,
  };
}

async function androidResolution(serial: string): Promise<string | null> {
  const r = await adb(['-s', serial, 'shell', 'wm', 'size'], 5000);
  if (!r.ok) return null;
  // "Physical size: 1080x2400" — an Override size wins when present.
  const override = r.stdout.match(/Override size:\s*(\d+x\d+)/)?.[1];
  const physical = r.stdout.match(/Physical size:\s*(\d+x\d+)/)?.[1];
  return override ?? physical ?? null;
}

/** Human-friendly device name, falling back through the usual property chain. */
async function androidName(serial: string, model: string, manufacturer: string): Promise<string> {
  const settings = await adb(['-s', serial, 'shell', 'settings', 'get', 'global', 'device_name'], 5000);
  const fromSettings = settings.stdout.trim().replace(/\r/g, '');
  if (fromSettings && fromSettings !== 'null') return fromSettings;
  const marketName = await getProp(serial, 'ro.product.marketname');
  if (marketName) return marketName;
  return [manufacturer, model].filter(Boolean).join(' ') || serial;
}

function issueForState(serial: string, state: string): DetectionIssue | null {
  switch (state) {
    case 'unauthorized':
      return {
        code: 'unauthorized', platform: 'android',
        title: `Device ${serial} is unauthorized`,
        detail: 'The device is connected but has not accepted this computer\'s USB debugging key, so ADB cannot read any of its properties.',
        remediation: [
          'Unlock the device screen and look for the "Allow USB debugging?" dialog.',
          'Tick "Always allow from this computer" and tap Allow.',
          'If no dialog appears, revoke old keys: Settings → Developer options → Revoke USB debugging authorizations, then reconnect.',
        ],
      };
    case 'offline':
      return {
        code: 'device_offline', platform: 'android',
        title: `Device ${serial} is offline`,
        detail: 'ADB sees the device but it is not responding to commands. This usually follows a cable glitch, a device reboot, or an ADB version mismatch.',
        remediation: ['Unplug and replug the USB cable.', 'Use the Restart ADB action below.', 'Try a different USB port or a data-capable cable.'],
      };
    case 'no':
    case 'no permissions':
      return {
        code: 'no_permissions', platform: 'android',
        title: `Insufficient USB permissions for ${serial}`,
        detail: 'The operating system is blocking access to the USB device node.',
        remediation: [
          'On Linux, install udev rules: sudo apt install android-sdk-platform-tools-common',
          'Then replug the device.',
        ],
      };
    default:
      return null;
  }
}

async function scanAndroid(): Promise<{ devices: DetectedDevice[]; issues: DetectionIssue[]; toolPath: string | null; version: string | null }> {
  const devices: DetectedDevice[] = [];
  const issues: DetectionIssue[] = [];

  const ver = await adb(['version'], 5000);
  if (!ver.ok) {
    issues.push({
      code: 'adb_not_found', platform: 'android',
      title: 'ADB is not installed or not on the server\'s PATH',
      detail: 'Android Debug Bridge could not be launched, so no Android device can be detected.',
      remediation: [
        'Install Android Studio, or the standalone Android SDK Platform-Tools.',
        'Set the ANDROID_HOME environment variable, or set ADB_PATH to the full path of the adb binary.',
        'Restart the application server so it picks up the new environment.',
      ],
    });
    return { devices, issues, toolPath: null, version: null };
  }
  const version = ver.stdout.match(/Android Debug Bridge version ([\d.]+)/)?.[1] ?? null;

  const list = await adb(['devices', '-l'], 8000);
  if (!list.ok) {
    issues.push({
      code: 'adb_not_running', platform: 'android',
      title: 'The ADB server is not responding',
      detail: list.stderr.trim() || 'adb devices failed to execute.',
      remediation: ['Use the Restart ADB action below.', 'Check that no other tool (Android Studio, scrcpy) is holding the ADB port.'],
    });
    return { devices, issues, toolPath: resolveAdbPath(), version };
  }

  const entries = parseAdbDevices(list.stdout);

  if (entries.length === 0) {
    issues.push({
      code: 'no_device', platform: 'android',
      title: 'No Android device connected',
      detail: 'ADB is running correctly but reports zero attached devices.',
      remediation: [
        'Connect the device with a data-capable USB cable (charge-only cables will not work).',
        'On the device: Settings → About phone → tap Build number 7 times to unlock Developer options.',
        'Then: Settings → Developer options → enable USB debugging.',
        'Set the USB mode to File Transfer (MTP) rather than Charging only.',
      ],
    });
  }

  for (const entry of entries) {
    const stateIssue = issueForState(entry.serial, entry.state);
    if (stateIssue) issues.push(stateIssue);

    // Only an authorized, online device can be interrogated for properties.
    if (entry.state !== 'device') {
      devices.push({
        id: entry.serial,
        name: entry.meta.model || entry.serial,
        model: entry.meta.model || 'Unknown',
        manufacturer: '',
        platform: 'android',
        type: entry.serial.startsWith('emulator-') ? 'emulator_android' : 'real_android',
        osVersion: 'Unknown',
        apiLevel: null,
        resolution: null,
        battery: null,
        charging: null,
        connection: entry.meta.usb ? 'usb' : /:\d+$/.test(entry.serial) ? 'wifi' : 'unknown',
        authorization: entry.state === 'unauthorized' ? 'unauthorized' : 'unknown',
        state: 'offline',
      });
      continue;
    }

    const [model, manufacturer, release, sdk, resolution, battery] = await Promise.all([
      getProp(entry.serial, 'ro.product.model'),
      getProp(entry.serial, 'ro.product.manufacturer'),
      getProp(entry.serial, 'ro.build.version.release'),
      getProp(entry.serial, 'ro.build.version.sdk'),
      androidResolution(entry.serial),
      androidBattery(entry.serial),
    ]);
    const name = await androidName(entry.serial, model, manufacturer);

    devices.push({
      id: entry.serial,
      name,
      model: model || entry.meta.model || 'Unknown',
      manufacturer,
      platform: 'android',
      type: entry.serial.startsWith('emulator-') ? 'emulator_android' : 'real_android',
      osVersion: release ? `Android ${release}` : 'Unknown',
      apiLevel: sdk || null,
      resolution,
      battery: battery.level,
      charging: battery.charging,
      // A serial of the form host:port means the device was reached over TCP/IP.
      connection: /:\d+$/.test(entry.serial) ? 'wifi' : entry.meta.usb ? 'usb' : 'usb',
      authorization: 'authorized',
      state: 'online',
    });
  }

  return { devices, issues, toolPath: resolveAdbPath(), version };
}

/** Which iOS bridge, if any, exists on this host. */
async function findIosTool(): Promise<{ tool: 'libimobiledevice' | 'devicectl' | 'xctrace' | null }> {
  const idevice = await run('idevice_id', ['-l'], 5000);
  if (idevice.ok) return { tool: 'libimobiledevice' };
  const devicectl = await run('xcrun', ['devicectl', 'list', 'devices'], 12000);
  if (devicectl.ok) return { tool: 'devicectl' };
  const xctrace = await run('xcrun', ['xctrace', 'list', 'devices'], 12000);
  if (xctrace.ok) return { tool: 'xctrace' };
  return { tool: null };
}

async function scanIos(): Promise<{ devices: DetectedDevice[]; issues: DetectionIssue[]; toolName: string | null }> {
  const devices: DetectedDevice[] = [];
  const issues: DetectionIssue[] = [];

  const { tool } = await findIosTool();
  if (!tool) {
    issues.push({
      code: 'ios_tools_missing', platform: 'ios',
      title: 'No iOS device bridge is installed',
      detail: 'Detecting a physically connected iPhone or iPad requires libimobiledevice or the Xcode command-line device tools. Neither was found on this host, so iOS devices cannot be enumerated.',
      remediation: [
        'macOS: brew install libimobiledevice',
        'Or install the full Xcode (not just Command Line Tools) to get `xcrun devicectl`.',
        'Then reconnect the device and trust this computer when prompted.',
      ],
    });
    return { devices, issues, toolName: null };
  }

  if (tool === 'libimobiledevice') {
    const list = await run('idevice_id', ['-l'], 6000);
    const udids = list.stdout.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    for (const udid of udids) {
      const info = await run('ideviceinfo', ['-u', udid], 8000);
      const field = (k: string) => info.stdout.match(new RegExp(`^${k}:\\s*(.+)$`, 'm'))?.[1]?.trim() ?? '';
      const battRaw = await run('ideviceinfo', ['-u', udid, '-q', 'com.apple.mobile.battery', '-k', 'BatteryCurrentCapacity'], 6000);
      const batt = Number(battRaw.stdout.trim());
      const productVersion = field('ProductVersion');
      devices.push({
        id: udid,
        name: field('DeviceName') || 'iOS device',
        model: field('ProductType') || 'Unknown',
        manufacturer: 'Apple',
        platform: 'ios',
        type: 'real_ios',
        osVersion: productVersion ? `iOS ${productVersion}` : 'Unknown',
        apiLevel: null,
        resolution: null,
        battery: Number.isFinite(batt) ? batt : null,
        charging: null,
        connection: 'usb',
        authorization: info.ok ? 'authorized' : 'unauthorized',
        state: info.ok ? 'online' : 'offline',
      });
      if (!info.ok) {
        issues.push({
          code: 'unauthorized', platform: 'ios',
          title: `iOS device ${udid} is not trusted`,
          detail: 'The device is attached but has not trusted this computer.',
          remediation: ['Unlock the device.', 'Tap "Trust" on the "Trust This Computer?" prompt.', 'Reconnect the cable.'],
        });
      }
    }
    if (udids.length === 0) {
      issues.push({
        code: 'no_device', platform: 'ios',
        title: 'No iOS device connected',
        detail: 'libimobiledevice is installed and working but reports no attached device.',
        remediation: ['Connect an iPhone/iPad over USB.', 'Unlock it and tap Trust when prompted.'],
      });
    }
    return { devices, issues, toolName: 'libimobiledevice' };
  }

  // devicectl / xctrace: enumerate names + identifiers only.
  const cmd = tool === 'devicectl' ? ['devicectl', 'list', 'devices'] : ['xctrace', 'list', 'devices'];
  const out = await run('xcrun', cmd, 15000);
  const udidRe = /([0-9A-Fa-f]{8}-[0-9A-Fa-f]{16}|[0-9a-f]{40})/;
  for (const line of out.stdout.split(/\r?\n/)) {
    if (/simulator/i.test(line)) continue; // physical devices only
    const udid = line.match(udidRe)?.[1];
    if (!udid) continue;
    const name = line.split(/\s{2,}|\(/)[0]?.trim() || 'iOS device';
    const ver = line.match(/\((\d+\.\d+(?:\.\d+)?)\)/)?.[1];
    devices.push({
      id: udid, name, model: 'Unknown', manufacturer: 'Apple', platform: 'ios', type: 'real_ios',
      osVersion: ver ? `iOS ${ver}` : 'Unknown', apiLevel: null, resolution: null,
      battery: null, charging: null, connection: 'usb', authorization: 'authorized', state: 'online',
    });
  }
  if (devices.length === 0) {
    issues.push({
      code: 'no_device', platform: 'ios',
      title: 'No iOS device connected',
      detail: `${tool} is available but reported no physically attached device.`,
      remediation: ['Connect an iPhone/iPad over USB.', 'Unlock it and tap Trust when prompted.'],
    });
  }
  return { devices, issues, toolName: tool };
}

/** Full scan of both platforms. Safe to call on an interval. */
export async function scanDevices(): Promise<DeviceScan> {
  const [android, ios] = await Promise.all([scanAndroid(), scanIos()]);
  return {
    devices: [...android.devices, ...ios.devices],
    issues: [...android.issues, ...ios.issues],
    android: { toolAvailable: android.toolPath !== null && android.version !== null, toolPath: android.toolPath, version: android.version },
    ios: { toolAvailable: ios.toolName !== null, toolName: ios.toolName },
    scannedAt: new Date().toISOString(),
  };
}

// ---- Actions ----

export async function restartAdb(): Promise<{ ok: boolean; output: string }> {
  const kill = await adb(['kill-server'], 10000);
  const start = await adb(['start-server'], 15000);
  return {
    ok: start.ok,
    output: [kill.stdout, kill.stderr, start.stdout, start.stderr].filter(Boolean).join('\n').trim() || 'ADB server restarted.',
  };
}

export async function reconnectDevice(serial: string): Promise<{ ok: boolean; output: string }> {
  const r = await adb(['-s', serial, 'reconnect'], 10000);
  return { ok: r.ok, output: [r.stdout, r.stderr].filter(Boolean).join('\n').trim() || `Reconnect requested for ${serial}.` };
}

export async function readAdbLogs(serial: string | null, lines = 200): Promise<{ ok: boolean; output: string }> {
  const args = serial
    ? ['-s', serial, 'logcat', '-d', '-v', 'time', '-t', String(lines)]
    : ['logcat', '-d', '-v', 'time', '-t', String(lines)];
  const r = await adb(args, 12000);
  return { ok: r.ok, output: (r.stdout || r.stderr || 'No log output.').trim() };
}
