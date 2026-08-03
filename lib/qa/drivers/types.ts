/**
 * The DeviceDriver contract — one interface for every execution target.
 *
 * Everything above this line (planning, vision, bug detection, regression,
 * reporting) is written against these types and therefore knows nothing about
 * adb, WebDriverAgent or the DOM. That is what makes the intelligence layer
 * platform-agnostic, and what makes it testable: a `FakeDriver` satisfies this
 * contract without any hardware.
 *
 * Two rules the contract enforces by design:
 *
 *  1. **Capabilities are declared, never assumed.** A driver states what it can
 *     actually do via {@link DeviceDriver.capabilities}. Callers must check
 *     before using a facility, and an unsupported operation returns an explicit
 *     `unsupported` result — it never returns a plausible-looking empty value
 *     that would read as a measurement.
 *  2. **Absence is representable.** Every metric is `number | null`. A device
 *     that does not report GPU memory yields `null`, which the report renders as
 *     "—". No zero is ever substituted for an unknown.
 */

export type Platform = 'android' | 'ios' | 'web';

export interface Bounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/**
 * Semantic role of an element, normalised across platforms so a planner rule can
 * say "prefer a button" without knowing whether it came from an Android
 * `android.widget.Button`, an iOS `XCUIElementTypeButton`, or a DOM `<button>`.
 */
export type ElementRole =
  | 'button' | 'link' | 'text' | 'input' | 'image' | 'checkbox' | 'switch'
  | 'radio' | 'list' | 'listitem' | 'tab' | 'menu' | 'dialog' | 'progress'
  | 'video' | 'webview' | 'container' | 'unknown';

export interface UiElement {
  /** Stable within one tree; used to correlate elements across observations. */
  id: string;
  role: ElementRole;
  /** Visible text, or the accessibility label when there is no text. */
  label: string;
  /** Developer-assigned identifier: resource-id / accessibilityIdentifier / DOM id. */
  identifier: string;
  bounds: Bounds;
  enabled: boolean;
  focused: boolean;
  selected: boolean;
  editable: boolean;
  scrollable: boolean;
  clickable: boolean;
  longClickable: boolean;
  /** Depth in the tree, for distinguishing containers from leaves. */
  depth: number;
  /**
   * Platform-specific attributes, preserved verbatim. Detectors that legitimately
   * need native detail (ad-SDK class names, package ownership) read this rather
   * than forcing platform concepts into the normalised shape.
   */
  native: Record<string, string | number | boolean>;
}

export interface UiTree {
  elements: UiElement[];
  /** Foreground activity / view controller / URL, as the platform reports it. */
  context: string;
  /** Owning application identifier, when the platform exposes one. */
  application: string;
  rotationDegrees: number | null;
  capturedAt: number;
  /**
   * The untouched platform payload (uiautomator XML, WDA JSON, serialised DOM).
   * Retained so existing platform-specific analysis keeps working during the
   * migration, and so evidence can record exactly what was observed.
   */
  raw: string;
}

// ------------------------------------------------------------------- actions

export type NamedKey = 'back' | 'home' | 'enter' | 'escape' | 'app_switch' | 'wake';

export type Action =
  | { kind: 'tap'; x: number; y: number }
  | { kind: 'double_tap'; x: number; y: number }
  | { kind: 'long_press'; x: number; y: number; ms?: number }
  | { kind: 'swipe'; from: { x: number; y: number }; to: { x: number; y: number }; ms?: number }
  | { kind: 'type'; text: string }
  | { kind: 'clear' }
  | { kind: 'key'; key: NamedKey };

export type Orientation = 'portrait' | 'landscape';

// ------------------------------------------------------------------ results

/**
 * Outcome of a driver operation.
 *
 * `unsupported` is a first-class outcome, distinct from `ok: false`. "This
 * driver cannot record video" and "recording was attempted and failed" are
 * different facts, and the run report must be able to tell them apart.
 */
export interface DriverResult {
  ok: boolean;
  unsupported?: boolean;
  detail: string;
}

export const ok = (detail = ''): DriverResult => ({ ok: true, detail });
export const fail = (detail: string): DriverResult => ({ ok: false, detail });
export const unsupported = (detail: string): DriverResult =>
  ({ ok: false, unsupported: true, detail });

// ------------------------------------------------------------------ metrics

/** Every field is nullable: a value is present only when actually measured. */
export interface DeviceMetrics {
  /** Proportional set size attributed to the app, in KB. */
  memoryPssKb: number | null;
  memoryJavaHeapKb: number | null;
  memoryNativeHeapKb: number | null;
  /** CPU percentage attributed to the app under test. */
  cpuAppPct: number | null;
  cpuTotalPct: number | null;
  gpuMemoryKb: number | null;
  batteryPct: number | null;
  batteryTemperatureC: number | null;
  batteryCharging: boolean | null;
  /** Bytes the app occupies: code + data + cache. */
  storageAppBytes: number | null;
  storageDataBytes: number | null;
  storageCacheBytes: number | null;
  /** Free space on the data partition. */
  storageFreeBytes: number | null;
  networkType: string | null;
  /** Frame statistics from the platform's own render profiler. */
  framesTotal: number | null;
  framesJankyPct: number | null;
  capturedAt: number;
}

export function emptyMetrics(): DeviceMetrics {
  return {
    memoryPssKb: null, memoryJavaHeapKb: null, memoryNativeHeapKb: null,
    cpuAppPct: null, cpuTotalPct: null, gpuMemoryKb: null,
    batteryPct: null, batteryTemperatureC: null, batteryCharging: null,
    storageAppBytes: null, storageDataBytes: null, storageCacheBytes: null,
    storageFreeBytes: null, networkType: null,
    framesTotal: null, framesJankyPct: null,
    capturedAt: Date.now(),
  };
}

export interface DeviceInfo {
  id: string;
  platform: Platform;
  model: string;
  osVersion: string;
  apiLevel: number | null;
  widthPx: number;
  heightPx: number;
  densityDpi: number | null;
  /** True when the transport itself is wireless — network toggles then unsafe. */
  wireless: boolean;
  emulator: boolean;
}

export interface LogLine {
  at: number;
  level: 'debug' | 'info' | 'warn' | 'error' | 'fatal';
  tag: string;
  message: string;
}

export interface LaunchResult extends DriverResult {
  /** Authoritative launch timing from the platform, when it reports one. */
  totalTimeMs: number | null;
  /** The context the app landed on. */
  context: string | null;
}

export interface Artefact {
  /** Filesystem path to an installable binary. */
  path: string;
  /** Application identifier the binary declares, when already known. */
  applicationId?: string;
}

export interface RecordingHandle {
  id: string;
  startedAt: number;
  /** Resolves with the recorded bytes, or null when nothing was captured. */
  stop(): Promise<{ data: Buffer; contentType: string; durationMs: number } | null>;
}

// ------------------------------------------------------------- capabilities

/**
 * What a driver can genuinely do. Anything false must not be attempted; the
 * caller records the gap as a coverage limitation instead of inventing a result.
 */
export interface DriverCapabilities {
  install: boolean;
  uninstall: boolean;
  clearData: boolean;
  launch: boolean;
  terminate: boolean;
  hierarchy: boolean;
  screenshot: boolean;
  recording: boolean;
  logs: boolean;
  /** Which metric families this driver can actually read. */
  metrics: {
    memory: boolean;
    cpu: boolean;
    gpu: boolean;
    battery: boolean;
    storage: boolean;
    frames: boolean;
    network: boolean;
  };
  setLocale: boolean;
  setOrientation: boolean;
  deepLinks: boolean;
  /** Captures HTTP(S) exchanges made by the app under test. */
  networkCapture: boolean;
}

export interface HttpExchange {
  at: number;
  method: string;
  url: string;
  status: number | null;
  durationMs: number | null;
  requestBytes: number | null;
  responseBytes: number | null;
  protocol: 'http' | 'https' | 'ws' | 'wss' | 'unknown';
}

// ---------------------------------------------------------------- the driver

export interface DeviceDriver {
  readonly platform: Platform;
  /** Opaque target identifier: adb serial, iOS UDID, or browser context id. */
  readonly targetId: string;

  capabilities(): DriverCapabilities;
  info(): Promise<DeviceInfo>;
  /** Confirms the target is genuinely reachable right now. */
  healthCheck(): Promise<DriverResult>;

  // lifecycle
  install(artefact: Artefact): Promise<DriverResult>;
  uninstall(applicationId: string): Promise<DriverResult>;
  clearData(applicationId: string): Promise<DriverResult>;
  launch(applicationId: string): Promise<LaunchResult>;
  terminate(applicationId: string): Promise<DriverResult>;
  isForeground(applicationId: string): Promise<boolean>;
  /** Bytes the installed binary occupies on the device, when discoverable. */
  packageSizeBytes(applicationId: string): Promise<number | null>;

  // observation
  hierarchy(): Promise<UiTree | null>;
  screenshot(): Promise<Buffer | null>;
  startRecording(): Promise<RecordingHandle | null>;
  logs(sinceMs?: number): Promise<LogLine[]>;
  metrics(applicationId: string): Promise<DeviceMetrics>;
  networkTraffic(): Promise<HttpExchange[]>;

  // interaction
  perform(action: Action): Promise<DriverResult>;
  setLocale(locale: string): Promise<DriverResult>;
  setOrientation(orientation: Orientation): Promise<DriverResult>;
  /** Exercises a deep link / universal link, returning where it landed. */
  openDeepLink(url: string, applicationId?: string): Promise<DriverResult>;

  /** Releases anything the driver holds open (streams, sessions, temp files). */
  dispose(): Promise<void>;
}
