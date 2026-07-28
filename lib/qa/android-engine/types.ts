/**
 * Shared types for the autonomous Android execution engine.
 *
 * Everything here describes state observed from a LIVE device — there are no
 * synthetic fixtures. A UiNode mirrors one element of an `uiautomator dump`,
 * a ScreenState is one observed screen, and an Interaction is a real gesture
 * that was (or will be) sent through adb.
 */

export interface Bounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface UiNode {
  index: number;
  text: string;
  resourceId: string;
  className: string;
  packageName: string;
  contentDesc: string;
  checkable: boolean;
  checked: boolean;
  clickable: boolean;
  enabled: boolean;
  focusable: boolean;
  focused: boolean;
  scrollable: boolean;
  longClickable: boolean;
  password: boolean;
  selected: boolean;
  bounds: Bounds;
  children: UiNode[];
  /** Depth from the hierarchy root — used for focus-order and nesting checks. */
  depth: number;
}

export type ScreenKind =
  | 'splash' | 'home' | 'dashboard' | 'login' | 'signup' | 'settings' | 'profile'
  | 'search' | 'checkout' | 'product' | 'camera' | 'gallery' | 'webview'
  | 'permission_dialog' | 'popup' | 'dialog' | 'bottom_sheet' | 'ad' | 'paywall'
  | 'video' | 'game' | 'list' | 'onboarding' | 'unknown';

/** One observed screen of the app under test. */
export interface ScreenState {
  /** Stable structural hash — two screens with the same signature are the same node. */
  signature: string;
  activity: string;
  packageName: string;
  kind: ScreenKind;
  /** Human-readable label derived from the activity/title, never hardcoded per-app. */
  label: string;
  root: UiNode | null;
  nodes: UiNode[];
  screenWidth: number;
  screenHeight: number;
  rotation: number;
  capturedAt: number;
}

export type InteractionKind =
  | 'tap' | 'long_press' | 'double_tap' | 'swipe_up' | 'swipe_down'
  | 'swipe_left' | 'swipe_right' | 'type' | 'clear' | 'back' | 'home'
  | 'rotate' | 'toggle' | 'scroll_into_view';

export interface Interaction {
  kind: InteractionKind;
  /** Target element, when the interaction addresses one. */
  target?: UiNode;
  text?: string;
  /** Stable key identifying the (screen, element, gesture) triple for dedupe. */
  key: string;
  /** Why the planner chose this — surfaced in logs for traceability. */
  reason: string;
}

export interface DeviceProfile {
  serial: string;
  model: string;
  osVersion: string;
  sdkInt: number;
  width: number;
  height: number;
  /** Screen density in DPI — used to convert dp thresholds (e.g. 48dp targets) to px. */
  densityDpi: number;
  /** True when adb is attached over Wi-Fi (host:port) — network tests must not cut it. */
  wireless: boolean;
}

/** Evidence-backed finding. The engine only ever emits these from real observations. */
export interface Finding {
  type:
    | 'functional' | 'ui' | 'api' | 'security' | 'performance' | 'memory'
    | 'battery' | 'network' | 'accessibility' | 'compatibility' | 'crash' | 'anr';
  module: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  title: string;
  description: string;
  screenName: string;
  activity: string;
  stepsToReproduce: string[];
  expectedResult: string;
  actualResult: string;
  /** Raw proof: logcat excerpt, dumpsys slice, measured numbers, node dump. */
  evidence: string;
  rootCause: string;
  suggestedFix: string;
  stackTrace?: string | null;
  screenshotDataUrl?: string | null;
}

/** Result of one executed check — becomes a QaTestCaseResult row. */
export interface CheckOutcome {
  testCaseId: string;
  name: string;
  module: string;
  screen: string;
  result: 'pass' | 'fail';
  finding?: Finding;
}
