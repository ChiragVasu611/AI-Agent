'use server';

import { getCurrentUser } from '@/lib/auth/session';
import { restartAdb, reconnectDevice, readAdbLogs, resetAdbPathCache } from '@/lib/qa/device-detect';

export async function restartAdbServer() {
  const user = await getCurrentUser();
  if (!user) return { error: 'Not authenticated' };
  // The SDK may have been installed/moved since the last lookup.
  resetAdbPathCache();
  const r = await restartAdb();
  return r.ok ? { ok: true, output: r.output } : { error: r.output || 'Failed to restart the ADB server.' };
}

export async function reconnectQaDevice(serial: string) {
  const user = await getCurrentUser();
  if (!user) return { error: 'Not authenticated' };
  if (!serial) return { error: 'A device serial is required.' };
  const r = await reconnectDevice(serial);
  return r.ok ? { ok: true, output: r.output } : { error: r.output || 'Failed to reconnect the device.' };
}

export async function fetchAdbLogs(serial: string | null) {
  const user = await getCurrentUser();
  if (!user) return { error: 'Not authenticated' };
  const r = await readAdbLogs(serial, 300);
  return r.ok ? { ok: true, output: r.output } : { error: r.output || 'Failed to read ADB logs.' };
}
