import { randomUUID } from 'crypto';
import { runAdb, runAdbBinary, installApk } from '../../adb';
import {
  parseBatteryDump, parseCpuPercentages, parseFrameStats, parseFreeBytes,
  parseGpuMemoryKb, parseHeapKb, parseNetworkTransport, parsePackagePaths,
  parseTotalPssKb, sumApkSizes,
} from './metrics';
import { toUiTree } from './hierarchy';
import {
  emptyMetrics, fail, ok, unsupported,
  type Action, type Artefact, type DeviceDriver, type DeviceInfo, type DeviceMetrics,
  type DriverCapabilities, type DriverResult, type HttpExchange, type LaunchResult,
  type LogLine, type Orientation, type RecordingHandle, type UiTree,
} from '../types';

/**
 * Android implementation of {@link DeviceDriver}, over adb.
 *
 * It wraps the primitives the exploratory engine already proved on real
 * hardware, and adds the capabilities the platform mandate requires but did not
 * have: storage accounting, GPU memory, frame statistics, APK size,
 * uninstall/reinstall, deep-link exercise and screen recording.
 *
 * Honesty rules observed throughout:
 *  • A metric the device does not report stays `null`; nothing is defaulted to 0.
 *  • App data/cache size needs root — `du /data/data/<pkg>` is denied on a normal
 *    device (verified) — so those fields are null rather than estimated.
 *  • Network toggles are refused when adb itself is running over Wi-Fi, because
 *    disabling the radio would kill the transport mid-run.
 */
export class AndroidDriver implements DeviceDriver {
  readonly platform = 'android' as const;
  readonly targetId: string;
  private infoCache: DeviceInfo | null = null;
  private recordings = new Map<string, { devicePath: string; startedAt: number }>();

  /**
   * The field is declared and assigned explicitly rather than using a TypeScript
   * parameter property. Parameter properties require code generation, so Node's
   * strip-only TypeScript mode refuses them — and that would make this class
   * impossible to load in the test runner, which is exactly where the driver
   * contract needs to be exercised.
   */
  constructor(targetId: string) {
    this.targetId = targetId;
  }

  // ------------------------------------------------------------- primitives

  private async shell(cmd: string, timeoutMs = 20_000): Promise<string> {
    const r = await runAdb(['-s', this.targetId, 'shell', cmd], timeoutMs);
    return r.ok ? r.stdout : '';
  }

  private async prop(name: string): Promise<string> {
    return (await this.shell(`getprop ${name}`, 8_000)).trim();
  }

  capabilities(): DriverCapabilities {
    return {
      install: true,
      uninstall: true,
      clearData: true,
      launch: true,
      terminate: true,
      hierarchy: true,
      screenshot: true,
      recording: true,
      logs: true,
      metrics: {
        memory: true,
        cpu: true,
        gpu: true,
        battery: true,
        // Free space and APK size are readable; per-app data/cache is not
        // without root, and is reported as null rather than guessed.
        storage: true,
        frames: true,
        network: true,
      },
      setLocale: true,
      setOrientation: true,
      deepLinks: true,
      // Requires an instrumented proxy or VPN service; not implemented here, so
      // declared false and never faked.
      networkCapture: false,
    };
  }

  async info(): Promise<DeviceInfo> {
    if (this.infoCache) return this.infoCache;
    const [model, release, sdk, sizeOut, densityOut, chars] = await Promise.all([
      this.prop('ro.product.model'),
      this.prop('ro.build.version.release'),
      this.prop('ro.build.version.sdk'),
      this.shell('wm size', 8_000),
      this.shell('wm density', 8_000),
      this.prop('ro.build.characteristics'),
    ]);
    const size = /Override size:\s*(\d+)x(\d+)/.exec(sizeOut) ?? /Physical size:\s*(\d+)x(\d+)/.exec(sizeOut);
    const density = /Override density:\s*(\d+)/.exec(densityOut) ?? /Physical density:\s*(\d+)/.exec(densityOut);
    this.infoCache = {
      id: this.targetId,
      platform: 'android',
      model: model || this.targetId,
      osVersion: release ? `Android ${release}` : 'Android',
      apiLevel: Number(sdk) || null,
      widthPx: size ? Number(size[1]) : 1080,
      heightPx: size ? Number(size[2]) : 1920,
      densityDpi: density ? Number(density[1]) : null,
      wireless: /:\d+$/.test(this.targetId),
      emulator: /emulator|sdk_gphone|generic/i.test(model) || /emulator/i.test(chars),
    };
    return this.infoCache;
  }

  async healthCheck(): Promise<DriverResult> {
    const r = await runAdb(['-s', this.targetId, 'shell', 'echo', 'ok'], 10_000);
    if (r.ok && r.stdout.includes('ok')) return ok(`adb reachable on ${this.targetId}`);
    return fail(`Device ${this.targetId} did not respond to adb: ${r.stderr || 'no output'}`);
  }

  // -------------------------------------------------------------- lifecycle

  async install(artefact: Artefact): Promise<DriverResult> {
    if (/\.aab$/i.test(artefact.path)) {
      return unsupported(
        'adb cannot install an Android App Bundle. It must be converted to APK splits '
        + 'with bundletool first, which this host does not provide.',
      );
    }
    const res = await installApk(this.targetId, artefact.path);
    return res.ok ? ok(res.message) : fail(res.message);
  }

  async uninstall(applicationId: string): Promise<DriverResult> {
    const r = await runAdb(['-s', this.targetId, 'uninstall', applicationId], 30_000);
    const out = `${r.stdout}${r.stderr}`;
    return /Success/i.test(out) ? ok(`Uninstalled ${applicationId}`) : fail(out.trim() || 'uninstall failed');
  }

  async clearData(applicationId: string): Promise<DriverResult> {
    const out = await this.shell(`pm clear ${applicationId}`, 20_000);
    return /Success/i.test(out) ? ok(`Cleared data for ${applicationId}`) : fail(out.trim() || 'pm clear failed');
  }

  async launch(applicationId: string): Promise<LaunchResult> {
    const r = await runAdb(
      ['-s', this.targetId, 'shell', 'monkey', '-p', applicationId, '-c', 'android.intent.category.LAUNCHER', '1'],
      20_000,
    );
    const launched = r.ok && !/No activities found|aborted|Error/i.test(`${r.stdout}${r.stderr}`);
    const context = await this.focusedComponent();
    if (!context.startsWith(applicationId)) {
      return {
        ok: launched, detail: launched ? 'Launched, but the foreground component is not the app.' : 'Launch failed.',
        totalTimeMs: null, context: context || null,
      };
    }
    // Ask the platform for the authoritative timing rather than stopwatching it.
    const timed = await this.shell(`am start -W -n ${context}`, 25_000);
    const total = /TotalTime:\s*(\d+)/.exec(timed);
    return {
      ok: launched, detail: `Launched ${applicationId}`,
      totalTimeMs: total ? Number(total[1]) : null,
      context,
    };
  }

  async terminate(applicationId: string): Promise<DriverResult> {
    await this.shell(`am force-stop ${applicationId}`, 15_000);
    return ok(`Force-stopped ${applicationId}`);
  }

  async isForeground(applicationId: string): Promise<boolean> {
    return (await this.focusedComponent()).startsWith(`${applicationId}/`);
  }

  private async focusedComponent(): Promise<string> {
    const out = await this.shell('dumpsys window', 12_000);
    const m = /mCurrentFocus=Window\{[^}]*?\s([\w.]+\/[\w.$]+)/.exec(out)
      ?? /mFocusedApp=ActivityRecord\{[^}]*?\s([\w.]+\/[\w.$]+)/.exec(out);
    if (m) return m[1];
    const acts = await this.shell('dumpsys activity activities', 12_000);
    const m2 = /ResumedActivity:.*?\s([\w.]+\/[\w.$]+)/.exec(acts);
    return m2 ? m2[1] : '';
  }

  /**
   * Real installed size: the sum of every APK the package is split across.
   * Reading only `base.apk` under-reports — measured 71 MB base vs 97.8 MB total.
   */
  async packageSizeBytes(applicationId: string): Promise<number | null> {
    const paths = parsePackagePaths(await this.shell(`pm path ${applicationId}`, 12_000));
    if (paths.length === 0) return null;
    const quoted = paths.map((p) => `'${p.replace(/'/g, "'\\''")}'`).join(' ');
    const stats = await this.shell(`stat -c %s ${quoted}`, 15_000);
    return sumApkSizes(stats);
  }

  // ------------------------------------------------------------ observation

  async hierarchy(): Promise<UiTree | null> {
    const xml = await this.dumpXml();
    if (!xml) return null;
    const context = await this.focusedComponent();
    const info = await this.info();
    const rotation = await this.currentRotation();
    return toUiTree(xml, context, rotation, info);
  }

  /**
   * `uiautomator dump` costs ~2s. The working strategy differs per OEM build —
   * the /dev/tty variant produces nothing on many of them — so it is probed once
   * and remembered instead of being retried on every call.
   */
  private dumpStrategy: 'tty' | 'file' | null = null;

  private async dumpXml(): Promise<string> {
    const viaTty = async (): Promise<string> => {
      const r = await runAdb(['-s', this.targetId, 'exec-out', 'uiautomator', 'dump', '/dev/tty'], 20_000);
      return r.ok && r.stdout.includes('<hierarchy') ? r.stdout : '';
    };
    const viaFile = async (): Promise<string> => {
      const out = await this.shell(
        'uiautomator dump /sdcard/qa-driver-ui.xml >/dev/null 2>&1 && cat /sdcard/qa-driver-ui.xml', 25_000,
      );
      return out.includes('<hierarchy') ? out : '';
    };

    if (this.dumpStrategy === 'file') return viaFile();
    if (this.dumpStrategy === 'tty') return (await viaTty()) || viaFile();

    const tty = await viaTty();
    if (tty) { this.dumpStrategy = 'tty'; return tty; }
    const file = await viaFile();
    if (file) this.dumpStrategy = 'file';
    return file;
  }

  private async currentRotation(): Promise<number | null> {
    const win = await this.shell('dumpsys window', 12_000);
    const r = /mCurRotation=ROTATION_(\d+)|mRotation=(\d)/.exec(win);
    if (r) return r[1] ? Number(r[1]) : Number(r[2]) * 90;
    return null;
  }

  async screenshot(): Promise<Buffer | null> {
    const buf = await runAdbBinary(['-s', this.targetId, 'exec-out', 'screencap', '-p'], 25_000);
    return buf && buf.length > 0 ? buf : null;
  }

  /**
   * Starts `screenrecord` on the device and returns a handle that stops it and
   * pulls the file back. `screenrecord` caps a single file at 180s, so callers
   * that need longer must chain segments.
   */
  async startRecording(): Promise<RecordingHandle | null> {
    const id = randomUUID();
    const devicePath = `/sdcard/qa-recording-${id}.mp4`;
    const startedAt = Date.now();

    // Fire and forget: screenrecord runs until killed. Failure to spawn surfaces
    // as an empty pull on stop().
    void runAdb(
      ['-s', this.targetId, 'shell', `screenrecord --bit-rate 4000000 ${devicePath}`],
      190_000,
    ).catch(() => undefined);
    this.recordings.set(id, { devicePath, startedAt });

    const self = this;
    return {
      id,
      startedAt,
      async stop() {
        const entry = self.recordings.get(id);
        if (!entry) return null;
        self.recordings.delete(id);
        // screenrecord only finalises the MP4 container on SIGINT.
        await self.shell('pkill -INT screenrecord', 10_000);
        // Give the muxer a moment to close the file, polling for a stable size.
        let lastSize = -1;
        for (let i = 0; i < 10; i++) {
          const sizeOut = await self.shell(`stat -c %s ${entry.devicePath} 2>/dev/null`, 8_000);
          const size = Number(sizeOut.trim());
          if (Number.isFinite(size) && size > 0 && size === lastSize) break;
          lastSize = Number.isFinite(size) ? size : -1;
          await new Promise((r) => setTimeout(r, 300));
        }
        const data = await runAdbBinary(['-s', self.targetId, 'exec-out', 'cat', entry.devicePath], 60_000);
        await self.shell(`rm -f ${entry.devicePath}`, 10_000);
        if (!data || data.length === 0) return null;
        return { data, contentType: 'video/mp4', durationMs: Date.now() - entry.startedAt };
      },
    };
  }

  async logs(sinceMs?: number): Promise<LogLine[]> {
    const args = ['-s', this.targetId, 'logcat', '-d', '-v', 'epoch'];
    const r = await runAdb(args, 25_000);
    if (!r.ok) return [];
    const out: LogLine[] = [];
    const levelMap: Record<string, LogLine['level']> = {
      V: 'debug', D: 'debug', I: 'info', W: 'warn', E: 'error', F: 'fatal',
    };
    for (const line of r.stdout.split('\n')) {
      // epoch format: "  1712345678.123  1234  1234 E Tag: message"
      const m = /^\s*(\d+)\.(\d+)\s+\d+\s+\d+\s+([VDIWEF])\s+([^:]*):\s?(.*)$/.exec(line);
      if (!m) continue;
      const at = Number(m[1]) * 1000 + Number(m[2].slice(0, 3));
      if (sinceMs && at < sinceMs) continue;
      out.push({ at, level: levelMap[m[3]] ?? 'info', tag: m[4].trim(), message: m[5] });
    }
    return out;
  }

  async metrics(applicationId: string): Promise<DeviceMetrics> {
    const [meminfo, gfx, battery, cpu, connectivity, df, apkBytes] = await Promise.all([
      this.shell(`dumpsys meminfo ${applicationId}`, 20_000).catch(() => ''),
      this.shell(`dumpsys gfxinfo ${applicationId}`, 20_000).catch(() => ''),
      this.shell('dumpsys battery', 12_000).catch(() => ''),
      this.shell('dumpsys cpuinfo', 20_000).catch(() => ''),
      this.shell('dumpsys connectivity', 20_000).catch(() => ''),
      this.shell('df /data', 10_000).catch(() => ''),
      this.packageSizeBytes(applicationId).catch(() => null),
    ]);

    const heap = parseHeapKb(meminfo);
    const frames = parseFrameStats(gfx);
    const bat = parseBatteryDump(battery);
    const cpuPct = parseCpuPercentages(cpu, applicationId);

    return {
      ...emptyMetrics(),
      memoryPssKb: parseTotalPssKb(meminfo),
      memoryJavaHeapKb: heap.java,
      memoryNativeHeapKb: heap.native,
      cpuAppPct: cpuPct.appPct,
      cpuTotalPct: cpuPct.totalPct,
      gpuMemoryKb: parseGpuMemoryKb(gfx),
      batteryPct: bat.levelPct,
      batteryTemperatureC: bat.temperatureC,
      batteryCharging: bat.charging,
      storageAppBytes: apkBytes,
      // Per-app data/cache size requires root: `du /data/data/<pkg>` is denied on
      // a normal device. Left null instead of reporting a figure we cannot read.
      storageDataBytes: null,
      storageCacheBytes: null,
      storageFreeBytes: parseFreeBytes(df),
      networkType: parseNetworkTransport(connectivity),
      framesTotal: frames.total,
      framesJankyPct: frames.jankyPct,
      capturedAt: Date.now(),
    };
  }

  async networkTraffic(): Promise<HttpExchange[]> {
    // Capturing app traffic needs an instrumented proxy or a VPN service on the
    // device. Neither exists here, and inventing exchanges would be fabrication,
    // so this returns nothing and `capabilities().networkCapture` is false.
    return [];
  }

  // ------------------------------------------------------------ interaction

  async perform(action: Action): Promise<DriverResult> {
    try {
      switch (action.kind) {
        case 'tap':
          await this.shell(`input tap ${action.x} ${action.y}`, 10_000);
          return ok(`tap(${action.x},${action.y})`);
        case 'double_tap':
          await this.shell(`input tap ${action.x} ${action.y}; input tap ${action.x} ${action.y}`, 10_000);
          return ok(`doubleTap(${action.x},${action.y})`);
        case 'long_press':
          await this.shell(
            `input swipe ${action.x} ${action.y} ${action.x} ${action.y} ${action.ms ?? 800}`, 12_000,
          );
          return ok(`longPress(${action.x},${action.y})`);
        case 'swipe':
          await this.shell(
            `input swipe ${action.from.x} ${action.from.y} ${action.to.x} ${action.to.y} ${action.ms ?? 300}`, 12_000,
          );
          return ok(`swipe(${action.from.x},${action.from.y} → ${action.to.x},${action.to.y})`);
        case 'type': {
          const safe = action.text.replace(/(["\\$`])/g, '\\$1').replace(/ /g, '%s');
          await this.shell(`input text "${safe}"`, 12_000);
          return ok(`type(${action.text.length} chars)`);
        }
        case 'clear':
          await this.shell('input keyevent KEYCODE_MOVE_END', 8_000);
          await this.shell(`input keyevent ${Array(60).fill('KEYCODE_DEL').join(' ')}`, 15_000);
          return ok('clear()');
        case 'key': {
          const map: Record<string, string> = {
            back: 'KEYCODE_BACK', home: 'KEYCODE_HOME', enter: 'KEYCODE_ENTER',
            escape: 'KEYCODE_ESCAPE', app_switch: 'KEYCODE_APP_SWITCH', wake: 'KEYCODE_WAKEUP',
          };
          await this.shell(`input keyevent ${map[action.key]}`, 10_000);
          return ok(`key(${action.key})`);
        }
        default:
          return unsupported(`Unknown action: ${JSON.stringify(action)}`);
      }
    } catch (e) {
      return fail(`Action failed: ${(e as Error)?.message}`);
    }
  }

  /**
   * Changes the system locale, which is what makes real localization testing
   * possible rather than merely scanning for untranslated keys. Requires the
   * CHANGE_CONFIGURATION permission, which adb shell holds.
   */
  async setLocale(locale: string): Promise<DriverResult> {
    if (!/^[a-z]{2}(-[A-Z]{2})?$/.test(locale)) {
      return fail(`"${locale}" is not a BCP-47 language tag such as en-US or ar-EG.`);
    }
    const before = (await this.shell('getprop persist.sys.locale', 8_000)).trim();
    await this.shell(`settings put system system_locales ${locale}`, 10_000);
    const out = await this.shell(`setprop persist.sys.locale ${locale}`, 10_000);
    const after = (await this.shell('getprop persist.sys.locale', 8_000)).trim();
    if (after.toLowerCase() !== locale.toLowerCase()) {
      return fail(
        `Locale did not change (still "${after || before || 'unknown'}"). `
        + `The device may restrict locale changes.${out ? ` Output: ${out.trim()}` : ''}`,
      );
    }
    return ok(`Locale set to ${locale} (was ${before || 'unknown'})`);
  }

  async setOrientation(orientation: Orientation): Promise<DriverResult> {
    await this.shell('settings put system accelerometer_rotation 0', 8_000);
    await this.shell(`settings put system user_rotation ${orientation === 'landscape' ? 1 : 0}`, 8_000);
    return ok(`Orientation set to ${orientation}`);
  }

  /**
   * Exercises a deep link exactly as an external app would, then reports where
   * the device actually landed — an unhandled link is a real, reportable defect.
   */
  async openDeepLink(url: string, applicationId?: string): Promise<DriverResult> {
    const escaped = url.replace(/(["\\$`&|;<>()])/g, '\\$1');
    const target = applicationId ? ` ${applicationId}` : '';
    const out = await this.shell(
      `am start -a android.intent.action.VIEW -d "${escaped}"${target}`, 20_000,
    );
    if (/Error|Exception|does not exist/i.test(out)) {
      return fail(`Deep link "${url}" was not handled: ${out.trim().slice(0, 200)}`);
    }
    const landed = await this.focusedComponent();
    if (applicationId && landed && !landed.startsWith(applicationId)) {
      return fail(`Deep link "${url}" opened ${landed} instead of ${applicationId}.`);
    }
    return ok(`Deep link "${url}" opened ${landed || 'an unresolved component'}`);
  }

  async dispose(): Promise<void> {
    // Stop any recording still running so the device is left clean.
    const active = Array.from(this.recordings.values());
    for (const entry of active) {
      await this.shell('pkill -INT screenrecord', 8_000).catch(() => '');
      await this.shell(`rm -f ${entry.devicePath}`, 8_000).catch(() => '');
    }
    this.recordings.clear();
  }
}
