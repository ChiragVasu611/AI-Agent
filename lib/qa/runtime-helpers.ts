import { QaLogEntry } from '@/lib/mongodb/models/QaLogEntry';

export function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export async function log(
  runId: string,
  source: 'automation' | 'logcat' | 'api' | 'error' | 'crash',
  level: 'debug' | 'info' | 'warn' | 'error',
  message: string,
) {
  await QaLogEntry.create({ runId, source, level, message });
}
