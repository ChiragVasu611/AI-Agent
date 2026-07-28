import type { Finding, ScreenState, UiNode } from './types';
import { describeNode, labelOf, width as bw, height as bh, area } from './ui-parser';

/**
 * UI/UX layout auditing from the live hierarchy.
 *
 * These checks are geometric, so they hold for any app: elements pushed
 * outside the viewport, text containers too short to render their content,
 * and interactive elements physically overlapping each other. Each finding
 * lists the offending elements with their exact bounds as evidence.
 */

/** An element is off-screen if a meaningful part of it sits outside the viewport. */
function offScreenElements(nodes: UiNode[], w: number, h: number): UiNode[] {
  return nodes.filter((n) => {
    if (!n.enabled || bw(n.bounds) === 0 || bh(n.bounds) === 0) return false;
    if (!n.clickable && !labelOf(n)) return false;
    const b = n.bounds;
    const overflowRight = b.right > w + 2;
    const overflowLeft = b.left < -2;
    const overflowBottom = b.bottom > h + 2;
    // Content below the fold inside a scrollable is normal; only flag
    // horizontal overflow and elements that start beyond the viewport.
    return overflowRight || overflowLeft || (overflowBottom && b.top > h);
  });
}

/** Horizontal overflow: any element extending past the screen width. */
function horizontalOverflow(nodes: UiNode[], w: number): UiNode[] {
  return nodes.filter((n) => {
    const b = n.bounds;
    if (bw(b) === 0 || bh(b) === 0) return false;
    return b.right > w + 2 || b.left < -2;
  });
}

/**
 * Likely-truncated text: a single-line-height container holding text far
 * longer than could fit in its width at any plausible font size.
 */
function likelyCroppedText(nodes: UiNode[]): UiNode[] {
  return nodes.filter((n) => {
    const text = n.text?.trim() ?? '';
    if (text.length < 12) return false;
    if (!/TextView|Button|Label/i.test(n.className)) return false;
    const w = bw(n.bounds);
    const h = bh(n.bounds);
    if (w <= 0 || h <= 0) return false;
    // Approximate: a glyph is at least ~0.42 * line-height wide on average.
    const approxGlyphWidth = Math.max(6, h * 0.42);
    const capacity = Math.floor(w / approxGlyphWidth);
    const lines = Math.max(1, Math.round(h / Math.max(12, h)));
    return text.length > capacity * lines * 1.35;
  });
}

function intersects(a: UiNode, b: UiNode): boolean {
  return !(
    a.bounds.right <= b.bounds.left
    || b.bounds.right <= a.bounds.left
    || a.bounds.bottom <= b.bounds.top
    || b.bounds.bottom <= a.bounds.top
  );
}

function overlapArea(a: UiNode, b: UiNode): number {
  const x = Math.max(0, Math.min(a.bounds.right, b.bounds.right) - Math.max(a.bounds.left, b.bounds.left));
  const y = Math.max(0, Math.min(a.bounds.bottom, b.bounds.bottom) - Math.max(a.bounds.top, b.bounds.top));
  return x * y;
}

/** Sibling interactive elements that physically overlap — a real hit-testing hazard. */
function overlappingControls(nodes: UiNode[]): Array<[UiNode, UiNode]> {
  const clickable = nodes.filter((n) => n.clickable && n.enabled && area(n.bounds) > 0);
  const pairs: Array<[UiNode, UiNode]> = [];
  for (let i = 0; i < clickable.length && pairs.length < 8; i++) {
    for (let j = i + 1; j < clickable.length && pairs.length < 8; j++) {
      const a = clickable[i];
      const b = clickable[j];
      // Ignore ancestor/descendant containment — that's normal nesting.
      if (a.depth !== b.depth) continue;
      if (!intersects(a, b)) continue;
      const ov = overlapArea(a, b);
      const minArea = Math.min(area(a.bounds), area(b.bounds));
      if (minArea > 0 && ov / minArea > 0.3) pairs.push([a, b]);
    }
  }
  return pairs;
}

function listOf(nodes: UiNode[], max = 6): string {
  return nodes
    .slice(0, max)
    .map((n) => `  • "${describeNode(n)}" bounds=[${n.bounds.left},${n.bounds.top}][${n.bounds.right},${n.bounds.bottom}]`)
    .join('\n');
}

export function auditLayout(state: ScreenState, moduleLabel: string): Finding[] {
  const findings: Finding[] = [];
  const { screenWidth: w, screenHeight: h, label: screen } = state;

  const overflow = horizontalOverflow(state.nodes, w);
  if (overflow.length > 0) {
    findings.push({
      type: 'ui',
      module: moduleLabel,
      severity: 'medium',
      title: `${overflow.length} element(s) overflow the screen horizontally on "${screen}"`,
      description: `Elements extend beyond the ${w}px viewport width, so part of their content is unreachable.`,
      screenName: screen,
      activity: state.activity,
      stepsToReproduce: [`Navigate to "${screen}"`, 'Run: adb shell uiautomator dump', 'Compare element bounds against the screen width'],
      expectedResult: `All content fits within the ${w}px viewport.`,
      actualResult: `Overflowing elements:\n${listOf(overflow)}`,
      evidence: listOf(overflow, 12),
      rootCause: 'Fixed widths, unwrapped long strings, or a horizontal layout wider than its parent.',
      suggestedFix: 'Use match_parent/0dp with constraints instead of fixed widths, enable text wrapping or ellipsize, and verify on the narrowest supported width.',
    });
  }

  const off = offScreenElements(state.nodes, w, h);
  if (off.length > 0) {
    findings.push({
      type: 'ui',
      module: moduleLabel,
      severity: 'medium',
      title: `${off.length} interactive element(s) positioned outside the viewport on "${screen}"`,
      description: 'Controls are laid out beyond the visible screen area and cannot be reached by touch.',
      screenName: screen,
      activity: state.activity,
      stepsToReproduce: [`Navigate to "${screen}"`, 'Dump the hierarchy and inspect element bounds'],
      expectedResult: 'All interactive controls are within the visible area or reachable by scrolling.',
      actualResult: `Off-screen controls:\n${listOf(off)}`,
      evidence: listOf(off, 12),
      rootCause: 'Absolute positioning or a container taller/wider than the screen without a scrolling parent.',
      suggestedFix: 'Place content inside a ScrollView/NestedScrollView, or adjust constraints so controls remain on-screen.',
    });
  }

  const cropped = likelyCroppedText(state.nodes);
  if (cropped.length > 0) {
    findings.push({
      type: 'ui',
      module: moduleLabel,
      severity: 'low',
      title: `${cropped.length} text element(s) likely truncated on "${screen}"`,
      description: 'Text content appears too long for its container at the measured bounds, suggesting it is clipped or ellipsized.',
      screenName: screen,
      activity: state.activity,
      stepsToReproduce: [`Navigate to "${screen}"`, 'Compare each label\'s text length with its rendered width'],
      expectedResult: 'Text is fully visible or intentionally ellipsized with the full value available elsewhere.',
      actualResult: cropped.slice(0, 5).map((n) => `  • "${n.text.slice(0, 60)}" in ${bw(n.bounds)}x${bh(n.bounds)}px`).join('\n'),
      evidence: cropped.slice(0, 10).map((n) => `${n.className} w=${bw(n.bounds)} h=${bh(n.bounds)} text="${n.text.slice(0, 80)}"`).join('\n'),
      rootCause: 'Fixed-width text containers combined with long or localized strings.',
      suggestedFix: 'Allow text to wrap, use autoSizeTextType, or increase the container width; verify with the longest supported locale.',
    });
  }

  const overlaps = overlappingControls(state.nodes);
  if (overlaps.length > 0) {
    findings.push({
      type: 'ui',
      module: moduleLabel,
      severity: 'medium',
      title: `${overlaps.length} pair(s) of overlapping interactive controls on "${screen}"`,
      description: 'Two sibling controls occupy overlapping regions, so a tap in the shared area is ambiguous and may trigger the wrong action.',
      screenName: screen,
      activity: state.activity,
      stepsToReproduce: [`Navigate to "${screen}"`, 'Dump the hierarchy and compare bounds of sibling clickable views'],
      expectedResult: 'Interactive controls do not overlap.',
      actualResult: overlaps
        .slice(0, 4)
        .map(([a, b]) => `  • "${describeNode(a)}" overlaps "${describeNode(b)}"`)
        .join('\n'),
      evidence: overlaps
        .slice(0, 6)
        .map(([a, b]) => `${describeNode(a)} [${a.bounds.left},${a.bounds.top}][${a.bounds.right},${a.bounds.bottom}] ↔ ${describeNode(b)} [${b.bounds.left},${b.bounds.top}][${b.bounds.right},${b.bounds.bottom}]`)
        .join('\n'),
      rootCause: 'Overlapping constraints or absolute offsets place two touchable views on top of each other.',
      suggestedFix: 'Adjust the layout so touch areas are disjoint, or make the covered view non-clickable.',
    });
  }

  return findings;
}

/**
 * Rotation check: compares the element census before and after a rotation to
 * detect content lost in landscape. Only reports when the difference is large,
 * because some responsive layouts legitimately show different content.
 */
export function auditRotation(
  portrait: ScreenState,
  landscape: ScreenState,
  moduleLabel: string,
): Finding[] {
  const findings: Finding[] = [];

  const pControls = portrait.nodes.filter((n) => n.clickable && n.enabled && labelOf(n)).map(labelOf);
  const lControls = new Set(landscape.nodes.filter((n) => n.clickable && n.enabled).map(labelOf));
  const missing = pControls.filter((label) => !lControls.has(label));

  if (pControls.length > 0 && missing.length > Math.max(2, pControls.length * 0.4)) {
    findings.push({
      type: 'compatibility',
      module: moduleLabel,
      severity: 'medium',
      title: `${missing.length} control(s) disappear in landscape on "${portrait.label}"`,
      description: 'Controls present in portrait are absent from the landscape hierarchy, indicating the landscape layout drops or clips functionality.',
      screenName: portrait.label,
      activity: portrait.activity,
      stepsToReproduce: [
        `Navigate to "${portrait.label}" in portrait`,
        'Run: adb shell settings put system user_rotation 1 (landscape)',
        'Compare available controls',
      ],
      expectedResult: 'All functionality remains reachable in landscape.',
      actualResult: `Missing in landscape: ${missing.slice(0, 8).join(', ')}`,
      evidence: `Portrait controls (${pControls.length}): ${pControls.slice(0, 15).join(' | ')}\nLandscape controls (${lControls.size}): ${Array.from(lControls).slice(0, 15).join(' | ')}`,
      rootCause: 'A separate land/ layout omits views, or the portrait layout has no scrolling container so content is clipped when the height shrinks.',
      suggestedFix: 'Wrap the screen in a NestedScrollView so all content remains reachable, and keep land/ layouts in sync with the default layout.',
    });
  }

  return findings;
}
