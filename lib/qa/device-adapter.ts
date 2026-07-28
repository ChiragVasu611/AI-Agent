import type { QaDeviceInfo } from '@/lib/types';
import { adbAvailable, listDevices as adbListDevices } from '@/lib/qa/adb';

/**
 * Device integration adapter interface. The active implementation is
 * AdbDeviceAdapter, which talks to a real Android Debug Bridge on the host
 * (see lib/qa/adb.ts). The interface remains the seam where other backends
 * (BrowserStack, AWS Device Farm, Xcode simulators) could plug in later.
 */
export interface DeviceAdapter {
  listDevices(): Promise<QaDeviceInfo[]>;
  isConfigured(): Promise<boolean>;
}

/** Real Android devices/emulators discovered through the adb CLI. */
class AdbDeviceAdapter implements DeviceAdapter {
  async isConfigured(): Promise<boolean> {
    return adbAvailable();
  }

  async listDevices(): Promise<QaDeviceInfo[]> {
    if (!(await adbAvailable())) return [];
    return adbListDevices();
  }
}

/** Names used only for the execution engine's simulated "currentDevice" field — not real inventory. */
export const SIMULATED_DEVICE_NAMES = [
  'Pixel 7 (Emulator, Android 14)',
  'Galaxy S23 (Emulator, Android 13)',
  'iPhone 15 (Simulator, iOS 17)',
  'iPhone 13 (Simulator, iOS 16)',
  'Chrome 124 (Web, Desktop)',
];

let _adapter: DeviceAdapter | null = null;
export function getDeviceAdapter(): DeviceAdapter {
  if (!_adapter) _adapter = new AdbDeviceAdapter();
  return _adapter;
}
