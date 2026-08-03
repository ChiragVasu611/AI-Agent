/**
 * Prepares the application under test before a single step runs.
 *
 * Execution must never begin against a screen that is not the app under test,
 * so every path here ends in one of two states: the app is genuinely open and
 * in the foreground, or preparation failed with the concrete reason why.
 */

import { existsSync } from 'fs';
import {
  installApp, isPackageInstalled, launchApp, captureDeviceScreen, clearLogcat,
  packageFromPlayUrl, appIdFromAppStoreUrl, installFromPlayStore, hasInternet, clearAppData, keepDeviceAwake,
} from '@/lib/qa/android-bridge';

export interface PreparationStep {
  label: string;
  ok: boolean;
  detail: string;
}

export interface PreparationResult {
  ready: boolean;
  /** Ordered audit trail of what preparation actually did. */
  steps: PreparationStep[];
  packageName: string | null;
  /** First real capture once the app is up — proves the preview is genuine. */
  screenshot: string | null;
  /**
   * The launch frame, still in flight. Preparation is the longest phase of a
   * run and a `screencap` on a real device costs ~3s; awaiting it here delayed
   * the first sheet step by that much for an image nothing in step execution
   * depends on. The caller stores it when it arrives instead.
   */
  pendingScreenshot?: Promise<string | null>;
  /** Present only when ready === false. */
  blockedReason?: string;
  /**
   * `ready: false` but the app IS installed and launchable — only its readiness
   * could not be positively confirmed.
   *
   * These two situations were previously indistinguishable, and both took the
   * same path: blockAll(), marking every test case in the sheet BLOCKED before a
   * single step ran. That is wildly disproportionate for the common case that
   * causes it — an app that bounces to the launcher once during first-run
   * startup (ad SDK init, an OEM background killer, a permission activity
   * closing) and is perfectly usable a second later.
   *
   * Observed on a real 105MB app: install succeeded, launch succeeded, the app
   * dropped to the launcher mid-startup, and all three test cases were reported
   * BLOCKED with 0% progress having executed nothing.
   *
   * When this is true the caller should PROCEED with execution: the engine
   * re-anchors the app before every case and every step reports its own verdict,
   * so a genuinely dead app still fails honestly — case by case, with evidence —
   * instead of the whole sheet being written off up front.
   */
  recoverable?: boolean;
}

/**
 * Called as each preparation step COMPLETES, rather than the whole audit trail
 * being replayed once preparation returns.
 *
 * Install + reset + launch + readiness is comfortably 45-90s on a real device,
 * and the run log used to receive nothing at all until every one of them had
 * finished — so the UI looked frozen for the entire longest phase of the run,
 * which is most of what "execution does not start quickly" actually is.
 */
export type PreparationReporter = (step: PreparationStep) => void | Promise<void>;

function step(label: string, ok: boolean, detail: string): PreparationStep {
  return { label, ok, detail };
}

/** Record a step in the audit trail AND publish it immediately. */
async function emit(
  steps: PreparationStep[],
  report: PreparationReporter | undefined,
  s: PreparationStep,
): Promise<PreparationStep> {
  steps.push(s);
  await report?.(s);
  return s;
}

/**
 * APK on a real device: validate → install → verify → launch → wait for
 * foreground → first real capture.
 */
export async function prepareAndroidBinary(
  serial: string,
  filePath: string | null,
  packageName: string | null,
  fileName: string | null,
  report?: PreparationReporter,
): Promise<PreparationResult> {
  const steps: PreparationStep[] = [];

  // 1. Validate the uploaded artifact.
  if (!filePath || !existsSync(filePath)) {
    const detail = filePath
      ? `The uploaded binary is no longer on the server at ${filePath}. Re-upload it and start a new run.`
      : 'This run has no stored application binary. Runs created before binary persistence was added cannot be installed — re-upload the app and start a new run.';
    await emit(steps, report, step('Validate uploaded file', false, detail));
    return { ready: false, steps, packageName, screenshot: null, blockedReason: detail };
  }
  if (fileName?.toLowerCase().endsWith('.aab')) {
    const detail = 'Android App Bundles (.aab) cannot be installed by ADB. Convert it with `bundletool build-apks --mode=universal` and upload the resulting APK.';
    await emit(steps, report, step('Validate uploaded file', false, detail));
    return { ready: false, steps, packageName, screenshot: null, blockedReason: detail };
  }
  await emit(steps, report, step('Validate uploaded file', true, `${fileName ?? filePath} is present and installable.`));

  if (!packageName) {
    const detail = 'The package name could not be read from the uploaded APK, so the app cannot be launched or verified after install.';
    await emit(steps, report, step('Resolve package name', false, detail));
    return { ready: false, steps, packageName, screenshot: null, blockedReason: detail };
  }
  await emit(steps, report, step('Resolve package name', true, packageName));

  // 2. Install, overlapping the device housekeeping that does not depend on it.
  //
  // Pushing a 100MB+ APK over adb is the single longest operation in the whole
  // run (~30s alone on a wireless link, before the device's own install work).
  // Clearing logcat and holding the screen awake need the device, not the app,
  // so they used to sit idle behind the install for no reason. Started here and
  // awaited after, they cost effectively nothing.
  await report?.(step('Install application', true, `Installing ${fileName ?? 'the APK'} on the device — this is the longest step of preparation.`));
  const housekeeping = Promise.all([
    clearLogcat(serial).catch(() => null),
    keepDeviceAwake(serial).catch(() => ({ ok: false, detail: 'Could not hold the screen awake.' })),
  ]);

  const install = await installApp(serial, filePath, packageName);
  await emit(steps, report, step('Install application', install.ok, install.message));
  if (!install.ok) {
    return { ready: false, steps, packageName, screenshot: null, blockedReason: install.message };
  }

  // No second `pm list packages` here: installApp already verifies the package
  // is present before reporting ok (see android-bridge.ts), so re-checking was a
  // duplicate adb round trip on the critical path.

  const [, awake] = await housekeeping;
  await emit(steps, report, step('Keep device awake for the run', awake.ok, awake.detail));

  return finishLaunch(serial, packageName, steps, report);
}

/**
 * Play Store URL: extract package → check connectivity → install (fully
 * automated, driving the real Play Store client via ADB) → launch.
 *
 * There is no legitimate API to download an arbitrary app's binary directly —
 * Google does not expose one, and pulling from third-party APK mirrors would
 * mean installing a binary Google never actually served. So this drives the
 * real "Install" button exactly as a person would; the only difference is
 * nobody has to tap it. Requires a signed-in Google account on the device.
 */
export async function prepareFromPlayStore(serial: string, url: string): Promise<PreparationResult> {
  const steps: PreparationStep[] = [];

  const pkg = packageFromPlayUrl(url);
  steps.push(step('Extract package name', Boolean(pkg), pkg ?? `Could not find an "id=" parameter in "${url}".`));
  if (!pkg) {
    const detail = `The Play Store URL "${url}" does not contain a package id, so the app cannot be resolved.`;
    return { ready: false, steps, packageName: null, screenshot: null, blockedReason: detail };
  }

  const online = await hasInternet(serial);
  steps.push(step('Verify internet connectivity', online, online ? 'Device reached 8.8.8.8.' : 'The device has no working internet connection.'));
  if (!online) {
    return { ready: false, steps, packageName: pkg, screenshot: null, blockedReason: 'The device is offline, so the Play Store cannot be used.' };
  }

  const installed = await isPackageInstalled(serial, pkg);
  steps.push(step('Check if already installed', true, installed ? `${pkg} is already installed.` : `${pkg} is not installed yet.`));

  if (!installed) {
    const result = await installFromPlayStore(serial, pkg);
    steps.push(step('Install from Play Store', result.ok, result.detail));
    if (!result.ok) {
      const shot = await captureDeviceScreen(serial);
      return { ready: false, steps, packageName: pkg, screenshot: shot, blockedReason: result.detail };
    }
  }

  return finishLaunch(serial, pkg, steps);
}

/** App Store flows need iOS tooling that is not present. */
export async function prepareFromAppStore(url: string): Promise<PreparationResult> {
  const appId = appIdFromAppStoreUrl(url);
  const detail = 'Installing and launching an iOS app from an App Store URL requires a connected iPhone/iPad plus libimobiledevice (`ideviceinstaller`) or Xcode device tooling. None of these are available on this host, so no iOS execution was attempted and no results were invented.';
  return {
    ready: false,
    packageName: appId,
    screenshot: null,
    steps: [
      step('Extract App ID', Boolean(appId), appId ?? `Could not find an "/idNNNNN" segment in "${url}".`),
      step('Connect to iOS device', false, detail),
    ],
    blockedReason: detail,
  };
}

/**
 * Shared tail: reset state, launch, wait for foreground, capture first frame.
 *
 * `clearLogcat` and `keepDeviceAwake` are NOT done here for the APK path — the
 * caller already ran them alongside the install. They stay here for callers
 * that reach this function without an install (the Play Store path).
 */
async function finishLaunch(
  serial: string,
  pkg: string,
  steps: PreparationStep[],
  report?: PreparationReporter,
): Promise<PreparationResult> {
  const alreadyAwake = steps.some((s) => s.label === 'Keep device awake for the run');
  if (!alreadyAwake) {
    await clearLogcat(serial).catch(() => {});
    const awake = await keepDeviceAwake(serial);
    await emit(steps, report, step('Keep device awake for the run', awake.ok, awake.detail));
  }

  // Reset to a genuine first-run state. Sheets describe one journey beginning
  // at fresh install; leftover state from a previous run would silently start
  // the journey partway through and fail every early case for the wrong reason.
  const reset = await clearAppData(serial, pkg);
  await emit(steps, report, step('Reset app to first-run state', reset.ok, reset.detail));

  const launch = await launchApp(serial, pkg);
  await emit(steps, report, step('Launch application', launch.ok, launch.message));
  if (!launch.ok) {
    // The app is installed and its launcher activity resolved — what failed is
    // the READINESS confirmation. That is recoverable, so preparation reports it
    // as a warning and execution continues; blocking the entire sheet here means
    // the user gets nothing at all from an app that is very often fine by the
    // time the first step runs.
    const installed = await isPackageInstalled(serial, pkg).catch(() => false);
    if (installed) {
      await emit(steps, report, step('Confirm app is loaded', false,
        `${launch.message} Execution will start anyway and re-check the app before each test case, so any genuine failure is reported per test case with evidence rather than blocking the whole sheet.`));
      return {
        ready: false,
        recoverable: true,
        steps,
        packageName: pkg,
        screenshot: null,
        pendingScreenshot: captureDeviceScreen(serial).catch(() => null),
        blockedReason: launch.message,
      };
    }
    return { ready: false, steps, packageName: pkg, screenshot: await captureDeviceScreen(serial), blockedReason: launch.message };
  }

  // Capture the launch frame WITHOUT waiting for it. A device screencap is ~3s
  // and the first sheet step does not depend on the image in any way; the caller
  // stores it whenever it lands.
  const pendingScreenshot = captureDeviceScreen(serial).catch(() => null);
  await emit(steps, report, step('Confirm app is loaded', true,
    'The application is running and interactive; execution of the sheet begins now.'));

  return { ready: true, steps, packageName: pkg, screenshot: null, pendingScreenshot };
}
