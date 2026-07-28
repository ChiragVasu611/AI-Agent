# QA Command Center — Test Execution Module

The Test Execution module runs quality-assurance tests against **web apps**, **real
Android devices**, and (as an honest fallback) a **simulated engine**. It uploads or
points at an app under test, executes the QA modules the user selects, and streams
live results — screenshots, logs, test-case outcomes, and evidence-backed bugs — into
the run report.

> **Guiding principle:** nothing is faked as real. Real targets get real execution
> (Playwright for web, ADB for Android). Where real execution is impossible, the run is
> explicitly labelled **Simulated**. Screenshots and bugs are only stored when backed
> by actual observation.

---

## Table of contents

1. [High-level flow](#high-level-flow)
2. [Entry points & routing](#entry-points--routing)
3. [The three engines](#the-three-engines)
4. [Autonomous Android engine (deep dive)](#autonomous-android-engine-deep-dive)
5. [Testing modules](#testing-modules)
6. [Device management](#device-management)
7. [Data storage](#data-storage)
8. [Run lifecycle & UI](#run-lifecycle--ui)
9. [File map](#file-map)
10. [How to run](#how-to-run)
11. [Known limitations](#known-limitations)
12. [Change log (work done)](#change-log-work-done)

---

## High-level flow

```
User submits app (upload APK / AAB / IPA, or a URL / store link)
      │
      ▼
POST /api/qa/runs/start-binary   (binary uploads)      ─┐
startTestExecution() server action (URLs/file names)   ─┤► create QaProject
                                                         │  create QaTestRun (queued)
                                                         │  fire background engine
                                                         ▼  return runId
Frontend polls /api/qa/runs/* every 1.5s ──► live status, screenshots, logs, bugs
```

The submit handler picks an **engine** based on the target, then returns `runId`
immediately. The engine runs in the background (fire-and-forget) and continuously
updates the `QaTestRun` document; the UI reflects that via polling.

---

## Entry points & routing

| Target | Submit path | Engine chosen |
|---|---|---|
| **Web URL** (`http(s)://…`) | `startTestExecution` server action (`app/qa/actions.ts`) | `runWebTestExecution` — **real** (Playwright) |
| **Android APK + connected device** | `POST /api/qa/runs/start-binary` | `runAndroidDeviceExecution` — **real** (ADB) |
| **APK without device / AAB / IPA / store URLs / mobile file names** | either path | `runQaTestExecution` — **simulated** (AI) |
| **Uploaded test-case sheet** (`.xlsx`/`.csv`) | `mode=uploaded` | `runUploadedTestExecution` |

Binary uploads use a **Route Handler** rather than a Server Action because this
Next.js version (13.5.1) hard-caps Server Action bodies at 1 MB — far too small for a
real app binary. Route Handlers have no such limit.

**Engine selection for APKs** (`start-binary/route.ts`): if the source is a real
`.apk`, its binary was persisted, and an online device is available (or one was
picked in the UI), the run goes to the **real-device engine**; otherwise it falls back
to **simulated**. An `.aab` always falls back (it needs `bundletool` to install).

---

## The three engines

### 1. Web engine — `web-engine.ts` (real)

Launches **headless Chromium via Playwright**, navigates to the URL, and observes the
real page load: HTTP status & headers, `<title>`, `<html lang>`, console/page errors,
failed requests, XHR/fetch calls with status codes, and DOM facts (images without
`alt`, inputs without labels, horizontal overflow, load time).

`runChecksForModules` converts those observations into deterministic pass/fail checks,
gated by the selected modules — e.g. **Functional** (2xx status, non-empty title),
**API** (all XHR/fetch succeed), **UI/UX** (no overflow, alt text), **Accessibility**
(labels, `lang`), **Security** (HTTPS, no mixed content, HSTS), **Performance** (load
budget). Screenshots are real Playwright captures.

### 2. Real Android device engine — `android-engine/` (real)

Installs the APK on a connected device, autonomously explores the whole reachable app,
captures real screenshots, and reports real crashes and evidence-backed defects. See
the [deep dive](#autonomous-android-engine-deep-dive) below.

### 3. Simulated engine — `engine.ts` (fallback, labelled)

Used when the target cannot truly be run (mobile binary with no device, store links).
For each selected module it calls an **AI model via OpenRouter** (`ai-provider.ts`) to
simulate realistic test cases and 0–2 bugs, and generates **SVG placeholder
screenshots** (`screenshot.ts`). Everything here is clearly labelled **"Simulated"** in
the run report. Falls back to canned templates (`bug-bank.ts`) if the AI call fails.

---

## Autonomous Android engine (deep dive)

Location: `lib/qa/android-engine/`. Public contract (unchanged):
`runAndroidDeviceExecution(runId, serial)`.

The engine behaves like an experienced manual QA engineer: **observe → think →
interact → verify → repeat**, until every selected module completes or the entire
reachable app has been explored. It adapts to **any** Android app with **no hardcoded
coordinates, button names, screen names, flows, or fixed delays** — every decision is
driven by the live UI hierarchy.

### Pipeline (`index.ts`)

```
profile device ─► install APK ─► baseline (battery, memory, logcat cleared)
      ─► launch (am start -W) ─► AUTONOMOUS EXPLORATION
             (per-screen modules run as screens are discovered;
              crashes filed live from logcat)
      ─► post-run modules (performance / memory / battery / network / security)
      ─► dedicated modules (monkey / compatibility-rotation / AI exploratory)
      ─► persist test-case results + bugs ─► verdict ─► force-stop (cleanup)
```

Bounded by a wall-clock ceiling (`MAX_RUN_MS`, 12 min) and a step cap
(`MAX_EXPLORE_STEPS`, 220) so a run can never hang the worker.

### The exploration loop (`explorer.ts`)

Each iteration:

1. **Observe** — dump the UI hierarchy, resolve the focused activity, classify the screen.
2. **Handle blockers** (in priority order) so exploration never dead-ends:
   - **Permission dialogs** → grant (keeps gated features reachable).
   - **Ads** → detect, wait adaptively for the dismiss control, close.
   - **Paywalls** → try to escape without purchasing; else record a coverage limit.
   - **Login walls** → use configured QA credentials, else a guest/skip path.
   - **Left the app** → Back, or relaunch.
3. **Register** the screen in the graph; run per-screen modules; poll logcat for crashes.
4. **Decide** — pick the highest-value untried interaction; if the screen is exhausted, backtrack toward the frontier.
5. **Act** — execute the gesture, then wait for the UI to settle and record the transition.

### Key subsystems

| Subsystem | File | What it does |
|---|---|---|
| Device I/O | `device.ts` | Typed wrappers over every ADB command (dump, screencap, input, dumpsys, logcat, lifecycle) |
| UI parser | `ui-parser.ts` | Dependency-free `uiautomator dump` XML → node tree (bounds, ids, classes, flags) |
| Smart wait | `smart-wait.ts` | Polls until hierarchy + activity stabilize and loading indicators vanish — **no fixed sleeps** |
| Screen graph | `graph.ts` | Nodes = screen signatures, edges = interactions; drives loop-free termination & frontier |
| Classifier | `screen-classifier.ts` | Generic screen kinds from structure only (splash/login/paywall/webview/dialog/…) |
| Ad detector | `ad-detector.ts` | 20+ ad-SDK signatures (AdMob, Meta, AppLovin, Unity, ironSource, Vungle, Pangle, …) + overlay geometry; adaptive countdown handling |
| Paywall detector | `paywall-detector.ts` | Play Billing surfaces + price/purchase vocabulary; escapes without buying |
| Permission handler | `permission-handler.ts` | PermissionController ids/labels across Android 6→15 |
| Login handler | `login-handler.ts` | Field roles by `password`/hint semantics; guest fallback; never fabricates accounts |
| Interaction engine | `interaction-engine.ts` | tap / long-press / double-tap / scroll / swipe / type / toggle / drawer / rotate; targets & coords from element bounds; destructive & purchase controls deprioritised |
| Crash monitor | `crash-monitor.ts` | Incremental logcat scan → FATAL / ANR / native signals with stack traces, deduped |
| Screenshots | `screenshots.ts` | Real `screencap` PNGs only — **no placeholder path exists** |
| Bug generator | `bug-generator.ts` | Findings → `QaBug` with full evidence + device context; dedupes by signature |
| Module runner | `module-runner.ts` | Dispatches only selected modules; per-screen / post-run / dedicated phases |
| Report | `report.ts` | Persists `QaTestCaseResult` rows, links bugs, computes verdict & score |

### No-fabrication guarantees

- **Screenshots**: every image is a real device frame; if `screencap` returns nothing the capture is skipped, never substituted.
- **Bugs**: only filed from deterministic checks or real crashes, each carrying its evidence (logcat excerpt, dumpsys slice, measured numbers, or element bounds).
- **AI**: the AI-exploratory module may suggest where to look next, but is **forbidden from authoring bugs**.
- **Coverage limits** (undismissable ad, mandatory paywall/login) are recorded honestly in the run log rather than hidden.

---

## Testing modules

Defined in `modules.ts` (19 modules). Each declares which bug types it can surface. The
user's selection controls which real checks run (web/device) or which bug categories
the AI is told to look for (simulated). **Unselected modules never run.**

`functional`, `ui_ux`, `api`, `regression`, `compatibility`, `accessibility`,
`security`, `performance`, `memory`, `battery`, `crash_detection`, `anr_detection`,
`monkey`, `localization`, `network`, `smoke`, `sanity`, `e2e`, `ai_exploratory`.

Real-device module phases:

- **Per-screen** (run on each discovered screen): functional, UI/UX, accessibility, smoke/sanity, localization.
- **Post-run** (once, after exploration): performance (`am start -W`, `gfxinfo` jank), memory (`meminfo` PSS/RSS + leak comparison), battery (`batterystats`, wake locks, services), network (logcat HTTP/SSL + real offline toggle), security (package flags, permission grants).
- **Dedicated** (own device phase): monkey stress, compatibility (rotation), AI exploratory.

---

## Device management

- **Adapter**: `device-adapter.ts` — `AdbDeviceAdapter` lists real devices via the ADB CLI (`adb.ts`). `isConfigured()` reports whether `adb` is available.
- **API**: `GET /api/qa/devices` lists connected devices (model, Android version, battery, status). `POST` supports wireless **connect** (`adb connect ip:port`), **pair** (Android 11+ `adb pair ip:port code`), and **disconnect**.
- **UI**: `app/qa/devices/page.tsx` shows live devices (auto-refresh every 5s), plus wireless connect/pair forms.
- **ADB path**: taken from `ADB_PATH` env var, falling back to `adb` on `PATH`.

---

## Data storage

All QA data is stored in **MongoDB via Mongoose** (`lib/mongodb/`). There is no SQL/ORM
and no on-disk blob store except the uploaded binary (see below).

| Model | Collection | Holds |
|---|---|---|
| `QaProject` | QaProject | App under test: source type/ref, platform, extracted metadata (`appPackageName`, `appDisplayName`, version, `appIconDataUrl`), `binaryPath` (persisted APK/IPA path) |
| `QaTestRun` | QaTestRun | Run status, progress, `sourceMode` (catalog/uploaded), `engineMode` (`real_browser` / `real_device` / `simulated`), live `current*` fields, counts, `performanceScore` |
| `QaBug` | QaBug | Evidence-backed bugs (type, severity, priority, screen, steps, expected/actual, screenshot, stack trace, device info, root cause, fix) |
| `QaScreenshot` | QaScreenshot | Real screenshots as `data:` URLs (`imageDataUrl`) |
| `QaLogEntry` | QaLogEntry | Live console/logcat/automation log lines |
| `QaTestCaseResult` | QaTestCaseResult | Per-check pass/fail rows, linked to bugs |
| `QaUploadedTestCase` | QaUploadedTestCase | Rows parsed from an uploaded test-case sheet |

**Uploaded binaries**: APK/IPA files are persisted to a temp uploads dir
(`QA_UPLOAD_DIR` in `app-upload.ts`) so a background real-device run can install them;
the path is stored on `QaProject.binaryPath`. Metadata (package, name, version, icon)
is extracted from the binary via `app-info-parser` (`app-file-parser.ts`).

---

## Run lifecycle & UI

- **Test Execution page** (`app/qa/test-execution/page.tsx`): submit an app + modules; for APKs, a **Run on device** selector (auto / a specific device / simulated).
- **AI Test Case Execution page** (`app/qa/test-case-execution/page.tsx`): APK/URL + a `.xlsx/.csv` test-case sheet (`mode=uploaded`).
- **Run report** (`app/qa/runs/[id]/page.tsx`): execution summary, live device/browser preview, App Info card, and tabs for Test Case Results, AI Bug Report, Screenshots, Execution Timeline, Performance Metrics, and Live Logs. Real runs are badged **Real Browser Execution** / **Real Device Execution**; simulated runs are badged **Simulated**. Includes a per-run **Delete** action.
- **Test Runs list** (`app/qa/runs/page.tsx`): full history with filters, export (CSV/Excel/PDF), re-run, and delete.

---

## File map

```
lib/qa/
├── ai-provider.ts          # OpenRouter client (simulated engine + AI module)
├── app-file-parser.ts      # APK/IPA metadata extraction (app-info-parser)
├── app-upload.ts           # binary validation + persistence (150→500MB cap, QA_UPLOAD_DIR)
├── adb.ts                  # ADB CLI wrapper (list/connect/pair/install/launch/screencap/logcat)
├── device-adapter.ts       # AdbDeviceAdapter (real device discovery)
├── engine.ts               # simulated engine (AI + placeholder screenshots)
├── web-engine.ts           # real web engine (Playwright)
├── uploadedEngine.ts       # uploaded test-case sheet engine
├── modules.ts              # the 19 QA modules
├── screenshot.ts           # SVG placeholder generator (simulated only)
├── bug-bank.ts             # canned fallback bug templates (simulated only)
├── submit-binary-run.ts    # client helper: robust binary-upload response handling
├── runtime-helpers.ts      # sleep / log helpers
└── android-engine/         # ── autonomous real-device engine ──
    ├── index.ts            #   orchestrator (public: runAndroidDeviceExecution)
    ├── types.ts            #   shared types (UiNode, ScreenState, Interaction, Finding…)
    ├── device.ts           #   ADB device I/O layer
    ├── ui-parser.ts        #   uiautomator dump XML parser
    ├── smart-wait.ts       #   adaptive UI-stability waiting
    ├── graph.ts            #   screen graph
    ├── screen-classifier.ts#   generic screen classification
    ├── ad-detector.ts      #   ad detection + adaptive dismissal
    ├── paywall-detector.ts #   paywall detection + escape (no purchase)
    ├── permission-handler.ts#  runtime permission dialogs
    ├── login-handler.ts    #   login forms + guest fallback
    ├── interaction-engine.ts#  gesture planning + execution
    ├── crash-monitor.ts    #   logcat crash/ANR/native monitoring
    ├── explorer.ts         #   the observe→decide→act loop
    ├── module-runner.ts    #   per-module executors (only selected run)
    ├── performance.ts      #   cold/warm start, jank, CPU
    ├── memory.ts           #   meminfo + leak comparison
    ├── battery.ts          #   battery, wake locks, services
    ├── network.ts          #   HTTP/SSL signals + offline test
    ├── accessibility.ts    #   a11y audit of the live tree
    ├── ui-checks.ts        #   layout/overflow/overlap/rotation
    ├── screenshots.ts      #   real screenshot capture/persistence
    ├── bug-generator.ts    #   findings → QaBug
    └── report.ts           #   persist results + verdict
```

---

## How to run

### Web app
1. Test Execution → source **Web URL** → enter `https://…` → pick modules → start.
2. Playwright loads the page and runs the selected checks; watch the live report.

### Real Android device
1. Connect a device over USB (USB debugging on) **or** pair it wirelessly on the **Devices** page.
2. Confirm it shows **online** on Devices.
3. Test Execution → source **Android APK** → upload the `.apk` → pick your device in **Run on device** → select modules → start.
4. The app installs, launches, and is explored autonomously; the report fills with real screenshots and evidence-backed bugs.

### Requirements
- `adb` on the server's `PATH` (or set `ADB_PATH`). Android platform-tools.
- Playwright Chromium installed (for web runs).
- `MONGODB_URI` and an OpenRouter key (`OPENROUTER_API_KEY`, or per-user in QA Settings) for the simulated/AI paths.
- **Restart `next dev`** after schema/model changes — Mongoose caches compiled schemas and does not hot-reload them.

### Optional: QA credentials for login-gated apps
The real-device engine reads optional credentials from the user record
(`qaTestEmail` / `qaTestPassword` / `qaTestPhone` / `qaTestOtp`). If none are set it
uses a guest/skip path and records login as a coverage limitation.

---

## Known limitations

- **Web engine** inspects the single URL given — it does not yet crawl links or script multi-step web flows.
- **Real-device execution is APK-only** (`.aab` needs `bundletool`; `.ipa`/iOS has no device automation here).
- **Offline network test** is skipped when adb is attached over Wi-Fi (disabling the radio would sever the connection) — reported as a limitation.
- **Simulated engine** produces AI-generated cases and placeholder screenshots by design, always labelled "Simulated".
- Real-device runs are **bounded** (12 min / 220 steps); very large apps may not be fully exhausted within a single run.

---

## Change log (work done)

Chronological summary of the work delivered in this module.

### Fixes to the binary upload path
- **APK size cap** raised from **150 MB → 500 MB** (`app-upload.ts`) — real APKs (e.g. a 218 MB build) were being rejected with a 400.
- **Array-cast crash fixed** (`app-file-parser.ts`): `app-info-parser` returns some fields (e.g. the app label) as arrays; a `toStr()` normalizer coerces every extracted field to a string, fixing a Mongoose `CastError` (500).
- **App icon fixed** (`app-file-parser.ts`): the parser already returns the icon as a full `data:` URI, which was being double-prefixed into an invalid URL; `toIconDataUrl()` now normalizes it and sniffs the real MIME (PNG/JPEG/GIF/WebP/SVG) from the magic bytes so the logo renders.
- **Robust error surfacing** (`submit-binary-run.ts`): both upload pages now read the response as text first and surface the server's real error as a toast (previously a non-JSON 400 was swallowed, leaving only a bare console `400`). The route also handles a failed `formData()` parse and DB errors with clear messages.

### Delete capability
- Added a per-run **Delete** action on the run report page (`app/qa/runs/[id]/page.tsx`), complementing the existing delete on the Test Runs list, dashboard, and Test Execution pages. Cascades bugs, logs, screenshots, and test-case results.

### Real device integration (new)
- `adb.ts` — full ADB CLI wrapper (list/connect/pair/disconnect/install/launch/screencap/logcat/props).
- `device-adapter.ts` — replaced the stub with `AdbDeviceAdapter` (real device discovery).
- `app/api/qa/devices/route.ts` — real device listing + wireless connect/pair/disconnect.
- `app/qa/devices/page.tsx` — live device list with wireless connect & pair forms.
- `QaProject.binaryPath` field + APK persistence (`app-upload.ts`) so background runs can install the binary.
- `QaTestRun.engineMode` gained `real_device`; `start-binary/route.ts` routes APK runs to the real engine when a device is available.
- Run report labels **Real Device Execution** and treats it as a real (not simulated) engine.

### Autonomous Android engine (new)
- Replaced the initial "install + a few screenshots + monkey" engine with the modular **`android-engine/`** system described above: graph-based autonomous exploration; ad/paywall/permission/login handling; smart waits; per-module executors; real crash/perf/memory/battery/network/accessibility analysis; real screenshots; evidence-backed bug reporting. No hardcoded coordinates, names, flows, or fixed delays.
