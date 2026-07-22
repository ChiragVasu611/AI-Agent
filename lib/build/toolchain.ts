/**
 * Real build + device/emulator toolchain for the App Factory.
 *
 * Everything here shells out to the local Flutter / Android SDK. Every function
 * is defensive: a missing tool, a failed build or an unavailable emulator never
 * throws to the caller — it returns a structured result with `ok: false` and
 * logs, so the pipeline can fall back to a source-only artifact and still
 * complete. That is the "real build with graceful fallback" contract.
 */
import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { GeneratedFile } from '@/lib/ai/factory';

const PROJECT_NAME = 'factory_app';
const ORG = 'com.factory';
export const GENERATED_PACKAGE = `${ORG}.${PROJECT_NAME}`;

export function buildsRoot(): string {
  return process.env.APP_FACTORY_BUILD_DIR || path.join(process.cwd(), '.factory-builds');
}

function androidHome(): string {
  return (
    process.env.ANDROID_HOME ||
    process.env.ANDROID_SDK_ROOT ||
    path.join(os.homedir(), 'Library/Android/sdk')
  );
}

function flutterBin(): string {
  return process.env.FLUTTER_BIN || 'flutter';
}

function sdkTool(rel: string): string {
  return path.join(androidHome(), rel);
}

interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

function run(cmd: string, args: string[], opts: { cwd?: string; timeoutMs?: number; env?: Record<string, string | undefined> } = {}): Promise<RunResult> {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(cmd, args, {
        cwd: opts.cwd,
        env: { ...process.env, ANDROID_HOME: androidHome(), ANDROID_SDK_ROOT: androidHome(), ...opts.env },
      });
    } catch (e) {
      resolve({ code: -1, stdout: '', stderr: String((e as Error).message ?? e), timedOut: false });
      return;
    }
    const timer = opts.timeoutMs
      ? setTimeout(() => {
          timedOut = true;
          child.kill('SIGKILL');
        }, opts.timeoutMs)
      : null;
    child.stdout?.on('data', (d) => (stdout += d.toString()));
    child.stderr?.on('data', (d) => (stderr += d.toString()));
    child.on('error', (e) => {
      if (timer) clearTimeout(timer);
      resolve({ code: -1, stdout, stderr: stderr + String(e.message), timedOut });
    });
    child.on('close', (code) => {
      if (timer) clearTimeout(timer);
      resolve({ code, stdout, stderr, timedOut });
    });
  });
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

export async function toolchainStatus() {
  const fv = await run(flutterBin(), ['--version'], { timeoutMs: 20000 });
  const adb = sdkTool('platform-tools/adb');
  const emu = sdkTool('emulator/emulator');
  return {
    flutter: fv.code === 0,
    flutterVersion: fv.stdout.split('\n')[0] || null,
    adb: await exists(adb),
    emulator: await exists(emu),
  };
}

export interface BuildResult {
  ok: boolean;
  apkPath: string | null;
  sourceZipPath: string | null;
  projectDir: string;
  logs: string;
  buildTimeMs: number;
  fileCount: number;
}

export interface WebBuildResult {
  ok: boolean;
  webDir: string | null;
  logs: string;
  buildTimeMs: number;
}

export function projectDirFor(projectId: string): string {
  return path.join(buildsRoot(), projectId, 'app');
}

export function webDirFor(projectId: string): string {
  return path.join(projectDirFor(projectId), 'build/web');
}

function baseHrefFor(projectId: string): string {
  return `/api/app-factory/preview/${projectId}/`;
}

async function writeGeneratedFiles(projectDir: string, files: GeneratedFile[]): Promise<void> {
  for (const f of files) {
    const full = path.join(projectDir, f.path);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, f.content, 'utf8');
  }
}

/**
 * Scaffolds the Flutter project once (`flutter create` with Android + Web,
 * plus shared_preferences for persistence) and overlays the generated Dart.
 * Idempotent — safe to call before both the APK and the Web build.
 */
async function ensureProject(projectId: string, files: GeneratedFile[], log: (s: string) => void): Promise<{ ok: boolean; projectDir: string }> {
  const projectDir = projectDirFor(projectId);
  await fs.mkdir(projectDir, { recursive: true });

  if (!(await exists(path.join(projectDir, 'pubspec.yaml')))) {
    log(`$ flutter create --org ${ORG} --project-name ${PROJECT_NAME} --platforms android,web .`);
    const create = await run(flutterBin(), ['create', '--org', ORG, '--project-name', PROJECT_NAME, '--platforms', 'android,web', '.'], {
      cwd: projectDir,
      timeoutMs: 5 * 60000,
    });
    log(create.stdout.slice(-1500));
    if (create.code !== 0) {
      log('flutter create failed:\n' + create.stderr.slice(-2000));
      return { ok: false, projectDir };
    }
    log('$ flutter pub add shared_preferences');
    const add = await run(flutterBin(), ['pub', 'add', 'shared_preferences'], { cwd: projectDir, timeoutMs: 5 * 60000 });
    log((add.stdout + add.stderr).slice(-1000));
  }

  // Overlay generated Dart (replaces the default counter app). Idempotent.
  await run('rm', ['-rf', path.join(projectDir, 'lib')], {});
  await writeGeneratedFiles(projectDir, files);
  log(`Wrote ${files.length} generated files.`);
  return { ok: true, projectDir };
}

async function zipSource(projectId: string, projectDir: string): Promise<string | null> {
  const zipPath = path.join(buildsRoot(), projectId, 'source.zip');
  const res = await run('zip', ['-r', '-q', zipPath, 'lib', 'test', 'README.md', 'pubspec.yaml'], {
    cwd: projectDir,
    timeoutMs: 60000,
  });
  return res.code === 0 ? zipPath : null;
}

/**
 * Builds a debug APK. Falls back to source-only when the toolchain or the
 * build is unavailable.
 */
export async function buildFlutterApk(projectId: string, files: GeneratedFile[]): Promise<BuildResult> {
  const started = Date.now();
  const projectDir = projectDirFor(projectId);
  const logs: string[] = [];
  const log = (s: string) => logs.push(s);

  const status = await toolchainStatus();
  if (!status.flutter) {
    // No Flutter — still deliver the source so the project is downloadable.
    await writeGeneratedFiles(projectDir, files);
    log('Flutter toolchain not found — skipping compile, delivering source only.');
    const sourceZipPath = await zipSource(projectId, projectDir);
    return { ok: false, apkPath: null, sourceZipPath, projectDir, logs: logs.join('\n'), buildTimeMs: Date.now() - started, fileCount: files.length };
  }

  try {
    const ens = await ensureProject(projectId, files, log);
    if (!ens.ok) {
      const sourceZipPath = await zipSource(projectId, projectDir);
      return { ok: false, apkPath: null, sourceZipPath, projectDir, logs: logs.join('\n'), buildTimeMs: Date.now() - started, fileCount: files.length };
    }

    log('$ flutter build apk --debug');
    const build = await run(flutterBin(), ['build', 'apk', '--debug'], {
      cwd: projectDir,
      timeoutMs: 20 * 60000,
    });
    log(build.stdout.slice(-4000));
    if (build.stderr) log(build.stderr.slice(-2000));

    const apkPath = path.join(projectDir, 'build/app/outputs/flutter-apk/app-debug.apk');
    const built = build.code === 0 && (await exists(apkPath));
    const sourceZipPath = await zipSource(projectId, projectDir);

    if (build.timedOut) log('Build timed out after 20 minutes.');
    return {
      ok: built,
      apkPath: built ? apkPath : null,
      sourceZipPath,
      projectDir,
      logs: logs.join('\n'),
      buildTimeMs: Date.now() - started,
      fileCount: files.length,
    };
  } catch (e) {
    log('Build error: ' + String((e as Error).message ?? e));
    try {
      await writeGeneratedFiles(projectDir, files);
    } catch {
      /* ignore */
    }
    const sourceZipPath = await zipSource(projectId, projectDir);
    return { ok: false, apkPath: null, sourceZipPath, projectDir, logs: logs.join('\n'), buildTimeMs: Date.now() - started, fileCount: files.length };
  }
}

/**
 * Builds the app for the web (HTML renderer, no service worker) so it can be
 * embedded live in the dashboard's phone frame under
 * /api/app-factory/preview/<id>/. This is the "virtual emulator on dashboard".
 */
export async function buildFlutterWeb(projectId: string, files: GeneratedFile[]): Promise<WebBuildResult> {
  const started = Date.now();
  const projectDir = projectDirFor(projectId);
  const logs: string[] = [];
  const log = (s: string) => logs.push(s);

  const status = await toolchainStatus();
  if (!status.flutter) {
    log('Flutter toolchain not found — cannot build web preview.');
    return { ok: false, webDir: null, logs: logs.join('\n'), buildTimeMs: Date.now() - started };
  }

  try {
    const ens = await ensureProject(projectId, files, log);
    if (!ens.ok) return { ok: false, webDir: null, logs: logs.join('\n'), buildTimeMs: Date.now() - started };

    log(`$ flutter build web --release --web-renderer html --pwa-strategy none --base-href ${baseHrefFor(projectId)}`);
    const build = await run(
      flutterBin(),
      ['build', 'web', '--release', '--web-renderer', 'html', '--pwa-strategy', 'none', '--base-href', baseHrefFor(projectId)],
      { cwd: projectDir, timeoutMs: 15 * 60000 },
    );
    log(build.stdout.slice(-3000));
    if (build.stderr) log(build.stderr.slice(-1500));

    const webDir = webDirFor(projectId);
    const built = build.code === 0 && (await exists(path.join(webDir, 'index.html')));
    if (build.timedOut) log('Web build timed out.');
    return { ok: built, webDir: built ? webDir : null, logs: logs.join('\n'), buildTimeMs: Date.now() - started };
  } catch (e) {
    log('Web build error: ' + String((e as Error).message ?? e));
    return { ok: false, webDir: null, logs: logs.join('\n'), buildTimeMs: Date.now() - started };
  }
}

export interface EmulatorResult {
  status: 'launched' | 'installed' | 'no-device' | 'unavailable' | 'error';
  serial: string | null;
  target: RunTarget;
  deviceType: 'emulator' | 'physical' | null;
  booted: boolean;
  installed: boolean;
  launched: boolean;
  logs: string;
}

/** A device or emulator currently visible to adb. */
export interface DeviceInfo {
  serial: string;
  type: 'emulator' | 'physical';
  connection: 'usb' | 'wifi';
  model: string;
  state: string;
}

/** Where the user wants the freshly-built app to run. */
export type RunTarget = 'emulator' | 'real-device' | 'auto';

function adbPath(): string {
  return sdkTool('platform-tools/adb');
}
function emulatorPath(): string {
  return sdkTool('emulator/emulator');
}

/** Binary-safe command runner (adb screencap returns raw PNG bytes). */
function runBinary(cmd: string, args: string[], opts: { timeoutMs?: number } = {}): Promise<{ code: number | null; stdout: Buffer; stderr: string }> {
  return new Promise((resolve) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(cmd, args, { env: { ...process.env, ANDROID_HOME: androidHome(), ANDROID_SDK_ROOT: androidHome() } });
    } catch (e) {
      resolve({ code: -1, stdout: Buffer.alloc(0), stderr: String((e as Error).message ?? e) });
      return;
    }
    const chunks: Buffer[] = [];
    let stderr = '';
    const timer = opts.timeoutMs ? setTimeout(() => child.kill('SIGKILL'), opts.timeoutMs) : null;
    child.stdout?.on('data', (d) => chunks.push(Buffer.from(d)));
    child.stderr?.on('data', (d) => (stderr += d.toString()));
    child.on('error', (e) => {
      if (timer) clearTimeout(timer);
      resolve({ code: -1, stdout: Buffer.concat(chunks), stderr: stderr + String(e.message) });
    });
    child.on('close', (code) => {
      if (timer) clearTimeout(timer);
      resolve({ code, stdout: Buffer.concat(chunks), stderr });
    });
  });
}

/** Lists every ready device/emulator known to adb, classified by type. */
export async function listDevices(): Promise<DeviceInfo[]> {
  if (!(await exists(adbPath()))) return [];
  await run(adbPath(), ['start-server'], { timeoutMs: 15000 });
  const res = await run(adbPath(), ['devices', '-l'], { timeoutMs: 15000 });
  const devices: DeviceInfo[] = [];
  for (const line of res.stdout.split('\n').slice(1)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const parts = trimmed.split(/\s+/);
    const serial = parts[0];
    const state = parts[1];
    if (state !== 'device') continue; // skip offline / unauthorized
    const model = (trimmed.match(/model:(\S+)/)?.[1] ?? serial).replace(/_/g, ' ');
    const isWifi = /^\d{1,3}(\.\d{1,3}){3}:\d+$/.test(serial);
    const isEmu = serial.startsWith('emulator-');
    devices.push({
      serial,
      type: isEmu ? 'emulator' : 'physical',
      connection: isWifi ? 'wifi' : 'usb',
      model,
      state,
    });
  }
  return devices;
}

async function waitForBoot(serial: string, timeoutMs: number, log: (s: string) => void): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await run(adbPath(), ['-s', serial, 'shell', 'getprop', 'sys.boot_completed'], { timeoutMs: 10000 });
    if (res.stdout.trim() === '1') return true;
    await new Promise((r) => setTimeout(r, 3000));
  }
  log('Timed out waiting for device to finish booting.');
  return false;
}

/** Boots an AVD (creating a default one from an installed system image when none exist). */
async function bootEmulator(log: (s: string) => void): Promise<string | null> {
  if (!(await exists(emulatorPath()))) {
    log('Emulator binary not found.');
    return null;
  }
  let avds = (await run(emulatorPath(), ['-list-avds'], { timeoutMs: 15000 })).stdout.split('\n').map((s) => s.trim()).filter(Boolean);
  log(`Available AVDs: ${avds.length ? avds.join(', ') : 'none'}`);

  if (avds.length === 0) {
    const avdmanager = sdkTool('cmdline-tools/latest/bin/avdmanager');
    const sysImagesDir = sdkTool('system-images');
    let image: string | null = null;
    if (await exists(sysImagesDir)) {
      const apis = await fs.readdir(sysImagesDir).catch(() => [] as string[]);
      for (const api of apis.sort().reverse()) {
        const tagDir = path.join(sysImagesDir, api);
        const tags = await fs.readdir(tagDir).catch(() => [] as string[]);
        for (const tag of tags) {
          const abis = await fs.readdir(path.join(tagDir, tag)).catch(() => [] as string[]);
          if (abis.length) {
            image = `system-images;${api};${tag};${abis[0]}`;
            break;
          }
        }
        if (image) break;
      }
    }
    if (image && (await exists(avdmanager))) {
      log(`Creating AVD factory_avd from ${image}`);
      const create = await run(avdmanager, ['create', 'avd', '-n', 'factory_avd', '-k', image, '-d', 'pixel', '--force'], {
        timeoutMs: 60000,
        env: { JAVA_HOME: process.env.JAVA_HOME || '' },
      });
      log(create.stdout.slice(-1000) + create.stderr.slice(-1000));
      if (create.code === 0) avds = ['factory_avd'];
    }
    if (avds.length === 0) {
      log('No AVDs available and none could be created (no system image installed).');
      return null;
    }
  }

  log(`Booting emulator ${avds[0]} …`);
  const emu = spawn(emulatorPath(), ['-avd', avds[0], '-no-snapshot', '-netdelay', 'none', '-netspeed', 'full'], {
    detached: true,
    stdio: 'ignore',
    env: { ...process.env, ANDROID_HOME: androidHome(), ANDROID_SDK_ROOT: androidHome() },
  });
  emu.unref();

  // Wait for the emulator to register with adb.
  const deadline = Date.now() + 120000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 3000));
    const emus = (await listDevices()).filter((d) => d.type === 'emulator');
    if (emus.length) return emus[0].serial;
  }
  log('Emulator did not come online in time.');
  return null;
}

/**
 * Installs and launches the APK on the chosen target.
 *  - 'real-device' → a physically-connected (USB/Wi-Fi) device; fails if none.
 *  - 'emulator'    → a running emulator, booting an AVD if necessary.
 *  - 'auto'        → prefers an attached physical device, else an emulator.
 * An explicit `serial` (e.g. picked in the UI) always wins.
 */
export async function installAndLaunch(
  apkPath: string,
  packageName: string,
  opts: { target?: RunTarget; serial?: string } = {},
): Promise<EmulatorResult> {
  const target: RunTarget = opts.target ?? 'auto';
  const logs: string[] = [];
  const log = (s: string) => logs.push(s);
  const done = (r: Omit<EmulatorResult, 'logs' | 'target'>): EmulatorResult => ({ ...r, target, logs: logs.join('\n') });

  if (!(await exists(adbPath()))) {
    log('adb not found — cannot install/launch.');
    return done({ status: 'unavailable', serial: null, deviceType: null, booted: false, installed: false, launched: false });
  }

  let devices = await listDevices();
  log(`Attached: ${devices.length ? devices.map((d) => `${d.serial}(${d.type})`).join(', ') : 'none'}`);

  // Resolve which device to use.
  let serial: string | null = null;
  let deviceType: 'emulator' | 'physical' | null = null;

  if (opts.serial && devices.some((d) => d.serial === opts.serial)) {
    serial = opts.serial;
    deviceType = devices.find((d) => d.serial === opts.serial)!.type;
  } else if (target === 'real-device') {
    const phys = devices.find((d) => d.type === 'physical');
    if (!phys) {
      log('No physical device detected. Connect one over USB, or enable Wi-Fi adb.');
      return done({ status: 'no-device', serial: null, deviceType: null, booted: false, installed: false, launched: false });
    }
    serial = phys.serial;
    deviceType = 'physical';
  } else if (target === 'emulator') {
    const emu = devices.find((d) => d.type === 'emulator');
    serial = emu?.serial ?? (await bootEmulator(log));
    deviceType = 'emulator';
    if (!serial) return done({ status: 'no-device', serial: null, deviceType: 'emulator', booted: false, installed: false, launched: false });
  } else {
    // auto
    const preferred = devices.find((d) => d.type === 'physical') ?? devices.find((d) => d.type === 'emulator');
    if (preferred) {
      serial = preferred.serial;
      deviceType = preferred.type;
    } else {
      serial = await bootEmulator(log);
      deviceType = 'emulator';
      if (!serial) return done({ status: 'no-device', serial: null, deviceType: null, booted: false, installed: false, launched: false });
    }
  }

  const booted = await waitForBoot(serial, 120000, log);
  if (!booted) return done({ status: 'error', serial, deviceType, booted: false, installed: false, launched: false });

  log(`$ adb -s ${serial} install -r <apk>`);
  const install = await run(adbPath(), ['-s', serial, 'install', '-r', apkPath], { timeoutMs: 5 * 60000 });
  log((install.stdout + install.stderr).slice(-1500));
  const installed = /Success/i.test(install.stdout + install.stderr);
  if (!installed) return done({ status: 'error', serial, deviceType, booted, installed: false, launched: false });

  log(`$ adb -s ${serial} shell monkey -p ${packageName} 1`);
  const launch = await run(adbPath(), ['-s', serial, 'shell', 'monkey', '-p', packageName, '-c', 'android.intent.category.LAUNCHER', '1'], {
    timeoutMs: 30000,
  });
  const launched = launch.code === 0 && !/No activities found/i.test(launch.stdout + launch.stderr);
  log(launched ? 'App launched on device.' : 'Launch command did not confirm an activity.');

  return done({ status: launched ? 'launched' : 'installed', serial, deviceType, booted, installed, launched });
}

/** Captures a PNG screenshot of a device for the on-page live mirror. */
export async function captureScreenshot(serial: string): Promise<Buffer | null> {
  if (!(await exists(adbPath()))) return null;
  const res = await runBinary(adbPath(), ['-s', serial, 'exec-out', 'screencap', '-p'], { timeoutMs: 20000 });
  if (res.code !== 0 || res.stdout.length < 100) return null;
  return res.stdout;
}

/** Connects to a device over the network by explicit host + port (`adb connect`). */
export async function connectWireless(host: string, port: number): Promise<{ ok: boolean; serial: string | null; logs: string }> {
  if (!(await exists(adbPath()))) return { ok: false, serial: null, logs: 'adb not found.' };
  await run(adbPath(), ['start-server'], { timeoutMs: 15000 });
  const serial = `${host}:${port}`;
  const res = await run(adbPath(), ['connect', serial], { timeoutMs: 20000 });
  const out = (res.stdout + res.stderr).trim();
  const ok = /connected to|already connected/i.test(out) && !/failed|cannot|unable|refused/i.test(out);
  return { ok, serial: ok ? serial : null, logs: out };
}

export interface WifiResult {
  ok: boolean;
  wifiSerial: string | null;
  ip: string | null;
  logs: string;
}

/**
 * Switches a USB-connected physical device to wireless adb:
 * finds its Wi-Fi IP, restarts adbd in TCP mode, and connects over the network.
 */
export async function enableWifiAdb(serial: string): Promise<WifiResult> {
  const logs: string[] = [];
  const log = (s: string) => logs.push(s);
  if (!(await exists(adbPath()))) return { ok: false, wifiSerial: null, ip: null, logs: 'adb not found.' };

  // Find the device's Wi-Fi (or any private, non-loopback) IPv4 address.
  const addr = await run(adbPath(), ['-s', serial, 'shell', 'ip', '-o', '-4', 'addr', 'show'], { timeoutMs: 15000 });
  const ips = Array.from(addr.stdout.matchAll(/inet (\d{1,3}(?:\.\d{1,3}){3})/g)).map((m) => m[1]).filter((ip) => ip !== '127.0.0.1');
  const ip = ips.find((i) => /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(i)) ?? ips[0] ?? null;
  if (!ip) {
    log('Could not determine the device Wi-Fi IP. Ensure Wi-Fi is on and connected to the same network.');
    return { ok: false, wifiSerial: null, ip: null, logs: logs.join('\n') };
  }
  log(`Device IP: ${ip}`);

  log(`$ adb -s ${serial} tcpip 5555`);
  const tcpip = await run(adbPath(), ['-s', serial, 'tcpip', '5555'], { timeoutMs: 20000 });
  log((tcpip.stdout + tcpip.stderr).trim());
  await new Promise((r) => setTimeout(r, 2000));

  const wifiSerial = `${ip}:5555`;
  log(`$ adb connect ${wifiSerial}`);
  const connect = await run(adbPath(), ['connect', wifiSerial], { timeoutMs: 20000 });
  log((connect.stdout + connect.stderr).trim());
  const ok = /connected to|already connected/i.test(connect.stdout + connect.stderr);

  return { ok, wifiSerial: ok ? wifiSerial : null, ip, logs: logs.join('\n') };
}
