import type { QaDeviceInfo } from '@/lib/types';

/**
 * Device integration adapter interface. No real device farm (ADB, BrowserStack,
 * AWS Device Farm, Xcode simulators, etc.) is connected in this environment —
 * this stub is the seam where that integration plugs in later without
 * touching any UI or execution-engine code above it.
 */
export interface DeviceAdapter {
  listDevices(): Promise<QaDeviceInfo[]>;
  isConfigured(): boolean;
}

class StubDeviceAdapter implements DeviceAdapter {
  isConfigured() {
    return false;
  }

  async listDevices(): Promise<QaDeviceInfo[]> {
    return [];
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
  if (!_adapter) _adapter = new StubDeviceAdapter();
  return _adapter;
}
