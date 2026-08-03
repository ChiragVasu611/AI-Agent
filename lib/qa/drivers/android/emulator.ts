import { spawn } from 'child_process';
import { existsSync } from 'fs';
import { join } from 'path';
import { runAdb } from '../../adb';

/**
 * Android emulator lifecycle.
 *
 * The mandate requires emulator support alongside physical devices, so a run can
 * boot its own target rather than depending on hardware being plugged in.
 *
 * Everything here reports what the SDK actually says. If `avdmanager` or
 * `emulator` is not installed, that is returned as an explicit reason — the
 * caller then blocks the run with `runtime_unavailable` instead of pretending an
 * emulator exists.
 */

function sdkRoot(): string | null {
  const candidates = [
    process.env.ANDROID_HOME,
    process.env.ANDROID_SDK_ROOT,
    process.env.HOME ? join(process.env.HOME, 'Library/Android/sdk') : null,
    process.env.HOME ? join(process.env.HOME, 'Android/Sdk') : null,
  ].filter(Boolean) as string[];
  return candidates.find((c) => existsSync(c)) ?? null;
}

function toolPath(...segments: string[]): string | null {
  const root = sdkRoot();
  if (!root) return null;
  const p = join(root, ...segments);
  return existsSync(p) ? p : null;
}

export function emulatorBinary(): string | null {
  return toolPath('emulator', 'emulator');
}

export function avdManagerBinary(): string | null {
  return toolPath('cmdline-tools', 'latest', 'bin', 'avdmanager')
    ?? toolPath('tools', 'bin', 'avdmanager');
}

export interface EmulatorSupport {
  available: boolean;
  detail: string;
  emulatorPath: string | null;
  avdManagerPath: string | null;
}

/** Probes the host for a usable emulator toolchain. Never assumes one. */
export function emulatorSupport(): EmulatorSupport {
  const emulatorPath = emulatorBinary();
  const avdManagerPath = avdManagerBinary();
  if (!sdkRoot()) {
    return {
      available: false,
      detail: 'No Android SDK found. Set ANDROID_HOME or ANDROID_SDK_ROOT.',
      emulatorPath: null, avdManagerPath: null,
    };
  }
  if (!emulatorPath) {
    return {
      available: false,
      detail: 'The Android SDK is present but the `emulator` package is not installed '
        + '(install it with: sdkmanager emulator).',
      emulatorPath: null, avdManagerPath,
    };
  }
  return {
    available: true,
    detail: `Emulator toolchain at ${emulatorPath}`,
    emulatorPath, avdManagerPath,
  };
}

/** Names of the AVDs defined on this host. */
export async function listAvds(): Promise<{ ok: boolean; avds: string[]; detail: string }> {
  const support = emulatorSupport();
  if (!support.emulatorPath) return { ok: false, avds: [], detail: support.detail };

  const out = await new Promise<string>((resolve) => {
    const child = spawn(support.emulatorPath as string, ['-list-avds'], { timeout: 20_000 });
    let buf = '';
    child.stdout.on('data', (d) => { buf += String(d); });
    child.on('close', () => resolve(buf));
    child.on('error', () => resolve(''));
  });

  const avds = out.split('\n').map((l) => l.trim())
    .filter((l) => l.length > 0 && !/^INFO|^WARNING|^ERROR/i.test(l));
  return {
    ok: true,
    avds,
    detail: avds.length > 0 ? `${avds.length} AVD(s) defined` : 'No AVDs are defined on this host.',
  };
}

export interface BootResult {
  ok: boolean;
  serial: string | null;
  detail: string;
}

/**
 * Boots an AVD and waits for it to become usable.
 *
 * "Usable" means `sys.boot_completed` is set — not merely that adb sees the
 * device. An emulator answers adb long before its framework is up, and driving
 * it in that window produces spurious failures that look like app defects.
 */
export async function bootEmulator(avdName: string, timeoutMs = 180_000): Promise<BootResult> {
  const support = emulatorSupport();
  if (!support.emulatorPath) return { ok: false, serial: null, detail: support.detail };

  const before = await onlineEmulatorSerials();

  // Detached: the emulator process outlives this call by design.
  const child = spawn(
    support.emulatorPath,
    ['-avd', avdName, '-no-snapshot-save', '-no-boot-anim'],
    { detached: true, stdio: 'ignore' },
  );
  child.unref();

  const deadline = Date.now() + timeoutMs;
  let serial: string | null = null;

  // Find the serial that appeared as a result of this boot.
  while (Date.now() < deadline && !serial) {
    await delay(2_000);
    const now = await onlineEmulatorSerials();
    serial = now.find((s) => !before.includes(s)) ?? null;
  }
  if (!serial) {
    return { ok: false, serial: null, detail: `"${avdName}" did not appear on adb within ${Math.round(timeoutMs / 1000)}s.` };
  }

  while (Date.now() < deadline) {
    const r = await runAdb(['-s', serial, 'shell', 'getprop', 'sys.boot_completed'], 10_000);
    if (r.ok && r.stdout.trim() === '1') {
      return { ok: true, serial, detail: `"${avdName}" booted as ${serial}` };
    }
    await delay(2_000);
  }
  return {
    ok: false, serial,
    detail: `"${avdName}" appeared as ${serial} but never reported sys.boot_completed.`,
  };
}

/** Shuts an emulator down cleanly so the host is left as it was found. */
export async function shutdownEmulator(serial: string): Promise<{ ok: boolean; detail: string }> {
  const r = await runAdb(['-s', serial, 'emu', 'kill'], 20_000);
  return r.ok
    ? { ok: true, detail: `Shut down ${serial}` }
    : { ok: false, detail: `Could not shut down ${serial}: ${r.stderr || 'no output'}` };
}

async function onlineEmulatorSerials(): Promise<string[]> {
  const r = await runAdb(['devices'], 15_000);
  if (!r.ok) return [];
  return r.stdout.split('\n')
    .map((l) => l.trim())
    .filter((l) => /^emulator-\d+\s+device$/.test(l))
    .map((l) => l.split(/\s+/)[0]);
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
