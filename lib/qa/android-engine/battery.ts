import type { Finding } from './types';
import { batteryDump, wakeLocks, runningServices, batteryStatsFor } from './device';

/**
 * Battery and background-activity analysis.
 *
 * Reads real platform state: battery level/temperature from `dumpsys battery`,
 * held wake locks from `dumpsys power`, and foreground/background services
 * from `dumpsys activity services`. Findings are only raised for conditions
 * the platform itself reports — nothing is extrapolated into a "drain score".
 */

export interface BatterySample {
  levelPct: number | null;
  temperatureC: number | null;
  charging: boolean;
  at: number;
}

export function parseBattery(out: string): BatterySample {
  const level = /level:\s*(\d+)/.exec(out);
  const temp = /temperature:\s*(\d+)/.exec(out);
  const status = /status:\s*(\d+)/.exec(out);
  const plugged = /powered:\s*(true|false)/i.exec(out) ?? /AC powered:\s*(true|false)/i.exec(out);
  return {
    levelPct: level ? Number(level[1]) : null,
    // dumpsys reports tenths of a degree Celsius.
    temperatureC: temp ? Number(temp[1]) / 10 : null,
    charging: status ? status[1] === '2' : (plugged ? plugged[1].toLowerCase() === 'true' : false),
    at: Date.now(),
  };
}

export async function sampleBattery(serial: string): Promise<BatterySample> {
  return parseBattery(await batteryDump(serial));
}

/** Wake locks the app itself holds, parsed from dumpsys power. */
function appWakeLocks(raw: string, pkg: string): string[] {
  return raw
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.includes(pkg))
    .slice(0, 20);
}

function foregroundServices(raw: string, pkg: string): string[] {
  return raw
    .split('\n')
    .filter((l) => /ServiceRecord|isForeground=true|app=ProcessRecord/.test(l) && l.includes(pkg))
    .map((l) => l.trim())
    .slice(0, 20);
}

export interface BatteryReport {
  start: BatterySample;
  end: BatterySample;
  drainPct: number | null;
  findings: Finding[];
}

export async function analyzeBattery(
  serial: string,
  pkg: string,
  moduleLabel: string,
  screenName: string,
  start: BatterySample,
  durationMs: number,
): Promise<BatteryReport> {
  const findings: Finding[] = [];
  const end = await sampleBattery(serial);

  const drain =
    start.levelPct != null && end.levelPct != null && !start.charging && !end.charging
      ? start.levelPct - end.levelPct
      : null;

  // Wake locks held by the app while it is only being browsed.
  const locksRaw = await wakeLocks(serial, pkg);
  const locks = appWakeLocks(locksRaw, pkg);
  if (locks.length > 0) {
    findings.push({
      type: 'battery',
      module: moduleLabel,
      severity: 'medium',
      title: `App holds ${locks.length} wake lock(s) during normal use`,
      description: 'Wake locks attributed to the app were held while it was merely being navigated, which prevents the device from sleeping.',
      screenName,
      activity: '',
      stepsToReproduce: ['Launch and navigate the app', 'Run: adb shell dumpsys power | grep -i wakelock'],
      expectedResult: 'No long-lived wake locks are held for ordinary UI browsing.',
      actualResult: `Wake locks present:\n${locks.slice(0, 5).join('\n')}`,
      evidence: locksRaw.slice(0, 2000),
      rootCause: 'A PARTIAL_WAKE_LOCK is acquired without a matching release, or a library (player/sync) keeps the CPU awake beyond its task.',
      suggestedFix: 'Audit PowerManager.WakeLock acquire/release pairing, prefer WorkManager for deferred work, and use setKeepScreenOn only while media is actually playing.',
    });
  }

  // Foreground services running when the user is just browsing.
  const svcRaw = await runningServices(serial, pkg);
  const svcs = foregroundServices(svcRaw, pkg);
  if (svcs.length > 2) {
    findings.push({
      type: 'battery',
      module: moduleLabel,
      severity: 'low',
      title: `${svcs.length} background/foreground service(s) active`,
      description: 'Multiple services were running while the app was being browsed, which contributes to background battery usage.',
      screenName,
      activity: '',
      stepsToReproduce: ['Launch the app', `Run: adb shell dumpsys activity services ${pkg}`],
      expectedResult: 'Only services required by the current user task are running.',
      actualResult: `${svcs.length} service records active.`,
      evidence: svcRaw.slice(0, 2000),
      rootCause: 'Services are started eagerly rather than on demand, or are not stopped when their work completes.',
      suggestedFix: 'Move deferrable work to WorkManager, stop services via stopSelf() on completion, and avoid foreground services for non-user-visible tasks.',
    });
  }

  // Only report drain when the sample window is long enough to be meaningful.
  if (drain != null && drain >= 2 && durationMs > 3 * 60_000) {
    const perHour = (drain / (durationMs / 3_600_000));
    if (perHour > 20) {
      findings.push({
        type: 'battery',
        module: moduleLabel,
        severity: 'medium',
        title: `Battery drained ${drain}% in ${Math.round(durationMs / 60000)} min (~${perHour.toFixed(0)}%/hour)`,
        description: 'Measured battery level dropped notably during the exploration session while on battery power.',
        screenName,
        activity: '',
        stepsToReproduce: ['Unplug the device', 'Use the app continuously', 'Run: adb shell dumpsys battery'],
        expectedResult: 'Ordinary UI browsing does not drain the battery at an extreme rate.',
        actualResult: `Level went ${start.levelPct}% → ${end.levelPct}% over ${Math.round(durationMs / 60000)} minutes.`,
        evidence: (await batteryStatsFor(serial, pkg)).slice(0, 2500),
        rootCause: 'Sustained CPU/GPU/network activity, wake locks, or high-frequency location updates.',
        suggestedFix: 'Profile with Battery Historian, batch network requests, lower location update frequency, and remove polling loops.',
      });
    }
  }

  if (end.temperatureC != null && end.temperatureC > 45) {
    findings.push({
      type: 'battery',
      module: moduleLabel,
      severity: 'medium',
      title: `Device temperature reached ${end.temperatureC.toFixed(1)}°C`,
      description: 'The battery temperature rose above the comfortable operating range while the app was under test, which typically indicates sustained load and can trigger thermal throttling.',
      screenName,
      activity: '',
      stepsToReproduce: ['Use the app continuously', 'Run: adb shell dumpsys battery'],
      expectedResult: 'Temperature stays within a normal range during ordinary use.',
      actualResult: `Battery temperature ${end.temperatureC.toFixed(1)}°C.`,
      evidence: `start=${start.temperatureC ?? 'n/a'}°C end=${end.temperatureC.toFixed(1)}°C over ${Math.round(durationMs / 1000)}s`,
      rootCause: 'Sustained CPU/GPU work — often continuous rendering, decoding, or a busy loop.',
      suggestedFix: 'Reduce sustained main-thread and GPU work; verify animations stop when off-screen.',
    });
  }

  return { start, end, drainPct: drain, findings };
}
