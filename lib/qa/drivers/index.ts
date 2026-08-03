import { AndroidDriver } from './android/android-driver';
import type { DeviceDriver, Platform } from './types';

export type {
  Action, Artefact, Bounds, DeviceDriver, DeviceInfo, DeviceMetrics,
  DriverCapabilities, DriverResult, ElementRole, HttpExchange, LaunchResult,
  LogLine, NamedKey, Orientation, Platform, RecordingHandle, UiElement, UiTree,
} from './types';
export { emptyMetrics, ok, fail, unsupported } from './types';
export { AndroidDriver } from './android/android-driver';
export { toUiTree, interactiveElements, roleForClass } from './android/hierarchy';
export {
  bootEmulator, shutdownEmulator, listAvds, emulatorSupport,
} from './android/emulator';

/**
 * Driver registry.
 *
 * The one place that decides which implementation drives a target. Phase 4 adds
 * an `IosDriver` here and nothing above the driver layer changes; a web driver
 * wrapping Playwright slots in the same way.
 *
 * A platform with no implementation returns null rather than a stub. A stub would
 * satisfy the type and then quietly produce empty observations, which is how a
 * run ends up reporting results for a target it never touched.
 */
export interface DriverRequest {
  platform: Platform;
  /** adb serial, iOS UDID, or browser context id. */
  targetId: string;
}

export interface DriverResolution {
  driver: DeviceDriver | null;
  /** Why no driver exists, when `driver` is null. */
  reason: string;
}

export function createDriver(request: DriverRequest): DriverResolution {
  switch (request.platform) {
    case 'android':
      return { driver: new AndroidDriver(request.targetId), reason: '' };

    case 'ios':
      return {
        driver: null,
        reason:
          'No iOS driver is implemented. Driving an iOS app requires XCUITest, '
          + 'WebDriverAgent or libimobiledevice on a macOS host with Xcode. Until one is '
          + 'added, iOS targets are reported as unsupported rather than estimated.',
      };

    case 'web':
      return {
        driver: null,
        reason:
          'Web execution currently runs through the Playwright engine directly rather '
          + 'than a DeviceDriver. A WebDriver wrapper is planned so the same planning and '
          + 'reporting layers apply to browsers.',
      };

    default:
      return { driver: null, reason: `Unknown platform "${request.platform}".` };
  }
}

/** Platforms that have a working driver right now. */
export function implementedPlatforms(): Platform[] {
  return (['android', 'ios', 'web'] as Platform[])
    .filter((p) => createDriver({ platform: p, targetId: 'probe' }).driver !== null);
}
