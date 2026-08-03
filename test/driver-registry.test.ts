import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createDriver, implementedPlatforms } from '@/lib/qa/drivers';
import { emulatorSupport } from '@/lib/qa/drivers/android/emulator';

describe('driver registry', () => {
  test('returns a working driver for Android', () => {
    const { driver, reason } = createDriver({ platform: 'android', targetId: 'abc123' });
    assert.ok(driver, 'Android must resolve to a driver');
    assert.equal(driver!.platform, 'android');
    assert.equal(driver!.targetId, 'abc123');
    assert.equal(reason, '');
  });

  test('returns null plus a specific reason for iOS — never a silent stub', () => {
    // A stub would satisfy the type and then produce empty observations, which is
    // how a run ends up reporting results for a target it never touched.
    const { driver, reason } = createDriver({ platform: 'ios', targetId: 'UDID' });
    assert.equal(driver, null);
    assert.match(reason, /XCUITest|WebDriverAgent|libimobiledevice/);
  });

  test('returns null plus a reason for web', () => {
    const { driver, reason } = createDriver({ platform: 'web', targetId: 'ctx' });
    assert.equal(driver, null);
    assert.match(reason, /Playwright/);
  });

  test('reports exactly which platforms are implemented', () => {
    assert.deepEqual(implementedPlatforms(), ['android']);
  });
});

describe('emulator support probing', () => {
  test('reports availability from a real filesystem probe, with a reason when absent', () => {
    const s = emulatorSupport();
    assert.equal(typeof s.available, 'boolean');
    assert.ok(s.detail.length > 0, 'must always explain what it found');
    if (!s.available) {
      // An unavailable toolchain must say what to install, not just "false".
      assert.match(s.detail, /ANDROID_HOME|ANDROID_SDK_ROOT|sdkmanager|emulator/);
      assert.equal(s.emulatorPath, null);
    } else {
      assert.ok(s.emulatorPath, 'available implies a resolved binary path');
    }
  });
});
