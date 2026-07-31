'use server';

import { requireWorkspaceAction } from '@/lib/auth/require-workspace';
import { restartAdb, reconnectDevice, readAdbLogs, resetAdbPathCache } from '@/lib/qa/device-detect';

export async function restartAdbServer() {
  const gate = await requireWorkspaceAction('workspace:qa');
  if (!gate.ok) return { error: gate.error };
  // The SDK may have been installed/moved since the last lookup.
  resetAdbPathCache();
  const r = await restartAdb();
  return r.ok ? { ok: true, output: r.output } : { error: r.output || 'Failed to restart the ADB server.' };
}

export async function reconnectQaDevice(serial: string) {
  const gate = await requireWorkspaceAction('workspace:qa');
  if (!gate.ok) return { error: gate.error };
  if (!serial) return { error: 'A device serial is required.' };
  const r = await reconnectDevice(serial);
  return r.ok ? { ok: true, output: r.output } : { error: r.output || 'Failed to reconnect the device.' };
}

export async function fetchAdbLogs(serial: string | null) {
  const gate = await requireWorkspaceAction('workspace:qa');
  if (!gate.ok) return { error: gate.error };
  const r = await readAdbLogs(serial, 300);
  return r.ok ? { ok: true, output: r.output } : { error: r.output || 'Failed to read ADB logs.' };
}
