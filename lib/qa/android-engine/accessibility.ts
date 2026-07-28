import type { Finding, ScreenState, UiNode } from './types';
import { describeNode, labelOf, isEditable, width as bw, height as bh } from './ui-parser';

/**
 * Accessibility auditing against the live accessibility tree.
 *
 * `uiautomator dump` IS the accessibility tree — the same data TalkBack
 * consumes — so these checks assess exactly what an assistive technology
 * would encounter. Every violation names the offending elements, so each
 * finding is reproducible and independently verifiable.
 */

/** Material/WCAG minimum touch target: 48dp. Converted to px via device density. */
const MIN_TOUCH_DP = 48;

function dpToPx(dp: number, densityDpi: number): number {
  return Math.round(dp * (densityDpi / 160));
}

/** Interactive elements that convey no label to a screen reader. */
function unlabeledInteractive(nodes: UiNode[]): UiNode[] {
  return nodes.filter((n) => {
    if (!n.enabled) return false;
    if (!n.clickable && !n.checkable && !n.longClickable) return false;
    if (labelOf(n)) return false;
    // A container whose child carries the label is fine — only flag leaves.
    const childLabelled = n.children.some((c) => labelOf(c));
    if (childLabelled) return false;
    // Purely decorative zero-size nodes are irrelevant.
    return bw(n.bounds) > 0 && bh(n.bounds) > 0;
  });
}

/** Images that are clickable but have no content description. */
function unlabeledImages(nodes: UiNode[]): UiNode[] {
  return nodes.filter(
    (n) => /ImageView|ImageButton/i.test(n.className)
      && (n.clickable || n.longClickable)
      && !labelOf(n),
  );
}

/** Inputs with no associated label or hint. */
function unlabeledInputs(nodes: UiNode[]): UiNode[] {
  return nodes.filter((n) => isEditable(n) && !n.contentDesc && !n.text);
}

function tooSmallTargets(nodes: UiNode[], minPx: number): UiNode[] {
  return nodes.filter((n) => {
    if (!n.enabled || (!n.clickable && !n.checkable)) return false;
    const w = bw(n.bounds);
    const h = bh(n.bounds);
    if (w === 0 || h === 0) return false;
    return w < minPx || h < minPx;
  });
}

/**
 * Focus-order sanity: focusable elements should progress roughly top-to-bottom.
 * A large backwards jump indicates a confusing traversal order for TalkBack.
 */
function focusOrderAnomalies(nodes: UiNode[], screenH: number): number {
  const focusables = nodes.filter((n) => n.focusable && n.enabled && bh(n.bounds) > 0);
  let anomalies = 0;
  for (let i = 1; i < focusables.length; i++) {
    const prev = focusables[i - 1].bounds.top;
    const cur = focusables[i].bounds.top;
    if (cur < prev - screenH * 0.25) anomalies += 1;
  }
  return anomalies;
}

function listOf(nodes: UiNode[], max = 6): string {
  return nodes.slice(0, max).map((n) => `  • ${describeNode(n)} [${n.className}] bounds=[${n.bounds.left},${n.bounds.top}][${n.bounds.right},${n.bounds.bottom}]`).join('\n');
}

export function auditAccessibility(
  state: ScreenState,
  moduleLabel: string,
  densityDpi: number,
): Finding[] {
  const findings: Finding[] = [];
  const minPx = dpToPx(MIN_TOUCH_DP, densityDpi || 160);
  const screen = state.label;

  const unlabeled = unlabeledInteractive(state.nodes);
  if (unlabeled.length > 0) {
    findings.push({
      type: 'accessibility',
      module: moduleLabel,
      severity: unlabeled.length > 4 ? 'high' : 'medium',
      title: `${unlabeled.length} interactive element(s) have no accessible label on "${screen}"`,
      description: 'Elements that respond to touch expose neither text nor a content description, so TalkBack announces them only by class name.',
      screenName: screen,
      activity: state.activity,
      stepsToReproduce: [
        `Navigate to "${screen}"`,
        'Enable TalkBack (or run: adb shell uiautomator dump)',
        'Focus the listed controls and observe the announcement',
      ],
      expectedResult: 'Every interactive element exposes meaningful text or a contentDescription.',
      actualResult: `${unlabeled.length} control(s) announce no label:\n${listOf(unlabeled)}`,
      evidence: listOf(unlabeled, 12),
      rootCause: 'Views are created without android:contentDescription (or, for icon-only buttons, without a tooltip/label).',
      suggestedFix: 'Add android:contentDescription to icon-only controls, or set it to "@null" for purely decorative images so they are skipped by assistive tech.',
    });
  }

  const images = unlabeledImages(state.nodes);
  if (images.length > 0) {
    findings.push({
      type: 'accessibility',
      module: moduleLabel,
      severity: 'medium',
      title: `${images.length} actionable image(s) missing contentDescription on "${screen}"`,
      description: 'Clickable images convey their purpose visually only.',
      screenName: screen,
      activity: state.activity,
      stepsToReproduce: [`Navigate to "${screen}"`, 'Inspect the image controls with TalkBack enabled'],
      expectedResult: 'Actionable images describe their action.',
      actualResult: listOf(images),
      evidence: listOf(images, 12),
      rootCause: 'ImageView/ImageButton used as a control without a text alternative.',
      suggestedFix: 'Set android:contentDescription describing the ACTION (e.g. "Play", not "play icon").',
    });
  }

  const inputs = unlabeledInputs(state.nodes);
  if (inputs.length > 0) {
    findings.push({
      type: 'accessibility',
      module: moduleLabel,
      severity: 'medium',
      title: `${inputs.length} input field(s) without a label or hint on "${screen}"`,
      description: 'Text inputs expose no hint or content description, so a screen-reader user cannot tell what to enter.',
      screenName: screen,
      activity: state.activity,
      stepsToReproduce: [`Navigate to "${screen}"`, 'Focus each text field with TalkBack'],
      expectedResult: 'Each field has an android:hint or an associated label.',
      actualResult: listOf(inputs),
      evidence: listOf(inputs, 12),
      rootCause: 'EditText declared without a hint, and no TextInputLayout label is associated.',
      suggestedFix: 'Wrap fields in TextInputLayout with android:hint, or set labelFor on a visible label TextView.',
    });
  }

  const small = tooSmallTargets(state.nodes, minPx);
  if (small.length > 0) {
    findings.push({
      type: 'accessibility',
      module: moduleLabel,
      severity: small.length > 5 ? 'medium' : 'low',
      title: `${small.length} touch target(s) smaller than ${MIN_TOUCH_DP}dp on "${screen}"`,
      description: `Targets below the ${MIN_TOUCH_DP}dp minimum (${minPx}px at this density) are difficult to hit accurately, especially with motor impairments.`,
      screenName: screen,
      activity: state.activity,
      stepsToReproduce: [`Navigate to "${screen}"`, 'Measure the interactive element bounds from the UI dump'],
      expectedResult: `Interactive targets are at least ${MIN_TOUCH_DP}x${MIN_TOUCH_DP}dp.`,
      actualResult: `Undersized targets:\n${listOf(small)}`,
      evidence: listOf(small, 12),
      rootCause: 'Fixed small dimensions or tight wrap_content on icon buttons without added padding.',
      suggestedFix: `Increase minWidth/minHeight to ${MIN_TOUCH_DP}dp, add padding, or expand the tappable area with TouchDelegate.`,
    });
  }

  const anomalies = focusOrderAnomalies(state.nodes, state.screenHeight);
  if (anomalies >= 3) {
    findings.push({
      type: 'accessibility',
      module: moduleLabel,
      severity: 'low',
      title: `Focus traversal order jumps ${anomalies} time(s) on "${screen}"`,
      description: 'The accessibility focus order moves backwards up the screen several times, which makes TalkBack navigation confusing.',
      screenName: screen,
      activity: state.activity,
      stepsToReproduce: [`Navigate to "${screen}"`, 'Enable TalkBack and swipe forward through all elements'],
      expectedResult: 'Focus advances in a predictable reading order.',
      actualResult: `${anomalies} backwards jumps detected in the focusable element sequence.`,
      evidence: `Screen height ${state.screenHeight}px; ${anomalies} focusable elements appear far above their predecessor.`,
      rootCause: 'View hierarchy order does not match the visual layout — common with ConstraintLayout or overlapping containers.',
      suggestedFix: 'Set android:accessibilityTraversalBefore/After, or reorder the hierarchy so declaration order matches visual order.',
    });
  }

  return findings;
}
