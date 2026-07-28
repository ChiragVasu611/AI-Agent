import type { CheckOutcome, DeviceProfile, Finding, ScreenState } from './types';
import { QA_MODULE_BY_KEY } from '@/lib/qa/modules';
import { auditAccessibility } from './accessibility';
import { auditLayout, auditRotation } from './ui-checks';
import { measurePerformance } from './performance';
import { sampleMemory, analyzeMemory, type MemorySample } from './memory';
import { sampleBattery, analyzeBattery, type BatterySample } from './battery';
import { analyzeNetwork } from './network';
import { grantedPermissions, setRotation, shell, isAppForeground, startAppTimed } from './device';
import { observeScreen } from './explorer';
import { waitForStableUi } from './smart-wait';
import { labelOf, isEditable } from './ui-parser';
import type { ScreenGraph } from './graph';
import type { CrashMonitor } from './crash-monitor';

/**
 * Module dispatcher.
 *
 * Only the modules the user selected are executed — an unchecked module never
 * runs and never contributes a result row. Modules fall into three phases:
 *
 *  • per-screen   — run against every newly discovered screen (UI, a11y…)
 *  • post-run     — run once after exploration (performance, memory, battery…)
 *  • dedicated    — need their own device phase (monkey, rotation/compat)
 *
 * Each executor decides its own completion and reports both passing checks and
 * evidence-backed findings.
 */

export function labelFor(key: string): string {
  return QA_MODULE_BY_KEY.get(key)?.label ?? key;
}

/** Modules that inspect each discovered screen as exploration proceeds. */
const PER_SCREEN = new Set(['ui_ux', 'accessibility', 'functional', 'regression', 'localization', 'e2e', 'smoke', 'sanity']);
/** Modules that run once, after the app has been explored. */
const POST_RUN = new Set(['performance', 'memory', 'battery', 'network', 'api', 'security']);
/** Modules requiring a dedicated device phase. */
const DEDICATED = new Set(['monkey', 'compatibility', 'ai_exploratory']);

export class ModulePlan {
  readonly selected: Set<string>;

  constructor(keys: string[]) {
    this.selected = new Set(keys.filter((k) => QA_MODULE_BY_KEY.has(k)));
  }

  has(key: string): boolean {
    return this.selected.has(key);
  }

  get anyPerScreen(): boolean {
    return Array.from(this.selected).some((k) => PER_SCREEN.has(k));
  }

  get postRunModules(): string[] {
    return Array.from(this.selected).filter((k) => POST_RUN.has(k));
  }

  get dedicatedModules(): string[] {
    return Array.from(this.selected).filter((k) => DEDICATED.has(k));
  }

  /** Crash/ANR monitoring is passive; it only FILES bugs when selected. */
  get reportsCrashes(): boolean {
    return this.has('crash_detection') || this.has('monkey') || this.has('e2e') || this.has('sanity');
  }

  get reportsAnr(): boolean {
    return this.has('anr_detection') || this.has('monkey') || this.has('e2e');
  }

  list(): string[] {
    return Array.from(this.selected);
  }
}

// ------------------------------------------------------------- per-screen

let checkSeq = 0;
function nextId(prefix: string): string {
  checkSeq += 1;
  return `TC-${prefix}-${String(checkSeq).padStart(3, '0')}`;
}

export function resetCheckSequence(): void {
  checkSeq = 0;
}

/**
 * Functional verification of a single screen, derived entirely from its live
 * hierarchy: a usable screen must present at least one enabled, reachable
 * control (or be a deliberate terminal//content screen).
 */
function functionalChecks(state: ScreenState, moduleLabel: string): CheckOutcome[] {
  const out: CheckOutcome[] = [];
  const interactive = state.nodes.filter((n) => (n.clickable || n.checkable || isEditable(n)) && n.enabled);
  const anyContent = state.nodes.some((n) => labelOf(n).length > 0);

  const usable = interactive.length > 0 || state.kind === 'splash' || state.kind === 'video';
  out.push({
    testCaseId: nextId('FUNC'),
    name: `"${state.label}" exposes usable controls`,
    module: moduleLabel,
    screen: state.label,
    result: usable ? 'pass' : 'fail',
    finding: usable ? undefined : {
      type: 'functional',
      module: moduleLabel,
      severity: 'high',
      title: `"${state.label}" has no enabled interactive controls`,
      description: 'The screen rendered without any enabled control, so a user reaching it cannot proceed or go back within the screen itself.',
      screenName: state.label,
      activity: state.activity,
      stepsToReproduce: [`Launch the app`, `Navigate to "${state.label}"`, 'Attempt to interact with the screen'],
      expectedResult: 'The screen offers at least one enabled control or a clear way forward.',
      actualResult: `${state.nodes.length} element(s) present, none clickable/editable and enabled.`,
      evidence: state.nodes.slice(0, 25).map((n) => `${n.className} enabled=${n.enabled} clickable=${n.clickable} text="${n.text.slice(0, 40)}"`).join('\n'),
      rootCause: 'Controls are disabled pending data that never arrives, or the layout failed to bind.',
      suggestedFix: 'Ensure a loading/error state is rendered when data is unavailable, and re-enable controls once binding completes.',
    },
  });

  // An empty screen with neither content nor controls is a blank-render defect.
  if (!anyContent && interactive.length === 0 && state.kind !== 'splash') {
    out.push({
      testCaseId: nextId('FUNC'),
      name: `"${state.label}" renders content`,
      module: moduleLabel,
      screen: state.label,
      result: 'fail',
      finding: {
        type: 'functional',
        module: moduleLabel,
        severity: 'high',
        title: `"${state.label}" renders no visible text or controls`,
        description: 'The screen produced an accessibility tree with no readable content at all, which presents as a blank screen to the user.',
        screenName: state.label,
        activity: state.activity,
        stepsToReproduce: [`Navigate to "${state.label}"`, 'Observe the rendered screen'],
        expectedResult: 'The screen shows content, or an explicit empty/error state.',
        actualResult: 'No text, content description, or interactive element was found in the hierarchy.',
        evidence: `Node count: ${state.nodes.length}; activity: ${state.activity}`,
        rootCause: 'A failed data load or an inflation error left the view tree empty with no fallback UI.',
        suggestedFix: 'Render an explicit empty state and an error state with a retry action instead of an empty container.',
      },
    });
  } else {
    out.push({
      testCaseId: nextId('FUNC'),
      name: `"${state.label}" renders content`,
      module: moduleLabel,
      screen: state.label,
      result: 'pass',
    });
  }

  return out;
}

/** Smoke/sanity: the screen belongs to the app and is responsive. */
function smokeChecks(state: ScreenState, moduleLabel: string, pkg: string): CheckOutcome[] {
  const inApp = !pkg || state.packageName.startsWith(pkg);
  return [{
    testCaseId: nextId('SMOKE'),
    name: `"${state.label}" is served by the app under test`,
    module: moduleLabel,
    screen: state.label,
    result: inApp ? 'pass' : 'fail',
    finding: inApp ? undefined : {
      type: 'functional',
      module: moduleLabel,
      severity: 'low',
      title: `"${state.label}" is rendered by ${state.packageName}, not the app under test`,
      description: 'Navigation left the application package.',
      screenName: state.label,
      activity: state.activity,
      stepsToReproduce: [`Navigate to "${state.label}"`],
      expectedResult: `The screen belongs to ${pkg}.`,
      actualResult: `Owning package: ${state.packageName}.`,
      evidence: `activity=${state.activity} package=${state.packageName}`,
      rootCause: 'An intent handed control to an external application.',
      suggestedFix: 'Verify this hand-off is intentional; consider Custom Tabs for web content to keep users in-app.',
    },
  }];
}

/**
 * Localization sanity: detects untranslated placeholder keys and unresolved
 * string resources leaking into the UI — both are real, verifiable defects.
 */
function localizationChecks(state: ScreenState, moduleLabel: string): CheckOutcome[] {
  const suspicious = state.nodes.filter((n) => {
    const t = n.text?.trim() ?? '';
    if (!t) return false;
    // Untranslated resource keys / format placeholders that reached the UI.
    return /^[a-z][a-z0-9_]{4,}$/.test(t) && t.includes('_')
      || /%[sd@]|\{\{?\w+\}?\}/.test(t)
      || /^string\//.test(t);
  });

  if (suspicious.length === 0) {
    return [{ testCaseId: nextId('L10N'), name: `"${state.label}" has no untranslated placeholders`, module: moduleLabel, screen: state.label, result: 'pass' }];
  }

  return [{
    testCaseId: nextId('L10N'),
    name: `"${state.label}" has no untranslated placeholders`,
    module: moduleLabel,
    screen: state.label,
    result: 'fail',
    finding: {
      type: 'ui',
      module: moduleLabel,
      severity: 'medium',
      title: `${suspicious.length} untranslated or unformatted string(s) on "${state.label}"`,
      description: 'Raw resource keys or unsubstituted format placeholders are visible in the UI.',
      screenName: state.label,
      activity: state.activity,
      stepsToReproduce: [`Navigate to "${state.label}"`, 'Read the displayed labels'],
      expectedResult: 'All visible strings are localized and fully formatted.',
      actualResult: suspicious.slice(0, 6).map((n) => `  • "${n.text.slice(0, 60)}"`).join('\n'),
      evidence: suspicious.slice(0, 12).map((n) => `${n.className}: "${n.text.slice(0, 80)}"`).join('\n'),
      rootCause: 'A missing translation falls back to the resource key, or String.format arguments were not supplied.',
      suggestedFix: 'Add the missing translations and pass all format arguments; add a lint check for untranslated resources.',
    },
  }];
}

/** Runs every selected per-screen module against one screen. */
export function runPerScreenModules(
  state: ScreenState,
  plan: ModulePlan,
  packageName: string,
  densityDpi: number,
): CheckOutcome[] {
  const outcomes: CheckOutcome[] = [];

  if (plan.has('functional') || plan.has('regression') || plan.has('e2e')) {
    const label = labelFor(plan.has('functional') ? 'functional' : plan.has('regression') ? 'regression' : 'e2e');
    outcomes.push(...functionalChecks(state, label));
  }

  if (plan.has('ui_ux') || plan.has('regression')) {
    const label = labelFor(plan.has('ui_ux') ? 'ui_ux' : 'regression');
    const findings = auditLayout(state, label);
    outcomes.push({
      testCaseId: nextId('UI'),
      name: `"${state.label}" layout is free of overflow/overlap defects`,
      module: label,
      screen: state.label,
      result: findings.length === 0 ? 'pass' : 'fail',
      finding: findings[0],
    });
    // Additional findings beyond the first are reported as their own rows.
    for (const f of findings.slice(1)) {
      outcomes.push({ testCaseId: nextId('UI'), name: f.title, module: label, screen: state.label, result: 'fail', finding: f });
    }
  }

  if (plan.has('accessibility')) {
    const label = labelFor('accessibility');
    const findings = auditAccessibility(state, label, densityDpi);
    outcomes.push({
      testCaseId: nextId('A11Y'),
      name: `"${state.label}" meets basic accessibility requirements`,
      module: label,
      screen: state.label,
      result: findings.length === 0 ? 'pass' : 'fail',
      finding: findings[0],
    });
    for (const f of findings.slice(1)) {
      outcomes.push({ testCaseId: nextId('A11Y'), name: f.title, module: label, screen: state.label, result: 'fail', finding: f });
    }
  }

  if (plan.has('smoke') || plan.has('sanity')) {
    const label = labelFor(plan.has('smoke') ? 'smoke' : 'sanity');
    outcomes.push(...smokeChecks(state, label, packageName));
  }

  if (plan.has('localization')) {
    outcomes.push(...localizationChecks(state, labelFor('localization')));
  }

  return outcomes;
}

// --------------------------------------------------------------- post-run

export interface PostRunContext {
  serial: string;
  packageName: string;
  profile: DeviceProfile;
  screensVisited: number;
  primaryScreen: string;
  memoryBaseline: MemorySample | null;
  batteryStart: BatterySample | null;
  runDurationMs: number;
  log: (level: 'debug' | 'info' | 'warn' | 'error', message: string) => Promise<void>;
}

export interface PostRunResult {
  outcomes: CheckOutcome[];
  findings: Finding[];
  notes: string[];
}

/** Security posture derived from real package state — no speculative claims. */
async function securityChecks(ctx: PostRunContext, moduleLabel: string): Promise<PostRunResult> {
  const outcomes: CheckOutcome[] = [];
  const findings: Finding[] = [];
  const notes: string[] = [];

  const dump = await grantedPermissions(ctx.serial, ctx.packageName);

  // Dangerous permissions actually granted to the app.
  const granted = Array.from(
    new Set(
      (dump.match(/android\.permission\.[A-Z_]+:\s*granted=true/g) ?? [])
        .map((l) => l.split(':')[0].replace('android.permission.', '')),
    ),
  );
  const DANGEROUS = ['READ_SMS', 'RECEIVE_SMS', 'READ_CONTACTS', 'ACCESS_FINE_LOCATION', 'RECORD_AUDIO', 'CAMERA', 'READ_CALL_LOG', 'READ_PHONE_STATE', 'READ_EXTERNAL_STORAGE', 'WRITE_EXTERNAL_STORAGE'];
  const sensitive = granted.filter((p) => DANGEROUS.includes(p));

  outcomes.push({
    testCaseId: nextId('SEC'),
    name: 'App does not hold an excessive set of sensitive permissions',
    module: moduleLabel,
    screen: ctx.primaryScreen,
    result: sensitive.length <= 4 ? 'pass' : 'fail',
    finding: sensitive.length <= 4 ? undefined : {
      type: 'security',
      module: moduleLabel,
      severity: 'medium',
      title: `App holds ${sensitive.length} sensitive runtime permissions`,
      description: 'A broad set of dangerous permissions is granted, widening the impact of any compromise and reducing user trust.',
      screenName: ctx.primaryScreen,
      activity: '',
      stepsToReproduce: [`Run: adb shell dumpsys package ${ctx.packageName}`, 'Inspect the runtime permission grants'],
      expectedResult: 'Only permissions required by used features are requested.',
      actualResult: `Granted: ${sensitive.join(', ')}`,
      evidence: (dump.match(/android\.permission\.[A-Z_]+:\s*granted=(true|false)/g) ?? []).slice(0, 40).join('\n'),
      rootCause: 'Permissions are declared/requested up-front rather than being tied to the feature that needs them.',
      suggestedFix: 'Request permissions in context at the point of use, remove unused declarations from the manifest, and prefer scoped storage / Photo Picker over broad storage access.',
    },
  });

  // Debuggable builds must never ship.
  const debuggable = /flags=\[[^\]]*DEBUGGABLE/.test(dump);
  outcomes.push({
    testCaseId: nextId('SEC'),
    name: 'Application is not built as debuggable',
    module: moduleLabel,
    screen: ctx.primaryScreen,
    result: debuggable ? 'fail' : 'pass',
    finding: !debuggable ? undefined : {
      type: 'security',
      module: moduleLabel,
      severity: 'critical',
      title: 'Application is flagged DEBUGGABLE',
      description: 'The installed package carries the DEBUGGABLE flag, which allows any user to attach a debugger and read application memory and private data.',
      screenName: ctx.primaryScreen,
      activity: '',
      stepsToReproduce: [`Run: adb shell dumpsys package ${ctx.packageName}`, 'Inspect the application flags'],
      expectedResult: 'Release builds do not set android:debuggable.',
      actualResult: 'The package flags include DEBUGGABLE.',
      evidence: (dump.match(/flags=\[[^\]]*\]/) ?? ['flags not captured'])[0],
      rootCause: 'The APK was built with a debug build type or an explicit android:debuggable="true".',
      suggestedFix: 'Ship a release build; never set android:debuggable in the manifest — let the build type control it.',
    },
  });

  // Cleartext traffic permitted at the manifest level.
  const cleartext = /usesCleartextTraffic=true/.test(dump);
  if (cleartext) {
    findings.push({
      type: 'security',
      module: moduleLabel,
      severity: 'high',
      title: 'App permits cleartext (non-HTTPS) traffic',
      description: 'The package is configured to allow plaintext HTTP, exposing traffic to interception on untrusted networks.',
      screenName: ctx.primaryScreen,
      activity: '',
      stepsToReproduce: [`Run: adb shell dumpsys package ${ctx.packageName}`, 'Check usesCleartextTraffic'],
      expectedResult: 'Cleartext traffic is disabled.',
      actualResult: 'usesCleartextTraffic=true',
      evidence: (dump.match(/.*usesCleartextTraffic.*/) ?? []).join('\n'),
      rootCause: 'android:usesCleartextTraffic="true" or a permissive network-security-config.',
      suggestedFix: 'Set cleartextTrafficPermitted="false" and migrate every endpoint to HTTPS.',
    });
    outcomes.push({ testCaseId: nextId('SEC'), name: 'Cleartext traffic is disabled', module: moduleLabel, screen: ctx.primaryScreen, result: 'fail', finding: findings[findings.length - 1] });
  } else {
    outcomes.push({ testCaseId: nextId('SEC'), name: 'Cleartext traffic is disabled', module: moduleLabel, screen: ctx.primaryScreen, result: 'pass' });
  }

  // Backup allowed means app data can be extracted via adb backup.
  const allowBackup = /ALLOW_BACKUP/.test(dump);
  if (allowBackup) {
    notes.push('Package allows backup (ALLOW_BACKUP) — verify no secrets are included in backups.');
  }

  for (const o of outcomes) if (o.finding && !findings.includes(o.finding)) findings.push(o.finding);
  return { outcomes, findings, notes };
}

/** Executes every selected post-run module. */
export async function runPostModules(plan: ModulePlan, ctx: PostRunContext): Promise<PostRunResult> {
  const outcomes: CheckOutcome[] = [];
  const findings: Finding[] = [];
  const notes: string[] = [];

  if (plan.has('performance')) {
    const label = labelFor('performance');
    await ctx.log('info', 'Performance module: measuring cold start, warm start, frame stats and CPU…');
    const perf = await measurePerformance(ctx.serial, ctx.packageName, label, ctx.primaryScreen);
    findings.push(...perf.findings);
    outcomes.push({
      testCaseId: nextId('PERF'),
      name: `Cold start within budget${perf.coldStartMs != null ? ` (measured ${perf.coldStartMs}ms)` : ''}`,
      module: label,
      screen: ctx.primaryScreen,
      result: perf.findings.some((f) => f.title.startsWith('Cold start')) ? 'fail' : 'pass',
    });
    outcomes.push({
      testCaseId: nextId('PERF'),
      name: `Frame rendering is smooth${perf.frames?.jankyPct != null ? ` (${perf.frames.jankyPct.toFixed(1)}% janky)` : ''}`,
      module: label,
      screen: ctx.primaryScreen,
      result: perf.findings.some((f) => f.title.includes('janky')) ? 'fail' : 'pass',
    });
    notes.push(`Performance: cold ${perf.coldStartMs ?? 'n/a'}ms, warm ${perf.warmStartMs ?? 'n/a'}ms, janky ${perf.frames?.jankyPct?.toFixed(1) ?? 'n/a'}%, CPU ${perf.cpu?.appPct ?? 'n/a'}%.`);
  }

  if (plan.has('memory')) {
    const label = labelFor('memory');
    await ctx.log('info', 'Memory module: sampling meminfo and comparing against the baseline…');
    const final = await sampleMemory(ctx.serial, ctx.packageName);
    const baseline = ctx.memoryBaseline ?? final;
    const mem = analyzeMemory(baseline, final, label, ctx.primaryScreen, ctx.packageName, ctx.screensVisited);
    findings.push(...mem.findings);
    outcomes.push({
      testCaseId: nextId('MEM'),
      name: `Memory stays stable during navigation${mem.growthKb != null ? ` (Δ ${(mem.growthKb / 1024).toFixed(1)} MB)` : ''}`,
      module: label,
      screen: ctx.primaryScreen,
      result: mem.findings.length === 0 ? 'pass' : 'fail',
    });
    notes.push(`Memory: baseline ${baseline.totalPssKb ?? '?'}KB → final ${final.totalPssKb ?? '?'}KB PSS.`);
  }

  if (plan.has('battery')) {
    const label = labelFor('battery');
    await ctx.log('info', 'Battery module: reading battery stats, wake locks and services…');
    const start = ctx.batteryStart ?? (await sampleBattery(ctx.serial));
    const bat = await analyzeBattery(ctx.serial, ctx.packageName, label, ctx.primaryScreen, start, ctx.runDurationMs);
    findings.push(...bat.findings);
    outcomes.push({
      testCaseId: nextId('BAT'),
      name: 'No excessive wake locks or background drain',
      module: label,
      screen: ctx.primaryScreen,
      result: bat.findings.length === 0 ? 'pass' : 'fail',
    });
    notes.push(`Battery: ${start.levelPct ?? '?'}% → ${bat.end.levelPct ?? '?'}%${bat.end.temperatureC != null ? `, ${bat.end.temperatureC.toFixed(1)}°C` : ''}.`);
  }

  if (plan.has('network') || plan.has('api')) {
    const label = labelFor(plan.has('network') ? 'network' : 'api');
    await ctx.log('info', 'Network module: analyzing HTTP/SSL signals and offline behaviour…');
    const net = await analyzeNetwork(ctx.serial, ctx.packageName, ctx.profile, label, ctx.primaryScreen, {
      testOffline: plan.has('network'),
    });
    findings.push(...net.findings);
    notes.push(...net.notes);
    outcomes.push({
      testCaseId: nextId('NET'),
      name: 'API calls complete without error responses',
      module: label,
      screen: ctx.primaryScreen,
      result: net.signals.httpErrors.length === 0 ? 'pass' : 'fail',
    });
    if (net.offlineTested) {
      outcomes.push({
        testCaseId: nextId('NET'),
        name: 'App communicates loss of connectivity',
        module: label,
        screen: ctx.primaryScreen,
        result: net.offlineHandledGracefully ? 'pass' : 'fail',
      });
    }
  }

  if (plan.has('security')) {
    const label = labelFor('security');
    await ctx.log('info', 'Security module: inspecting package flags and permission grants…');
    const sec = await securityChecks(ctx, label);
    outcomes.push(...sec.outcomes);
    for (const f of sec.findings) if (!findings.includes(f)) findings.push(f);
    notes.push(...sec.notes);
  }

  return { outcomes, findings, notes };
}

// -------------------------------------------------------------- dedicated

export interface MonkeyResult {
  events: number;
  outcomes: CheckOutcome[];
  findings: Finding[];
}

/**
 * Monkey testing — pseudo-random stress. Crashes surfaced here are filed by
 * the shared crash monitor, so nothing is invented; this executor only drives
 * the input and reports whether the app survived.
 */
export async function runMonkeyModule(
  serial: string,
  pkg: string,
  events: number,
  crashes: CrashMonitor,
  primaryScreen: string,
  log: (level: 'debug' | 'info' | 'warn' | 'error', message: string) => Promise<void>,
): Promise<MonkeyResult> {
  const label = labelFor('monkey');
  await log('info', `Monkey module: injecting ${events} pseudo-random events…`);

  const out = await shell(
    serial,
    `monkey -p ${pkg} --throttle 120 --pct-syskeys 0 --ignore-timeouts --ignore-security-exceptions -v ${events}`,
    Math.max(60_000, events * 250),
  );

  const crashedDuring = /CRASH|ANR|Monkey aborted/i.test(out);
  const survived = await isAppForeground(serial, pkg);

  const findings: Finding[] = [];
  if (crashedDuring) {
    // The monkey log itself is real evidence; the crash monitor supplies traces.
    findings.push({
      type: 'crash',
      module: label,
      severity: 'high',
      title: 'App crashed or aborted during monkey stress testing',
      description: `The Android monkey tool reported a failure while injecting ${events} random events.`,
      screenName: primaryScreen,
      activity: '',
      stepsToReproduce: [
        `Run: adb shell monkey -p ${pkg} --throttle 120 -v ${events}`,
        'Observe the monkey output for CRASH/ANR',
      ],
      expectedResult: 'The app tolerates random input without crashing.',
      actualResult: 'Monkey reported a crash/ANR or aborted early.',
      evidence: out.split('\n').filter((l) => /CRASH|ANR|Exception|aborted|Events injected/i.test(l)).slice(0, 30).join('\n').slice(0, 3000),
      rootCause: 'Unvalidated input paths or unexpected state transitions reached under random interaction.',
      suggestedFix: 'Reproduce with the seed from the monkey log, then add defensive handling for the failing transition.',
    });
  }

  return {
    events,
    findings,
    outcomes: [{
      testCaseId: nextId('MONKEY'),
      name: `App survives ${events} random events`,
      module: label,
      screen: primaryScreen,
      result: !crashedDuring && survived ? 'pass' : 'fail',
      finding: findings[0],
    }],
  };
}

/** Compatibility: rotate the device and verify the layout survives. */
export async function runCompatibilityModule(
  serial: string,
  pkg: string,
  profile: DeviceProfile,
  primaryScreen: string,
  log: (level: 'debug' | 'info' | 'warn' | 'error', message: string) => Promise<void>,
): Promise<{ outcomes: CheckOutcome[]; findings: Finding[] }> {
  const label = labelFor('compatibility');
  await log('info', 'Compatibility module: rotating the device to verify the landscape layout…');

  const portrait = await observeScreen(serial, pkg, profile);
  await setRotation(serial, true);
  await waitForStableUi(serial, { timeoutMs: 6_000 });

  // The viewport swaps in landscape; observe with swapped dimensions.
  const landscapeProfile: DeviceProfile = { ...profile, width: profile.height, height: profile.width };
  const landscape = await observeScreen(serial, pkg, landscapeProfile);

  const stillForeground = await isAppForeground(serial, pkg);

  await setRotation(serial, false);
  await waitForStableUi(serial, { timeoutMs: 6_000 });

  const findings: Finding[] = [];
  const outcomes: CheckOutcome[] = [];

  if (!stillForeground) {
    findings.push({
      type: 'compatibility',
      module: label,
      severity: 'critical',
      title: 'App left the foreground when rotated to landscape',
      description: 'Rotating the device caused the app to stop being the foreground application, which indicates a crash or an unhandled configuration change.',
      screenName: primaryScreen,
      activity: portrait?.activity ?? '',
      stepsToReproduce: [
        'Open the app',
        'Run: adb shell settings put system user_rotation 1',
        'Observe whether the app remains in the foreground',
      ],
      expectedResult: 'The app handles the configuration change and stays in the foreground.',
      actualResult: 'The app was no longer the foreground package after rotation.',
      evidence: `portrait activity=${portrait?.activity ?? 'n/a'}; after rotation foreground=false`,
      rootCause: 'The activity does not survive the configuration change — often an exception in onCreate when re-created, or state restored from a null bundle.',
      suggestedFix: 'Handle configuration changes properly: restore state via onSaveInstanceState/ViewModel and fix any exception thrown during re-creation.',
    });
    outcomes.push({ testCaseId: nextId('COMPAT'), name: 'App survives rotation', module: label, screen: primaryScreen, result: 'fail', finding: findings[0] });
  } else {
    outcomes.push({ testCaseId: nextId('COMPAT'), name: 'App survives rotation', module: label, screen: primaryScreen, result: 'pass' });

    if (portrait && landscape) {
      const rot = auditRotation(portrait, landscape, label);
      findings.push(...rot);
      outcomes.push({
        testCaseId: nextId('COMPAT'),
        name: 'Landscape layout retains all controls',
        module: label,
        screen: primaryScreen,
        result: rot.length === 0 ? 'pass' : 'fail',
        finding: rot[0],
      });
    }
  }

  return { outcomes, findings };
}

/**
 * AI exploratory analysis.
 *
 * The model is given ONLY real, observed data (the discovered screen graph and
 * the real blockers) and asked which areas look under-explored and what a
 * tester should try next. It is deliberately NOT allowed to author bugs —
 * every defect in this engine must come from a deterministic check or a real
 * crash — so its output is recorded as guidance in the run log.
 */
export async function runAiExploratory(
  graph: ScreenGraph,
  apiKey: string | null,
  log: (level: 'debug' | 'info' | 'warn' | 'error', message: string) => Promise<void>,
): Promise<string[]> {
  const label = labelFor('ai_exploratory');
  const summary = graph.summary();

  try {
    const { generateQaAnalysis, parseJsonLoose } = await import('@/lib/qa/ai-provider');
    const content = await generateQaAnalysis(apiKey, {
      systemPrompt:
        'You are a senior mobile QA analyst reviewing the output of an automated exploration run. '
        + 'You will be given the REAL screen graph that was discovered on a device. '
        + 'Identify which areas appear under-explored and what a human tester should try next. '
        + 'Do NOT invent defects, and do not claim anything happened that is not in the data. '
        + 'Respond ONLY with minified JSON: {"underExplored":[string],"suggestedFlows":[string],"observations":[string]}',
      userPrompt: `Observed exploration data:\n${summary}`,
      maxTokens: 700,
    });
    const parsed = parseJsonLoose(content) as {
      underExplored?: string[]; suggestedFlows?: string[]; observations?: string[];
    } | null;
    if (!parsed) {
      await log('warn', `${label}: the model returned no usable analysis.`);
      return [];
    }

    const lines: string[] = [];
    for (const u of (parsed.underExplored ?? []).slice(0, 6)) lines.push(`Under-explored: ${u}`);
    for (const s of (parsed.suggestedFlows ?? []).slice(0, 6)) lines.push(`Suggested flow: ${s}`);
    for (const o of (parsed.observations ?? []).slice(0, 6)) lines.push(`Observation: ${o}`);

    for (const l of lines) await log('info', `${label}: ${l}`);
    return lines;
  } catch (e) {
    await log('warn', `${label}: analysis unavailable (${(e as Error)?.message?.slice(0, 120)}).`);
    return [];
  }
}
