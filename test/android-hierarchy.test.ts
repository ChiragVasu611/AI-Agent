import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { roleForClass, toUiTree, interactiveElements } from '@/lib/qa/drivers/android/hierarchy';

/** A real uiautomator fragment: nested nodes, entities, splits, an ad container. */
const XML = `<?xml version='1.0' encoding='UTF-8' standalone='yes' ?>
<hierarchy rotation="0">
  <node index="0" text="" resource-id="" class="android.widget.FrameLayout" package="com.example.app" content-desc="" checkable="false" checked="false" clickable="false" enabled="true" focusable="false" focused="false" scrollable="false" long-clickable="false" password="false" selected="false" bounds="[0,0][720,1600]">
    <node index="0" text="Choose Language" resource-id="com.example.app:id/title" class="android.widget.TextView" package="com.example.app" content-desc="" checkable="false" checked="false" clickable="false" enabled="true" focusable="false" focused="false" scrollable="false" long-clickable="false" password="false" selected="false" bounds="[100,200][620,305]" />
    <node index="1" text="Sign in &amp; continue" resource-id="com.example.app:id/cta" class="android.widget.Button" package="com.example.app" content-desc="" checkable="false" checked="false" clickable="true" enabled="true" focusable="true" focused="false" scrollable="false" long-clickable="false" password="false" selected="false" bounds="[100,400][620,500]" />
    <node index="2" text="" resource-id="" class="android.widget.EditText" package="com.example.app" content-desc="Email address" checkable="false" checked="false" clickable="true" enabled="true" focusable="true" focused="true" scrollable="false" long-clickable="false" password="false" selected="false" bounds="[100,600][620,700]" />
    <node index="3" text="" resource-id="" class="com.google.android.gms.ads.AdView" package="com.example.app" content-desc="" checkable="false" checked="false" clickable="true" enabled="true" focusable="true" focused="false" scrollable="false" long-clickable="false" password="false" selected="false" bounds="[0,1400][720,1600]" />
    <node index="4" text="Disabled" resource-id="" class="android.widget.Button" package="com.example.app" content-desc="" checkable="false" checked="false" clickable="true" enabled="false" focusable="true" focused="false" scrollable="false" long-clickable="false" password="false" selected="false" bounds="[100,800][620,900]" />
  </node>
</hierarchy>`;

const INFO = { widthPx: 720, heightPx: 1600 };

describe('role mapping', () => {
  test('maps Android widget classes onto semantic roles', () => {
    const f = { clickable: false, editable: false, scrollable: false, checkable: false };
    assert.equal(roleForClass('android.widget.Button', f), 'button');
    assert.equal(roleForClass('android.widget.ImageButton', f), 'button');
    assert.equal(roleForClass('android.widget.EditText', f), 'input');
    assert.equal(roleForClass('android.widget.CheckBox', f), 'checkbox');
    assert.equal(roleForClass('android.widget.Switch', f), 'switch');
    assert.equal(roleForClass('androidx.recyclerview.widget.RecyclerView', f), 'list');
    assert.equal(roleForClass('android.webkit.WebView', f), 'webview');
    assert.equal(roleForClass('android.widget.ProgressBar', f), 'progress');
  });

  test('a clickable TextView is a link, a static one is text', () => {
    const base = { editable: false, scrollable: false, checkable: false };
    assert.equal(roleForClass('android.widget.TextView', { ...base, clickable: true }), 'link');
    assert.equal(roleForClass('android.widget.TextView', { ...base, clickable: false }), 'text');
  });

  test('falls back to behaviour when the class is unrecognised', () => {
    const f = { clickable: false, editable: false, scrollable: false, checkable: false };
    assert.equal(roleForClass('com.custom.Thing', { ...f, editable: true }), 'input');
    assert.equal(roleForClass('com.custom.Thing', { ...f, scrollable: true }), 'list');
    assert.equal(roleForClass('com.custom.Thing', { ...f, clickable: true }), 'button');
    assert.equal(roleForClass('com.custom.Thing', f), 'unknown');
  });
});

describe('hierarchy normalisation', () => {
  const tree = toUiTree(XML, 'com.example.app/.MainActivity', 0, INFO);

  test('parses every node', () => {
    assert.equal(tree.elements.length, 6);
    assert.equal(tree.context, 'com.example.app/.MainActivity');
    assert.equal(tree.application, 'com.example.app');
    assert.equal(tree.rotationDegrees, 0);
  });

  test('decodes XML entities in labels', () => {
    const cta = tree.elements.find((e) => e.identifier.endsWith('id/cta'));
    // "&amp;" must become "&" — otherwise label matching against real copy fails.
    assert.equal(cta?.label, 'Sign in & continue');
  });

  test('falls back to content-desc when there is no text', () => {
    const input = tree.elements.find((e) => e.role === 'input');
    assert.equal(input?.label, 'Email address');
    assert.equal(input?.editable, true);
    assert.equal(input?.focused, true);
  });

  test('parses bounds', () => {
    const title = tree.elements.find((e) => e.label === 'Choose Language');
    assert.deepEqual(title?.bounds, { left: 100, top: 200, right: 620, bottom: 305 });
  });

  test('tracks nesting depth so containers differ from leaves', () => {
    const root = tree.elements[0];
    assert.equal(root.depth, 0);
    assert.ok(tree.elements.slice(1).every((e) => e.depth === 1));
  });

  test('preserves native attributes detectors depend on', () => {
    const ad = tree.elements.find((e) => String(e.native.className).includes('gms.ads'));
    assert.ok(ad, 'the ad view must survive normalisation');
    assert.equal(ad?.native.packageName, 'com.example.app');
  });

  test('keeps the raw payload verbatim for evidence', () => {
    assert.equal(tree.raw, XML);
  });

  test('preserves the disabled state rather than assuming enabled', () => {
    const disabled = tree.elements.find((e) => e.label === 'Disabled');
    assert.equal(disabled?.enabled, false);
  });
});

describe('interactive element selection', () => {
  test('excludes disabled controls', () => {
    const tree = toUiTree(XML, 'ctx', 0, INFO);
    const interactive = interactiveElements(tree);
    assert.ok(interactive.every((e) => e.enabled));
    assert.ok(!interactive.some((e) => e.label === 'Disabled'));
  });

  test('includes buttons, inputs and the ad view (filtering is the caller\'s job)', () => {
    const tree = toUiTree(XML, 'ctx', 0, INFO);
    const labels = interactiveElements(tree).map((e) => e.label);
    assert.ok(labels.includes('Sign in & continue'));
    assert.ok(labels.includes('Email address'));
  });
});

describe('malformed input', () => {
  test('an empty dump yields an empty tree rather than throwing', () => {
    const tree = toUiTree('', 'ctx', null, INFO);
    assert.equal(tree.elements.length, 0);
    assert.equal(tree.rotationDegrees, null);
  });

  test('missing bounds default to a zero rect instead of NaN', () => {
    const tree = toUiTree('<hierarchy><node class="android.widget.Button" /></hierarchy>', 'c', 0, INFO);
    assert.deepEqual(tree.elements[0].bounds, { left: 0, top: 0, right: 0, bottom: 0 });
  });
});
