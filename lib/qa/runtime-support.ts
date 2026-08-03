import { adbAvailable, listDevices } from '@/lib/qa/adb';
import type { QaSourceType } from '@/lib/types';

/**
 * Runtime support resolution — the gate that replaced the simulated engine.
 *
 * Before this existed, any target the platform could not actually drive (an IPA,
 * a store URL, an APK with no device attached) was handed to a "simulated"
 * engine that produced random pass/fail verdicts, canned bugs from a template
 * bank and drawn SVG "screenshots". Those runs rendered in the report exactly
 * like real ones, so a reader could not tell a measurement from an invention.
 *
 * The rule now: a run either executes against the real target, or it terminates
 * as BLOCKED with the precise reason and the steps needed to unblock it. There
 * is no third option and no fabricated middle ground.
 *
 * Every decision here is based on a live probe of the host and the attached
 * hardware — never on an assumption about what is installed.
 */

/** How a run may proceed, or exactly why it may not. */
export type RuntimeDecision =
  | {
    kind: 'execute';
    engine: 'android_device' | 'web_browser';
    /** Resolved device serial for device-backed execution. */
    serial?: string;
    detail: string;
  }
  | {
    /** The platform supports this target, but no runtime is attached right now. */
    kind: 'blocked_no_runtime';
    reason: string;
    remediation: string[];
  }
  | {
    /** The platform cannot drive this target type at all, yet. */
    kind: 'unsupported_platform';
    reason: string;
    remediation: string[];
  }
  | {
    /** The runtime exists in principle but the host is missing a dependency. */
    kind: 'runtime_unavailable';
    reason: string;
    remediation: string[];
  };

export type BlockedDecision = Exclude<RuntimeDecision, { kind: 'execute' }>;

export function isBlocked(d: RuntimeDecision): d is BlockedDecision {
  return d.kind !== 'execute';
}

/** Source types that need a real Android device or emulator over adb. */
const ANDROID_SOURCES: QaSourceType[] = ['apk', 'installed_app', 'play_store_url'];
/** Source types that run in a real browser. */
const WEB_SOURCES: QaSourceType[] = ['web_app', 'web_url'];
/** Source types that need an iOS runtime, which is not implemented yet. */
const IOS_SOURCES: QaSourceType[] = ['ipa', 'app_store_url'];

/**
 * Resolves how (or whether) a target can be executed.
 *
 * @param sourceType  the project's declared source type
 * @param sourceRef   URL or file reference, used to tell a real URL from a name
 * @param opts.binaryPath      stored APK/AAB path, when one was uploaded
 * @param opts.requestedSerial device the user picked on QA → Devices
 */
export async function resolveRuntime(
  sourceType: QaSourceType,
  sourceRef: string,
  opts: { binaryPath?: string | null; requestedSerial?: string | null } = {},
): Promise<RuntimeDecision> {
  // ---------------------------------------------------------------- iOS
  if (IOS_SOURCES.includes(sourceType)) {
    return {
      kind: 'unsupported_platform',
      reason:
        'iOS execution is not implemented. This platform has no XCUITest, WebDriverAgent or '
        + 'libimobiledevice driver, so an iOS app cannot be installed, launched or inspected. '
        + 'No results are produced for iOS targets rather than estimated ones.',
      remediation: [
        'Run the app on a macOS host with Xcode installed.',
        'Add an iOS device driver (XCUITest runner, WebDriverAgent, or libimobiledevice) to the platform.',
        'Until then, use the Web or Android paths, which execute against real runtimes.',
      ],
    };
  }

  // ------------------------------------------------------------ Web / URL
  if (WEB_SOURCES.includes(sourceType)) {
    if (!/^https?:\/\//i.test(sourceRef)) {
      return {
        kind: 'blocked_no_runtime',
        reason:
          `"${sourceRef || '(empty)'}" is not a URL a browser can open, so nothing can be navigated to. `
          + 'A web target must be an absolute http:// or https:// address.',
        remediation: ['Re-submit the run with a full URL, e.g. https://example.com.'],
      };
    }
    const browser = await browserRuntimeAvailable();
    if (!browser.ok) {
      return {
        kind: 'runtime_unavailable',
        reason: `A real browser could not be started: ${browser.detail}`,
        remediation: [
          'Install the Playwright browsers on the host: npx playwright install chromium',
          'Confirm the host has the shared libraries Chromium needs (npx playwright install-deps).',
        ],
      };
    }
    return { kind: 'execute', engine: 'web_browser', detail: `Real headless Chromium against ${sourceRef}` };
  }

  // -------------------------------------------------------------- Android
  if (ANDROID_SOURCES.includes(sourceType)) {
    // ARTEFACT problems are diagnosed FIRST, because they are intrinsic to what
    // was submitted and hold no matter how many devices are attached. Checking
    // device availability first meant an App Bundle was reported as "no device
    // connected" — misleading, and it sends the user to plug in a phone that
    // would not have helped.
    if (sourceType === 'play_store_url') {
      return {
        kind: 'blocked_no_runtime',
        reason:
          'A Play Store URL only identifies an app; it does not provide an installable binary. '
          + 'The platform does not download from the Play Store, so there is nothing to execute.',
        remediation: [
          'Install the app on the device, then start the run with source type "Installed App".',
          'Or upload the APK directly.',
        ],
      };
    }

    if (sourceType === 'apk') {
      if (opts.binaryPath && /\.aab$/i.test(opts.binaryPath)) {
        return {
          kind: 'runtime_unavailable',
          reason:
            'The uploaded artefact is an Android App Bundle (.aab). adb cannot install a bundle; '
            + 'it must first be converted into device-specific APKs with bundletool, which is not '
            + 'installed on this host.',
          remediation: [
            'Upload a universal or device-specific .apk instead.',
            'Or install bundletool on the host so bundles can be converted before installation.',
          ],
        };
      }
      if (!opts.binaryPath) {
        return {
          kind: 'blocked_no_runtime',
          reason: 'No APK binary was stored for this project, so there is nothing to install on the device.',
          remediation: ['Re-upload the .apk file and start the run again.'],
        };
      }
    }

    if (!(await adbAvailable())) {
      return {
        kind: 'runtime_unavailable',
        reason:
          'The Android Debug Bridge (adb) is not available on this host, so no device can be '
          + 'installed to, launched, inspected or screenshotted.',
        remediation: [
          'Install Android platform-tools and ensure `adb` is on PATH.',
          'Or set ANDROID_HOME / ANDROID_SDK_ROOT so the platform can locate adb.',
        ],
      };
    }

    const online = (await listDevices()).filter((d) => d.status === 'online');
    if (online.length === 0) {
      return {
        kind: 'blocked_no_runtime',
        reason:
          'No Android device or emulator is connected, so the app cannot be executed. '
          + 'A device-backed run requires real hardware or a running emulator — results are never '
          + 'estimated in its absence.',
        remediation: [
          'Connect a device over USB with USB debugging enabled, and accept the debugging prompt.',
          'Or pair a device over Wi-Fi from QA → Devices.',
          'Or start an Android emulator on this host.',
        ],
      };
    }

    const target = opts.requestedSerial
      ? online.find((d) => d.id === opts.requestedSerial)
      : online[0];
    if (!target) {
      return {
        kind: 'blocked_no_runtime',
        reason:
          `The selected device "${opts.requestedSerial}" is no longer connected. `
          + 'The run was not redirected to a different device, because a run must execute on the '
          + 'device it was scoped to.',
        remediation: [
          'Reconnect that device, or pick one of the currently connected devices on QA → Devices.',
        ],
      };
    }

    return {
      kind: 'execute',
      engine: 'android_device',
      serial: target.id,
      detail: `Real device execution on ${target.name} (${target.id})`,
    };
  }

  // --------------------------------------------------- Anything else (flutter,
  // desktop, unknown). Flutter/React Native ship AS an APK or IPA; a bare
  // "flutter" selection carries no artefact this platform can drive.
  return {
    kind: 'unsupported_platform',
    reason:
      `Source type "${sourceType}" has no execution driver on this platform, so it cannot be tested. `
      + 'A Flutter or React Native app must be submitted as the .apk it builds into (Android) — '
      + 'desktop targets have no driver at all.',
    remediation: [
      'For Flutter/React Native on Android: upload the built .apk and select "Android APK".',
      'For web builds: submit the deployed URL and select "Web URL".',
      'Desktop application testing is not implemented.',
    ],
  };
}

/**
 * Probes whether a real browser can actually be launched, rather than assuming
 * the dependency is present. Cheap: it launches and immediately closes.
 */
async function browserRuntimeAvailable(): Promise<{ ok: boolean; detail: string }> {
  try {
    const { chromium } = await import('playwright');
    const browser = await chromium.launch({ headless: true });
    const version = browser.version();
    await browser.close();
    return { ok: true, detail: `Chromium ${version}` };
  } catch (e) {
    return { ok: false, detail: (e as Error)?.message?.slice(0, 200) ?? 'unknown error' };
  }
}

/** One-line summary used for the run's error message and log. */
export function describeBlocked(d: BlockedDecision): string {
  const label = d.kind === 'blocked_no_runtime'
    ? 'BLOCKED — no runtime'
    : d.kind === 'unsupported_platform'
      ? 'BLOCKED — unsupported platform'
      : 'BLOCKED — runtime unavailable';
  return `${label}: ${d.reason}`;
}
