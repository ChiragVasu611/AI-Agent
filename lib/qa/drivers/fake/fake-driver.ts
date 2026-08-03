import {
  emptyMetrics, fail, ok, unsupported,
  type Action, type Artefact, type DeviceDriver, type DeviceInfo, type DeviceMetrics,
  type DriverCapabilities, type DriverResult, type ElementRole, type HttpExchange,
  type LaunchResult, type LogLine, type Orientation, type Platform,
  type RecordingHandle, type UiElement, type UiTree,
} from '../types';

/**
 * An in-memory {@link DeviceDriver} for tests.
 *
 * It exists so the layers above the driver — planning, interruption handling,
 * bug detection, regression comparison — can be tested deterministically with no
 * device, no adb and no network. Screens are scripted, actions are recorded, and
 * capabilities are configurable so callers' handling of an *unsupported*
 * facility can be exercised as deliberately as the happy path.
 *
 * This is a test double, never an execution path: it is not reachable from any
 * server action or route, and it never writes to the database.
 */

export interface FakeScreen {
  /** Identifier used in assertions and transition maps. */
  name: string;
  context: string;
  elements: Array<Partial<UiElement> & { label?: string; role?: ElementRole }>;
  /** action key → screen name it navigates to. */
  transitions?: Record<string, string>;
}

export interface FakeDriverOptions {
  platform?: Platform;
  screens: FakeScreen[];
  start?: string;
  capabilities?: Partial<DriverCapabilities>;
  info?: Partial<DeviceInfo>;
  metrics?: Partial<DeviceMetrics>;
  logs?: LogLine[];
  /** Force hierarchy() to return null, simulating an unreadable screen. */
  hierarchyUnavailable?: boolean;
}

let counter = 0;

function buildElement(seed: Partial<UiElement>, index: number): UiElement {
  const role = seed.role ?? 'unknown';
  return {
    id: seed.id ?? `e${index}`,
    role,
    label: seed.label ?? '',
    identifier: seed.identifier ?? '',
    bounds: seed.bounds ?? { left: 0, top: index * 100, right: 400, bottom: index * 100 + 80 },
    enabled: seed.enabled ?? true,
    focused: seed.focused ?? false,
    selected: seed.selected ?? false,
    editable: seed.editable ?? role === 'input',
    scrollable: seed.scrollable ?? role === 'list',
    clickable: seed.clickable ?? ['button', 'link', 'checkbox', 'switch', 'radio', 'tab'].includes(role),
    longClickable: seed.longClickable ?? false,
    depth: seed.depth ?? 1,
    native: seed.native ?? {},
  };
}

export class FakeDriver implements DeviceDriver {
  readonly platform: Platform;
  readonly targetId: string;

  /** Every action performed, in order — the primary assertion surface. */
  readonly performed: Action[] = [];
  /** Lifecycle calls recorded for assertions, e.g. ['install', 'launch']. */
  readonly calls: string[] = [];

  private screens = new Map<string, FakeScreen>();
  private current: string;
  private caps: DriverCapabilities;
  private deviceInfo: DeviceInfo;
  private metricValues: DeviceMetrics;
  private logLines: LogLine[];
  private hierarchyUnavailable: boolean;
  private orientation: Orientation = 'portrait';
  private locale = 'en-US';
  private foreground: string | null = null;
  private installed = new Set<string>();

  constructor(opts: FakeDriverOptions) {
    counter += 1;
    this.platform = opts.platform ?? 'android';
    this.targetId = `fake-${counter}`;
    for (const s of opts.screens) this.screens.set(s.name, s);
    this.current = opts.start ?? opts.screens[0]?.name ?? '';
    this.hierarchyUnavailable = opts.hierarchyUnavailable ?? false;
    this.logLines = opts.logs ?? [];

    this.caps = {
      install: true, uninstall: true, clearData: true, launch: true, terminate: true,
      hierarchy: true, screenshot: true, recording: true, logs: true,
      metrics: { memory: true, cpu: true, gpu: true, battery: true, storage: true, frames: true, network: true },
      setLocale: true, setOrientation: true, deepLinks: true, networkCapture: false,
      ...opts.capabilities,
    };

    this.deviceInfo = {
      id: this.targetId, platform: this.platform, model: 'FakeDevice',
      osVersion: 'Fake 1.0', apiLevel: 34, widthPx: 1080, heightPx: 1920,
      densityDpi: 420, wireless: false, emulator: true,
      ...opts.info,
    };

    this.metricValues = { ...emptyMetrics(), ...opts.metrics };
  }

  // ------------------------------------------------------------- test helpers

  /** Moves to a named screen, as a scripted external event would. */
  goTo(screen: string): void {
    if (!this.screens.has(screen)) throw new Error(`FakeDriver has no screen "${screen}"`);
    this.current = screen;
  }

  get currentScreen(): string { return this.current; }
  get currentLocale(): string { return this.locale; }
  get currentOrientation(): Orientation { return this.orientation; }
  setHierarchyUnavailable(v: boolean): void { this.hierarchyUnavailable = v; }

  // ----------------------------------------------------------------- driver

  capabilities(): DriverCapabilities { return this.caps; }
  async info(): Promise<DeviceInfo> { return this.deviceInfo; }
  async healthCheck(): Promise<DriverResult> { return ok('FakeDriver is always reachable'); }

  async install(artefact: Artefact): Promise<DriverResult> {
    this.calls.push('install');
    if (!this.caps.install) return unsupported('FakeDriver: install disabled');
    this.installed.add(artefact.applicationId ?? artefact.path);
    return ok(`installed ${artefact.path}`);
  }

  async uninstall(applicationId: string): Promise<DriverResult> {
    this.calls.push('uninstall');
    if (!this.caps.uninstall) return unsupported('FakeDriver: uninstall disabled');
    this.installed.delete(applicationId);
    return ok(`uninstalled ${applicationId}`);
  }

  async clearData(applicationId: string): Promise<DriverResult> {
    this.calls.push('clearData');
    if (!this.caps.clearData) return unsupported('FakeDriver: clearData disabled');
    return ok(`cleared ${applicationId}`);
  }

  async launch(applicationId: string): Promise<LaunchResult> {
    this.calls.push('launch');
    if (!this.caps.launch) {
      return { ok: false, unsupported: true, detail: 'FakeDriver: launch disabled', totalTimeMs: null, context: null };
    }
    this.foreground = applicationId;
    const screen = this.screens.get(this.current);
    return { ok: true, detail: `launched ${applicationId}`, totalTimeMs: 512, context: screen?.context ?? null };
  }

  async terminate(applicationId: string): Promise<DriverResult> {
    this.calls.push('terminate');
    this.foreground = null;
    return ok(`terminated ${applicationId}`);
  }

  async isForeground(applicationId: string): Promise<boolean> {
    return this.foreground === applicationId;
  }

  async packageSizeBytes(): Promise<number | null> {
    return this.metricValues.storageAppBytes;
  }

  async hierarchy(): Promise<UiTree | null> {
    if (this.hierarchyUnavailable || !this.caps.hierarchy) return null;
    const screen = this.screens.get(this.current);
    if (!screen) return null;
    const elements = screen.elements.map((e, i) => buildElement(e as Partial<UiElement>, i));
    return {
      elements,
      context: screen.context,
      application: this.foreground ?? 'com.fake.app',
      rotationDegrees: this.orientation === 'portrait' ? 0 : 90,
      capturedAt: Date.now(),
      raw: `<fake screen="${screen.name}"/>`,
    };
  }

  async screenshot(): Promise<Buffer | null> {
    if (!this.caps.screenshot) return null;
    // A minimal, VALID 1x1 PNG — real bytes, so callers that decode or hash it
    // behave exactly as they would with a device capture.
    return Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
      'base64',
    );
  }

  async startRecording(): Promise<RecordingHandle | null> {
    if (!this.caps.recording) return null;
    const startedAt = Date.now();
    return {
      id: 'fake-recording',
      startedAt,
      async stop() {
        return { data: Buffer.from('fake-mp4'), contentType: 'video/mp4', durationMs: Date.now() - startedAt };
      },
    };
  }

  async logs(sinceMs?: number): Promise<LogLine[]> {
    if (!this.caps.logs) return [];
    return sinceMs ? this.logLines.filter((l) => l.at >= sinceMs) : this.logLines;
  }

  async metrics(): Promise<DeviceMetrics> {
    return { ...this.metricValues, capturedAt: Date.now() };
  }

  async networkTraffic(): Promise<HttpExchange[]> { return []; }

  async perform(action: Action): Promise<DriverResult> {
    this.performed.push(action);

    // Scripted navigation: a tap whose coordinates land inside an element moves
    // to whatever screen that element's transition names.
    const screen = this.screens.get(this.current);
    if (screen && (action.kind === 'tap' || action.kind === 'double_tap')) {
      const elements = screen.elements.map((e, i) => buildElement(e as Partial<UiElement>, i));
      const hit = elements.find(
        (e) => action.x >= e.bounds.left && action.x <= e.bounds.right
          && action.y >= e.bounds.top && action.y <= e.bounds.bottom,
      );
      const key = hit?.label || hit?.identifier;
      const next = key ? screen.transitions?.[key] : undefined;
      if (next && this.screens.has(next)) this.current = next;
    }
    return ok(`${action.kind} performed`);
  }

  async setLocale(locale: string): Promise<DriverResult> {
    this.calls.push('setLocale');
    if (!this.caps.setLocale) return unsupported('FakeDriver: setLocale disabled');
    if (!/^[a-z]{2}(-[A-Z]{2})?$/.test(locale)) return fail(`"${locale}" is not a BCP-47 tag`);
    this.locale = locale;
    return ok(`locale ${locale}`);
  }

  async setOrientation(orientation: Orientation): Promise<DriverResult> {
    this.calls.push('setOrientation');
    if (!this.caps.setOrientation) return unsupported('FakeDriver: setOrientation disabled');
    this.orientation = orientation;
    return ok(`orientation ${orientation}`);
  }

  async openDeepLink(url: string): Promise<DriverResult> {
    this.calls.push('openDeepLink');
    if (!this.caps.deepLinks) return unsupported('FakeDriver: deep links disabled');
    return ok(`opened ${url}`);
  }

  async dispose(): Promise<void> { this.calls.push('dispose'); }
}
