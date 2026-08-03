import type { Bounds, DeviceInfo, ElementRole, UiElement, UiTree } from '../types';

/**
 * Normalises an Android `uiautomator` dump into the platform-neutral
 * {@link UiTree}.
 *
 * The point of the mapping is that everything above the driver — planner,
 * vision, bug detection — can reason about *roles* ("a button", "an input")
 * instead of `android.widget.Button`. iOS and web drivers map into the same
 * shape, so the intelligence layer is written once.
 *
 * The original XML is preserved on `UiTree.raw`: existing Android-specific
 * analysis keeps working unchanged, and evidence records exactly what was
 * observed rather than a lossy re-rendering of it.
 */

/** Maps an Android widget class onto a semantic role. */
export function roleForClass(className: string, attrs: {
  checkable?: boolean; editable?: boolean; scrollable?: boolean; clickable?: boolean;
}): ElementRole {
  const c = className.toLowerCase();
  if (/edittext|autocompletetextview|searchview/.test(c)) return 'input';
  if (/switch|togglebutton/.test(c)) return 'switch';
  if (/checkbox/.test(c)) return 'checkbox';
  if (/radiobutton/.test(c)) return 'radio';
  if (/imagebutton/.test(c)) return 'button';
  if (/button/.test(c)) return 'button';
  if (/recyclerview|listview|gridview|viewpager|scrollview/.test(c)) return 'list';
  if (/tablayout|tabwidget/.test(c)) return 'tab';
  if (/progressbar|seekbar/.test(c)) return 'progress';
  if (/webview/.test(c)) return 'webview';
  if (/videoview|surfaceview|texture/.test(c)) return 'video';
  if (/imageview/.test(c)) return 'image';
  if (/textview/.test(c)) return attrs.clickable ? 'link' : 'text';
  if (/dialog|alert|popupwindow|bottomsheet/.test(c)) return 'dialog';
  if (/menu/.test(c)) return 'menu';
  if (attrs.editable) return 'input';
  if (attrs.checkable) return 'checkbox';
  if (attrs.scrollable) return 'list';
  if (attrs.clickable) return 'button';
  if (/layout|group|frame|container|compose/.test(c)) return 'container';
  return 'unknown';
}

function parseBounds(raw: string): Bounds {
  const m = /\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]/.exec(raw);
  if (!m) return { left: 0, top: 0, right: 0, bottom: 0 };
  return { left: Number(m[1]), top: Number(m[2]), right: Number(m[3]), bottom: Number(m[4]) };
}

const attr = (tag: string, name: string): string => {
  const m = new RegExp(`${name}="([^"]*)"`).exec(tag);
  return m ? m[1] : '';
};
const flag = (tag: string, name: string): boolean => attr(tag, name) === 'true';

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&amp;/g, '&');
}

/**
 * Converts a uiautomator XML dump into a normalised tree.
 *
 * Depth is derived by tracking nesting as the flat tag stream is scanned, since
 * uiautomator emits a nested document without depth attributes.
 */
export function toUiTree(
  xml: string,
  context: string,
  rotationDegrees: number | null,
  info: Pick<DeviceInfo, 'widthPx' | 'heightPx'>,
): UiTree {
  const elements: UiElement[] = [];
  let application = '';
  let depth = 0;
  let index = 0;

  // Walk every tag so closing tags can decrement depth accurately.
  const tagPattern = /<(\/?)node\b([^>]*?)(\/?)>/g;
  let match: RegExpExecArray | null;
  while ((match = tagPattern.exec(xml)) !== null) {
    const [, closing, body, selfClosing] = match;

    if (closing) { depth = Math.max(0, depth - 1); continue; }

    const tag = body;
    const className = attr(tag, 'class');
    const pkg = attr(tag, 'package');
    if (!application && pkg) application = pkg;

    const editable = /edittext|autocompletetextview/i.test(className);
    const checkable = flag(tag, 'checkable');
    const scrollable = flag(tag, 'scrollable');
    const clickable = flag(tag, 'clickable');
    const text = decodeXmlEntities(attr(tag, 'text'));
    const desc = decodeXmlEntities(attr(tag, 'content-desc'));
    const resourceId = attr(tag, 'resource-id');
    const bounds = parseBounds(attr(tag, 'bounds'));

    elements.push({
      id: `${index}`,
      role: roleForClass(className, { checkable, editable, scrollable, clickable }),
      // Prefer visible text; fall back to the accessibility description.
      label: (text || desc).trim(),
      identifier: resourceId,
      bounds,
      enabled: flag(tag, 'enabled'),
      focused: flag(tag, 'focused'),
      selected: flag(tag, 'selected'),
      editable,
      scrollable,
      clickable,
      longClickable: flag(tag, 'long-clickable'),
      depth,
      // Native detail detectors legitimately need (ad SDK classes, ownership).
      native: {
        className,
        packageName: pkg,
        resourceId,
        text,
        contentDesc: desc,
        checkable,
        checked: flag(tag, 'checked'),
        password: flag(tag, 'password'),
        focusable: flag(tag, 'focusable'),
      },
    });

    index += 1;
    if (!selfClosing) depth += 1;
  }

  void info;
  return {
    elements,
    context,
    application,
    rotationDegrees,
    capturedAt: Date.now(),
    raw: xml,
  };
}

/** Convenience: elements a user could actually interact with. */
export function interactiveElements(tree: UiTree): UiElement[] {
  return tree.elements.filter(
    (e) => e.enabled && (e.clickable || e.editable || e.scrollable || e.longClickable),
  );
}
