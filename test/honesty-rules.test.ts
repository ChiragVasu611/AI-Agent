import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
// Imported from the pure verdict module, not from the persistence layer that
// re-exports it — these rules must be testable without a database.
import { assessExercise, computeStatus, computePerformanceScore } from '@/lib/qa/verdict';
import { resolveRuntime, isBlocked, describeBlocked } from '@/lib/qa/runtime-support';
import { decodeDataUrl, pngSize, evidenceKey, runPrefix } from '@/lib/qa/evidence/store';
import type { QaSourceType } from '@/lib/types';

/**
 * Regression tests for the platform's non-negotiable rules.
 *
 * Each of these encodes a defect that actually shipped and was observed in
 * production data, so the test names describe the real failure rather than the
 * abstract rule.
 */

describe('a run that tested nothing must never pass', () => {
  test('launch-only run is not exercised (RUN-29: 22s, 1 screen, reported PASSED)', () => {
    const v = assessExercise({
      screensVisited: 1, interactions: 1, navigatingTransitions: 0, goalsReached: 0,
    });
    assert.equal(v.exercised, false);
    assert.match(v.reason, /never navigated/i);
  });

  test('zero screens is not exercised', () => {
    const v = assessExercise({
      screensVisited: 0, interactions: 0, navigatingTransitions: 0, goalsReached: 0,
    });
    assert.equal(v.exercised, false);
  });

  test('navigation without any goal reached is still not enough', () => {
    const v = assessExercise({
      screensVisited: 3, interactions: 5, navigatingTransitions: 1, goalsReached: 0,
    });
    assert.equal(v.exercised, false);
    assert.match(v.reason, /No application feature was exercised/i);
  });

  test('a genuinely explored run IS exercised', () => {
    const v = assessExercise({
      screensVisited: 7, interactions: 40, navigatingTransitions: 12, goalsReached: 3,
    });
    assert.equal(v.exercised, true);
    assert.equal(v.reason, '');
  });

  test('navigation with a reached goal is exercised even with few transitions', () => {
    const v = assessExercise({
      screensVisited: 2, interactions: 4, navigatingTransitions: 1, goalsReached: 1,
    });
    assert.equal(v.exercised, true);
  });
});

describe('verdict derives from evidence', () => {
  test('critical or high severity fails the run', () => {
    assert.equal(computeStatus({ critical: 1, high: 0, medium: 0, low: 0 }, 1), 'failed');
    assert.equal(computeStatus({ critical: 0, high: 2, medium: 0, low: 0 }, 2), 'failed');
  });

  test('lesser bugs make it partial, none makes it passed', () => {
    assert.equal(computeStatus({ critical: 0, high: 0, medium: 1, low: 0 }, 1), 'partial');
    assert.equal(computeStatus({ critical: 0, high: 0, medium: 0, low: 0 }, 0), 'passed');
  });

  test('the score is penalised by severity and floored, never inflated', () => {
    assert.equal(computePerformanceScore({ critical: 0, high: 0, medium: 0, low: 0 }), 100);
    assert.equal(computePerformanceScore({ critical: 1, high: 0, medium: 0, low: 0 }), 80);
    // Heavily broken apps floor at 20 rather than going negative.
    assert.equal(computePerformanceScore({ critical: 10, high: 10, medium: 10, low: 10 }), 20);
  });
});

describe('unexecutable targets are BLOCKED, never simulated', () => {
  const cases: Array<[QaSourceType, string, string]> = [
    ['ipa', 'MyApp.ipa', 'unsupported_platform'],
    ['app_store_url', 'https://apps.apple.com/app/id1', 'unsupported_platform'],
    ['flutter', 'app.flutter', 'unsupported_platform'],
    ['play_store_url', 'https://play.google.com/store/apps/details?id=x', 'blocked_no_runtime'],
    ['web_url', 'not-a-url', 'blocked_no_runtime'],
  ];

  for (const [sourceType, ref, expected] of cases) {
    test(`${sourceType} "${ref}" → ${expected}`, async () => {
      const d = await resolveRuntime(sourceType, ref, {});
      assert.equal(isBlocked(d), true, 'must not resolve to an executable engine');
      assert.equal(d.kind, expected);
      if (isBlocked(d)) {
        // A blocked decision must always explain itself and how to fix it.
        assert.ok(d.reason.length > 40, 'reason must be specific, not a stub');
        assert.ok(d.remediation.length > 0, 'must tell the user how to unblock');
        assert.match(describeBlocked(d), /^BLOCKED —/);
      }
    });
  }

  test('an APK with no stored binary cannot execute', async () => {
    const d = await resolveRuntime('apk', 'app.apk', { binaryPath: null });
    assert.equal(isBlocked(d), true);
    assert.equal(d.kind, 'blocked_no_runtime');
  });

  test('an App Bundle reports the missing bundletool dependency', async () => {
    const d = await resolveRuntime('apk', 'app.aab', { binaryPath: '/tmp/app.aab' });
    assert.equal(d.kind, 'runtime_unavailable');
    if (isBlocked(d)) assert.match(d.reason, /bundletool/i);
  });

  test('iOS remediation names a real driver, not a vague promise', async () => {
    const d = await resolveRuntime('ipa', 'x.ipa', {});
    if (isBlocked(d)) {
      const text = `${d.reason} ${d.remediation.join(' ')}`;
      assert.match(text, /XCUITest|WebDriverAgent|libimobiledevice/);
    }
  });
});

describe('evidence storage helpers', () => {
  test('keys are namespaced per run so deletion is a prefix sweep', () => {
    const key = evidenceKey('run123', 'screenshot', 'frame.png');
    assert.equal(key, 'runs/run123/screenshots/frame.png');
    assert.ok(key.startsWith(runPrefix('run123')));
  });

  test('recordings and screenshots live under distinct prefixes', () => {
    assert.match(evidenceKey('r', 'recording', 'a.mp4'), /\/recordings\//);
    assert.match(evidenceKey('r', 'screenshot', 'a.png'), /\/screenshots\//);
  });

  test('decodes a data URL into real bytes', () => {
    const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==';
    const decoded = decodeDataUrl(`data:image/png;base64,${png}`);
    assert.ok(decoded);
    assert.equal(decoded!.contentType, 'image/png');
    assert.deepEqual(pngSize(decoded!.data), { width: 1, height: 1 });
  });

  test('rejects malformed data URLs instead of returning empty bytes', () => {
    assert.equal(decodeDataUrl('not-a-data-url'), null);
    assert.equal(decodeDataUrl('data:image/png,notbase64'), null);
  });

  test('pngSize refuses non-PNG input rather than guessing dimensions', () => {
    assert.equal(pngSize(Buffer.from('hello world')), null);
    assert.equal(pngSize(Buffer.alloc(0)), null);
  });
});
