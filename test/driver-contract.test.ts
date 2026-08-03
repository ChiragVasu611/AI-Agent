import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { FakeDriver } from '@/lib/qa/drivers/fake/fake-driver';
import { pngSize } from '@/lib/qa/evidence/store';
import type { DeviceDriver } from '@/lib/qa/drivers/types';

/**
 * Contract tests for the driver seam.
 *
 * These run entirely against FakeDriver — no adb, no device, no network — which
 * is the whole point of the abstraction: the behaviour layered on top of a driver
 * becomes testable. The same assertions can be pointed at AndroidDriver or a
 * future IosDriver to confirm they honour the contract.
 */

function loginFlowDriver(): FakeDriver {
  return new FakeDriver({
    start: 'login',
    screens: [
      {
        name: 'login',
        context: 'com.fake.app/.LoginActivity',
        elements: [
          { label: 'Email', role: 'input', bounds: { left: 0, top: 100, right: 400, bottom: 180 } },
          { label: 'Sign in', role: 'button', bounds: { left: 0, top: 200, right: 400, bottom: 280 } },
        ],
        transitions: { 'Sign in': 'home' },
      },
      {
        name: 'home',
        context: 'com.fake.app/.HomeActivity',
        elements: [
          { label: 'Feed', role: 'list', bounds: { left: 0, top: 0, right: 400, bottom: 600 } },
          { label: 'Settings', role: 'button', bounds: { left: 0, top: 700, right: 400, bottom: 780 } },
        ],
        transitions: { Settings: 'settings' },
      },
      { name: 'settings', context: 'com.fake.app/.SettingsActivity', elements: [{ label: 'Log out', role: 'button' }] },
    ],
  });
}

describe('lifecycle contract', () => {
  test('records the lifecycle sequence a run performs', async () => {
    const d = loginFlowDriver();
    await d.install({ path: '/tmp/app.apk', applicationId: 'com.fake.app' });
    await d.clearData('com.fake.app');
    await d.launch('com.fake.app');
    assert.deepEqual(d.calls, ['install', 'clearData', 'launch']);
    assert.equal(await d.isForeground('com.fake.app'), true);
  });

  test('launch reports platform timing and the landed context', async () => {
    const d = loginFlowDriver();
    const r = await d.launch('com.fake.app');
    assert.equal(r.ok, true);
    assert.equal(r.context, 'com.fake.app/.LoginActivity');
    assert.equal(typeof r.totalTimeMs, 'number');
  });

  test('terminate clears the foreground app', async () => {
    const d = loginFlowDriver();
    await d.launch('com.fake.app');
    await d.terminate('com.fake.app');
    assert.equal(await d.isForeground('com.fake.app'), false);
  });
});

describe('unsupported operations are declared, not faked', () => {
  test('a disabled capability returns unsupported rather than a false success', async () => {
    const d = new FakeDriver({
      screens: [{ name: 's', context: 'c', elements: [] }],
      capabilities: { recording: false, setLocale: false, deepLinks: false },
    });

    assert.equal(d.capabilities().recording, false);
    assert.equal(await d.startRecording(), null);

    const locale = await d.setLocale('de-DE');
    assert.equal(locale.ok, false);
    assert.equal(locale.unsupported, true);
    // The locale must NOT have changed just because the call returned.
    assert.equal(d.currentLocale, 'en-US');

    const link = await d.openDeepLink('app://x');
    assert.equal(link.unsupported, true);
  });

  test('networkCapture is false and traffic is empty — never invented', async () => {
    const d = loginFlowDriver();
    assert.equal(d.capabilities().networkCapture, false);
    assert.deepEqual(await d.networkTraffic(), []);
  });
});

describe('observation contract', () => {
  test('hierarchy exposes normalised roles and the current context', async () => {
    const d = loginFlowDriver();
    const tree = await d.hierarchy();
    assert.ok(tree);
    assert.equal(tree!.context, 'com.fake.app/.LoginActivity');
    assert.deepEqual(tree!.elements.map((e) => e.role), ['input', 'button']);
    // Roles imply behaviour: an input is editable, a button is clickable.
    assert.equal(tree!.elements[0].editable, true);
    assert.equal(tree!.elements[1].clickable, true);
  });

  test('an unreadable screen returns null, distinct from an empty screen', async () => {
    const d = loginFlowDriver();
    d.setHierarchyUnavailable(true);
    assert.equal(await d.hierarchy(), null);

    const empty = new FakeDriver({ screens: [{ name: 'blank', context: 'c', elements: [] }] });
    const tree = await empty.hierarchy();
    assert.ok(tree, 'an empty screen still yields a tree');
    assert.equal(tree!.elements.length, 0);
  });

  test('screenshot returns real decodable PNG bytes', async () => {
    const d = loginFlowDriver();
    const buf = await d.screenshot();
    assert.ok(buf && buf.length > 0);
    // Must be a genuine PNG so hashing/dimension code behaves as in production.
    assert.deepEqual(pngSize(buf!), { width: 1, height: 1 });
  });

  test('metrics default to null, never to zero', async () => {
    const d = new FakeDriver({ screens: [{ name: 's', context: 'c', elements: [] }] });
    const m = await d.metrics();
    assert.equal(m.memoryPssKb, null);
    assert.equal(m.cpuAppPct, null);
    assert.equal(m.gpuMemoryKb, null);
    assert.equal(m.storageDataBytes, null);
    assert.equal(typeof m.capturedAt, 'number');
  });

  test('logs can be filtered by timestamp', async () => {
    const d = new FakeDriver({
      screens: [{ name: 's', context: 'c', elements: [] }],
      logs: [
        { at: 1000, level: 'info', tag: 'A', message: 'old' },
        { at: 5000, level: 'error', tag: 'B', message: 'new' },
      ],
    });
    assert.equal((await d.logs()).length, 2);
    const recent = await d.logs(2000);
    assert.equal(recent.length, 1);
    assert.equal(recent[0].message, 'new');
  });
});

describe('interaction contract', () => {
  test('records every action in order', async () => {
    const d = loginFlowDriver();
    await d.perform({ kind: 'tap', x: 10, y: 20 });
    await d.perform({ kind: 'type', text: 'hello' });
    await d.perform({ kind: 'key', key: 'back' });
    assert.deepEqual(d.performed.map((a) => a.kind), ['tap', 'type', 'key']);
  });

  test('tapping a transition target navigates — the seam models real flow', async () => {
    const d = loginFlowDriver();
    assert.equal(d.currentScreen, 'login');
    // Tap inside the "Sign in" button's bounds.
    await d.perform({ kind: 'tap', x: 200, y: 240 });
    assert.equal(d.currentScreen, 'home');
    const tree = await d.hierarchy();
    assert.equal(tree!.context, 'com.fake.app/.HomeActivity');
  });

  test('tapping empty space does not navigate', async () => {
    const d = loginFlowDriver();
    await d.perform({ kind: 'tap', x: 5, y: 5000 });
    assert.equal(d.currentScreen, 'login');
  });

  test('rejects a locale that is not a BCP-47 tag', async () => {
    const d = loginFlowDriver();
    const bad = await d.setLocale('klingon');
    assert.equal(bad.ok, false);
    assert.equal(bad.unsupported, undefined, 'a malformed argument is a failure, not unsupported');
    assert.equal(d.currentLocale, 'en-US');

    const good = await d.setLocale('ar-EG');
    assert.equal(good.ok, true);
    assert.equal(d.currentLocale, 'ar-EG');
  });

  test('orientation round-trips', async () => {
    const d = loginFlowDriver();
    assert.equal(d.currentOrientation, 'portrait');
    await d.setOrientation('landscape');
    assert.equal(d.currentOrientation, 'landscape');
    const tree = await d.hierarchy();
    assert.equal(tree!.rotationDegrees, 90);
  });
});

describe('substitutability', () => {
  test('FakeDriver satisfies DeviceDriver structurally', async () => {
    // If the interface gains a member, this fails to compile — which is the
    // guard that keeps the fake honest as the contract grows.
    const driver: DeviceDriver = loginFlowDriver();
    assert.equal(driver.platform, 'android');
    assert.ok(driver.targetId.startsWith('fake-'));
    const health = await driver.healthCheck();
    assert.equal(health.ok, true);
    await driver.dispose();
  });
});
