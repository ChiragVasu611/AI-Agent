/**
 * The device chosen on QA → Devices, shared with the execution modules.
 *
 * Kept in localStorage rather than the database because the choice is tied to
 * the machine physically holding the USB cable, not to the user's account —
 * the same login on another workstation has different hardware attached.
 */

export const SELECTED_DEVICE_KEY = 'qa.selectedDeviceId';

/** Serial of the device the user picked, or null if none / not in a browser. */
export function getSelectedDeviceId(): string | null {
  if (typeof window === 'undefined') return null;
  const value = window.localStorage.getItem(SELECTED_DEVICE_KEY);
  return value && value.trim() ? value : null;
}

export function setSelectedDeviceId(serial: string): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(SELECTED_DEVICE_KEY, serial);
}

export function clearSelectedDeviceId(): void {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(SELECTED_DEVICE_KEY);
}

/**
 * Attach the chosen device to an outgoing run request. The server treats this
 * as a preference: if the serial is no longer attached, execution falls back to
 * whatever authorized device is connected rather than failing outright.
 */
export function attachSelectedDevice(formData: FormData): void {
  const serial = getSelectedDeviceId();
  if (serial) formData.set('deviceSerial', serial);
}
