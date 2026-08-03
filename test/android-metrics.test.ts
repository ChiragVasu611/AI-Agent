import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseBatteryDump, parseCpuPercentages, parseFrameStats, parseFreeBytes,
  parseGpuMemoryKb, parseHeapKb, parseNetworkTransport, parsePackagePaths,
  parseTotalPssKb, sumApkSizes,
} from '@/lib/qa/drivers/android/metrics';

/**
 * These fixtures are VERBATIM output captured from a real device
 * (moto g45 5G, Android 15, 720x1600) while the app under test was running.
 * Using synthetic strings here would only prove the regexes match themselves.
 */

const MEMINFO = `
Applications Memory Usage (in Kilobytes):
Uptime: 1791234 Realtime: 1791234

** MEMINFO in pid 8081 [aiimagegenerator.aiart.animefilter] **
                   Pss      Pss   Shared  Private   Private     Swap      Rss     Heap
                 Total    Clean    Dirty    Dirty      Clean    Dirty    Total     Size
  Native Heap    31385    31312        0       32    32928    58400    44263    14136
           Java Heap:    39828                          53608
         Native Heap:    31312                          32928
           TOTAL PSS:   210852            TOTAL RSS:   378076       TOTAL SWAP PSS:      237
`;

const GFXINFO = `
Applications Graphics Acceleration Info:
Uptime: 1791543 Realtime: 1791543

** Graphics info for pid 8081 [aiimagegenerator.aiart.animefilter] **

Total frames rendered: 1
Janky frames: 1 (100.00%)
Janky frames (legacy): 1 (100.00%)
50th percentile: 18ms
Total GPU memory usage:
  0 bytes, 0.00 bytes (0.00 bytes is purgeable)
`;

const GFXINFO_WITH_GPU = `
Total frames rendered: 4213
Janky frames: 142 (3.37%)
Total GPU memory usage:
  8388608 bytes, 8.00 MB (0.00 bytes is purgeable)
`;

const BATTERY = `Current Battery Service state:
  AC powered: false
  USB powered: false
  Wireless powered: false
  level: 65
  scale: 100
  temperature: 312
`;

const DF = `Filesystem       1K-blocks     Used Available Use% Mounted on
/dev/block/dm-51 116588524 68340188  48117264  59% /storage/emulated/0/Android/obb
`;

const PM_PATH = `package:/data/app/~~krFEiGjoid7YYC5Xw2ZG2g==/aiimagegenerator.aiart.animefilter-ZFgQzm2v8RUoYQ3w0eNbVw==/base.apk
package:/data/app/~~krFEiGjoid7YYC5Xw2ZG2g==/aiimagegenerator.aiart.animefilter-ZFgQzm2v8RUoYQ3w0eNbVw==/split_config.arm64_v8a.apk
`;

const CONNECTIVITY = `Active default network: 101
  NetworkAgentInfo{network{101} ni{WIFI CONNECTED extra: } nc{[ Transports: WIFI Capabilities: NOT_METERED&INTERNET]}}
`;

describe('memory parsing', () => {
  test('reads TOTAL PSS from real meminfo output', () => {
    assert.equal(parseTotalPssKb(MEMINFO), 210852);
  });

  test('reads Java and Native heap from the summary block', () => {
    // Must pick the summary lines (39828 / 31312), not the wide table row.
    assert.deepEqual(parseHeapKb(MEMINFO), { java: 39828, native: 31312 });
  });

  test('returns null rather than 0 when memory was not reported', () => {
    assert.equal(parseTotalPssKb(''), null);
    assert.deepEqual(parseHeapKb('nothing useful'), { java: null, native: null });
  });
});

describe('frame statistics', () => {
  test('reads the platform-reported janky percentage', () => {
    assert.deepEqual(parseFrameStats(GFXINFO), { total: 1, jankyPct: 100 });
    assert.deepEqual(parseFrameStats(GFXINFO_WITH_GPU), { total: 4213, jankyPct: 3.37 });
  });

  test('missing frame stats are null, not zero', () => {
    assert.deepEqual(parseFrameStats(''), { total: null, jankyPct: null });
  });
});

describe('GPU memory', () => {
  test('reads the byte count from the line after the header', () => {
    assert.equal(parseGpuMemoryKb(GFXINFO_WITH_GPU), 8192);
  });

  test('an idle app reporting zero bytes is zero, not null', () => {
    // Distinguishing "reported 0" from "did not report" matters for the report.
    assert.equal(parseGpuMemoryKb(GFXINFO), 0);
  });

  test('absent GPU section yields null', () => {
    assert.equal(parseGpuMemoryKb('Total frames rendered: 5'), null);
  });
});

describe('battery', () => {
  test('reads level and converts tenths-of-a-degree to Celsius', () => {
    const b = parseBatteryDump(BATTERY);
    assert.equal(b.levelPct, 65);
    assert.equal(b.temperatureC, 31.2);
    assert.equal(b.charging, false);
  });

  test('detects charging from any power source', () => {
    assert.equal(parseBatteryDump('  AC powered: true\n  level: 50').charging, true);
    assert.equal(parseBatteryDump('  USB powered: true\n  level: 50').charging, true);
  });

  test('charging is null when the dump says nothing about power', () => {
    assert.equal(parseBatteryDump('  level: 50').charging, null);
  });
});

describe('storage', () => {
  test('reads free bytes from df, skipping the header', () => {
    assert.equal(parseFreeBytes(DF), 48117264 * 1024);
  });

  test('sums every APK split, not just the base', () => {
    // Real measurement: base 71,043,468 + split 31,459,199 = 102,502,667.
    assert.equal(sumApkSizes('71043468\n31459199\n'), 102502667);
  });

  test('extracts all package paths including splits', () => {
    const paths = parsePackagePaths(PM_PATH);
    assert.equal(paths.length, 2);
    assert.ok(paths[0].endsWith('base.apk'));
    assert.ok(paths[1].endsWith('split_config.arm64_v8a.apk'));
    assert.ok(paths.every((p) => !p.startsWith('package:')));
  });

  test('no readable sizes yields null instead of 0', () => {
    assert.equal(sumApkSizes(''), null);
    assert.equal(parseFreeBytes(''), null);
  });
});

describe('cpu', () => {
  test('attributes a percentage to the app and the system total', () => {
    const cpuinfo = '  12% 8081/aiimagegenerator.aiart.animefilter: 8% user + 3.5% kernel\n'
      + '  45% TOTAL: 20% user + 15% kernel';
    const r = parseCpuPercentages(cpuinfo, 'aiimagegenerator.aiart.animefilter');
    assert.equal(r.appPct, 12);
    assert.equal(r.totalPct, 45);
  });

  test('app percentage is null when the app has no cpuinfo line', () => {
    const r = parseCpuPercentages('  45% TOTAL: 20% user', 'com.absent.app');
    assert.equal(r.appPct, null);
    assert.equal(r.totalPct, 45);
  });
});

describe('network transport', () => {
  test('reads the transport, not the numeric network id', () => {
    // "Active default network: 101" is an ID — reporting it as the type would
    // put "101" in the run report where "WIFI" belongs.
    assert.equal(parseNetworkTransport(CONNECTIVITY), 'WIFI');
  });

  test('normalises CELLULAR to MOBILE', () => {
    assert.equal(parseNetworkTransport('nc{[ Transports: CELLULAR ]}'), 'MOBILE');
  });

  test('falls back to the ni{} block on older builds', () => {
    assert.equal(parseNetworkTransport('ni{WIFI CONNECTED extra: }'), 'WIFI');
  });

  test('undeterminable transport is null', () => {
    assert.equal(parseNetworkTransport('Active default network: 101'), null);
  });
});
