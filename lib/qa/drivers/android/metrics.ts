/**
 * Android metric parsers.
 *
 * Every parser here was written against output captured from a real device
 * (moto g45 5G, Android 15) and returns `null` for anything the platform did not
 * report. A missing value is a fact worth preserving — substituting zero would
 * turn "not measured" into "measured as none", which the report would then
 * present as a result.
 *
 * Pure functions on purpose: they are unit-tested without a device.
 */

/** `TOTAL PSS:   210852            TOTAL RSS:   378076` */
export function parseTotalPssKb(meminfo: string): number | null {
  const m = /TOTAL PSS:\s*(\d+)/i.exec(meminfo);
  return m ? Number(m[1]) : null;
}

export function parseHeapKb(meminfo: string): { java: number | null; native: number | null } {
  // The summary block repeats the label with a single value:
  //   Java Heap:    39828
  //   Native Heap:  31312
  const java = /^\s*Java Heap:\s*(\d+)/im.exec(meminfo);
  const native = /^\s*Native Heap:\s*(\d+)/im.exec(meminfo);
  return { java: java ? Number(java[1]) : null, native: native ? Number(native[1]) : null };
}

/**
 * `Total frames rendered: 1` / `Janky frames: 1 (100.00%)`
 *
 * The percentage is taken from the platform's own figure rather than recomputed,
 * so the reported number is exactly what the render profiler concluded.
 */
export function parseFrameStats(gfxinfo: string): { total: number | null; jankyPct: number | null } {
  const total = /Total frames rendered:\s*(\d+)/i.exec(gfxinfo);
  const janky = /Janky frames:\s*\d+\s*\(([\d.]+)%\)/i.exec(gfxinfo);
  return {
    total: total ? Number(total[1]) : null,
    jankyPct: janky ? Number(janky[1]) : null,
  };
}

/**
 * ```
 * Total GPU memory usage:
 *   1234 bytes, 1.21 KB (0.00 bytes is purgeable)
 * ```
 * The byte count sits on the line AFTER the header.
 */
export function parseGpuMemoryKb(gfxinfo: string): number | null {
  const m = /Total GPU memory usage:\s*\r?\n\s*(\d+)\s*bytes/i.exec(gfxinfo);
  if (!m) return null;
  return Math.round(Number(m[1]) / 1024);
}

/** `df /data` → free kilobytes on the data partition. */
export function parseFreeBytes(df: string): number | null {
  const lines = df.trim().split('\n').slice(1); // drop the header
  for (const line of lines) {
    const cols = line.trim().split(/\s+/);
    // Filesystem 1K-blocks Used Available Use% Mounted
    if (cols.length >= 4) {
      const available = Number(cols[3]);
      if (Number.isFinite(available)) return available * 1024;
    }
  }
  return null;
}

/**
 * Sums every APK the package is installed from.
 *
 * A modern install is split (base + per-ABI + per-density), so reading only
 * `base.apk` under-reports real on-device size — measured 71 MB for the base
 * against 97.8 MB for the full set on the same app.
 */
export function sumApkSizes(statOutput: string): number | null {
  const sizes = statOutput.split('\n')
    .map((l) => Number(l.trim()))
    .filter((n) => Number.isFinite(n) && n > 0);
  if (sizes.length === 0) return null;
  return sizes.reduce((a, b) => a + b, 0);
}

/** `pm path <pkg>` → the list of APK paths, `package:` prefix stripped. */
export function parsePackagePaths(pmPath: string): string[] {
  return pmPath.split('\n')
    .map((l) => l.trim())
    .filter((l) => l.startsWith('package:'))
    .map((l) => l.slice('package:'.length).trim())
    .filter(Boolean);
}

/** `dumpsys battery` → level / temperature / charging state. */
export function parseBatteryDump(dump: string): {
  levelPct: number | null; temperatureC: number | null; charging: boolean | null;
} {
  const level = /^\s*level:\s*(\d+)/im.exec(dump);
  const temp = /^\s*temperature:\s*(\d+)/im.exec(dump);
  const ac = /^\s*AC powered:\s*(true|false)/im.exec(dump);
  const usb = /^\s*USB powered:\s*(true|false)/im.exec(dump);
  const wireless = /^\s*Wireless powered:\s*(true|false)/im.exec(dump);
  const charging = ac || usb || wireless
    ? [ac?.[1], usb?.[1], wireless?.[1]].some((v) => v === 'true')
    : null;
  return {
    levelPct: level ? Number(level[1]) : null,
    // dumpsys reports tenths of a degree Celsius.
    temperatureC: temp ? Number(temp[1]) / 10 : null,
    charging,
  };
}

/** `dumpsys cpuinfo` → percentage attributed to the app, and the system total. */
export function parseCpuPercentages(cpuinfo: string, packageName: string): {
  appPct: number | null; totalPct: number | null;
} {
  const escaped = packageName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const app = new RegExp(`([\\d.]+)%\\s+\\d*\\/?${escaped}`, 'i').exec(cpuinfo)
    ?? new RegExp(`([\\d.]+)%\\s+${escaped}`, 'i').exec(cpuinfo);
  const total = /([\d.]+)%\s+TOTAL/i.exec(cpuinfo);
  return {
    appPct: app ? Number(app[1]) : null,
    totalPct: total ? Number(total[1]) : null,
  };
}

/** `dumpsys connectivity` → the active transport, or null when undeterminable. */
export function parseNetworkTransport(connectivity: string): string | null {
  const nc = /\bTransports:\s*([A-Z_|&]+)/.exec(connectivity);
  if (nc) {
    const first = nc[1].split(/[|&]/)[0].trim().toUpperCase();
    if (first) return first === 'CELLULAR' ? 'MOBILE' : first;
  }
  const ni = /\bni\{(\w+)\s+CONNECTED/i.exec(connectivity);
  if (ni) {
    const t = ni[1].toUpperCase();
    return t === 'CELLULAR' || t === 'MOBILE' ? 'MOBILE' : t;
  }
  return null;
}
