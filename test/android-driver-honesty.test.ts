import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { AndroidDriver } from '@/lib/qa/drivers/android/android-driver';

/**
 * AndroidDriver behaviour against an UNREACHABLE device.
 *
 * These assertions are deterministic and need no hardware: they use a serial
 * that cannot exist, so every operation must fail. That is precisely the case
 * where a driver is tempted to return plausible-looking empties — an all-zero
 * metrics object, or an empty hierarchy that reads as "the screen was blank".
 * Both would put fabricated data in a report, so the contract is that failure is
 * reported as absence.
 */

const UNREACHABLE = 'no-such-device-9999';

describe('AndroidDriver reports absence, never substitutes values', () => {
  test('healthCheck fails with the underlying adb reason', async () => {
    const d = new AndroidDriver(UNREACHABLE);
    const health = await d.healthCheck();
    assert.equal(health.ok, false);
    assert.ok(health.detail.includes(UNREACHABLE), 'the reason must name the device');
    await d.dispose();
  });

  test('hierarchy returns null rather than an empty tree', async () => {
    const d = new AndroidDriver(UNREACHABLE);
    // null means "could not observe"; an empty tree would mean "observed nothing
    // on screen", which the functional checks would report as a blank-render bug.
    assert.equal(await d.hierarchy(), null);
    await d.dispose();
  });

  test('screenshot returns null rather than a placeholder image', async () => {
    const d = new AndroidDriver(UNREACHABLE);
    assert.equal(await d.screenshot(), null);
    await d.dispose();
  });

  test('every metric is null — no zeros leak into the report', async () => {
    const d = new AndroidDriver(UNREACHABLE);
    const m = await d.metrics('com.example.app');
    const leaked = Object.entries(m).filter(([k, v]) => k !== 'capturedAt' && v !== null);
    assert.deepEqual(leaked, [], `expected all-null metrics, got ${JSON.stringify(leaked)}`);
    // capturedAt is still a real timestamp: we did attempt the read.
    assert.equal(typeof m.capturedAt, 'number');
    await d.dispose();
  });

  test('package size is null when the package cannot be queried', async () => {
    const d = new AndroidDriver(UNREACHABLE);
    assert.equal(await d.packageSizeBytes('com.example.app'), null);
    await d.dispose();
  });

  test('logs return an empty array, which is honest for "no logs read"', async () => {
    const d = new AndroidDriver(UNREACHABLE);
    assert.deepEqual(await d.logs(), []);
    await d.dispose();
  });
});

describe('AndroidDriver capability declaration', () => {
  test('declares network capture as unsupported instead of returning fake traffic', async () => {
    const d = new AndroidDriver(UNREACHABLE);
    assert.equal(d.capabilities().networkCapture, false);
    assert.deepEqual(await d.networkTraffic(), []);
    await d.dispose();
  });

  test('declares the capabilities the mandate requires of Android', () => {
    const caps = new AndroidDriver(UNREACHABLE).capabilities();
    for (const c of ['install', 'uninstall', 'clearData', 'launch', 'terminate',
      'hierarchy', 'screenshot', 'recording', 'logs', 'setLocale',
      'setOrientation', 'deepLinks'] as const) {
      assert.equal(caps[c], true, `Android must support ${c}`);
    }
    for (const m of ['memory', 'cpu', 'gpu', 'battery', 'storage', 'frames', 'network'] as const) {
      assert.equal(caps.metrics[m], true, `Android must read ${m} metrics`);
    }
  });

  test('refuses an App Bundle at the driver level with a specific reason', async () => {
    const d = new AndroidDriver(UNREACHABLE);
    const r = await d.install({ path: '/tmp/app.aab' });
    assert.equal(r.ok, false);
    assert.equal(r.unsupported, true, 'a bundle is unsupported, not a transient failure');
    assert.match(r.detail, /bundletool/i);
    await d.dispose();
  });

  test('rejects a malformed locale before touching the device', async () => {
    const d = new AndroidDriver(UNREACHABLE);
    const r = await d.setLocale('not-a-locale');
    assert.equal(r.ok, false);
    assert.match(r.detail, /BCP-47/);
    await d.dispose();
  });
});
