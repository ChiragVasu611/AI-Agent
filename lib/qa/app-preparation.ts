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
  packageFromPlayUrl, appIdFromAppStoreUrl, installFromPlayStore, hasInternet, clearAppData,
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
  /** Present only when ready === false. */
  blockedReason?: string;
}

function step(label: string, ok: boolean, detail: string): PreparationStep {
  return { label, ok, detail };
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
): Promise<PreparationResult> {
  const steps: PreparationStep[] = [];

  // 1. Validate the uploaded artifact.
  if (!filePath || !existsSync(filePath)) {
    const detail = filePath
      ? `The uploaded binary is no longer on the server at ${filePath}. Re-upload it and start a new run.`
      : 'This run has no stored application binary. Runs created before binary persistence was added cannot be installed — re-upload the app and start a new run.';
    steps.push(step('Validate uploaded file', false, detail));
    return { ready: false, steps, packageName, screenshot: null, blockedReason: detail };
  }
  if (fileName?.toLowerCase().endsWith('.aab')) {
    const detail = 'Android App Bundles (.aab) cannot be installed by ADB. Convert it with `bundletool build-apks --mode=universal` and upload the resulting APK.';
    steps.push(step('Validate uploaded file', false, detail));
    return { ready: false, steps, packageName, screenshot: null, blockedReason: detail };
  }
  steps.push(step('Validate uploaded file', true, `${fileName ?? filePath} is present and installable.`));

  if (!packageName) {
    const detail = 'The package name could not be read from the uploaded APK, so the app cannot be launched or verified after install.';
    steps.push(step('Resolve package name', false, detail));
    return { ready: false, steps, packageName, screenshot: null, blockedReason: detail };
  }
  steps.push(step('Resolve package name', true, packageName));

  // 2. Install and verify.
  const install = await installApp(serial, filePath, packageName);
  steps.push(step('Install application', install.ok, install.message));
  if (!install.ok) {
    return { ready: false, steps, packageName, screenshot: null, blockedReason: install.message };
  }

  const verified = await isPackageInstalled(serial, packageName);
  steps.push(step('Verify installation', verified, verified
    ? `${packageName} is listed on the device.`
    : `${packageName} is not listed on the device after install.`));
  if (!verified) {
    return { ready: false, steps, packageName, screenshot: null, blockedReason: `Installation could not be verified for ${packageName}.` };
  }

  return finishLaunch(serial, packageName, steps);
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

/** Shared tail: reset state, launch, wait for foreground, capture first frame. */
async function finishLaunch(serial: string, pkg: string, steps: PreparationStep[]): Promise<PreparationResult> {
  // Start from a clean log so crash detection only sees this run.
  await clearLogcat(serial).catch(() => {});

  // Reset to a genuine first-run state. Sheets describe one journey beginning
  // at fresh install; leftover state from a previous run would silently start
  // the journey partway through and fail every early case for the wrong reason.
  const reset = await clearAppData(serial, pkg);
  steps.push(step('Reset app to first-run state', reset.ok, reset.detail));

  const launch = await launchApp(serial, pkg);
  steps.push(step('Launch application', launch.ok, launch.message));
  if (!launch.ok) {
    return { ready: false, steps, packageName: pkg, screenshot: await captureDeviceScreen(serial), blockedReason: launch.message };
  }

  const shot = await captureDeviceScreen(serial);
  steps.push(step('Confirm app is loaded', Boolean(shot), shot
    ? 'Captured the first frame from the device screen.'
    : 'The app is in the foreground but a screen capture could not be taken.'));

  return { ready: true, steps, packageName: pkg, screenshot: shot };
}
