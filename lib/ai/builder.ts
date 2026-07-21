import { execFile } from 'child_process';
import { promisify } from 'util';
import { existsSync } from 'fs';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';

const execFileP = promisify(execFile);

const FLUTTER_BIN = process.env.FLUTTER_BIN ?? '/Users/deo/flutter/bin/flutter';
const FLUTTER_DIR = path.dirname(FLUTTER_BIN);

export const WORKSPACE_ROOT = path.join(os.tmpdir(), 'ai-factory-workspace');

/** Structured app description the coder agent produces; the builder turns it
 *  into a real, guaranteed-compilable multi-screen Flutter project. */
export interface AppItemSpec {
  title: string;
  subtitle: string;
  detail: string;
}
export interface AppScreenSpec {
  title: string;
  icon: string;
  description: string;
  items: AppItemSpec[];
}
export interface AppSpec {
  appName: string;
  tagline: string;
  primaryColor: string; // #RRGGBB
  screens: AppScreenSpec[];
}

// Whitelist of Material icons the generated app may use.
const ICONS: Record<string, string> = {
  home: 'Icons.home',
  search: 'Icons.search',
  favorite: 'Icons.favorite',
  person: 'Icons.person',
  settings: 'Icons.settings',
  list: 'Icons.list',
  explore: 'Icons.explore',
  cart: 'Icons.shopping_cart',
  shopping_cart: 'Icons.shopping_cart',
  notifications: 'Icons.notifications',
  dashboard: 'Icons.dashboard',
  map: 'Icons.map',
  chat: 'Icons.chat_bubble',
  calendar: 'Icons.calendar_today',
  star: 'Icons.star',
  play: 'Icons.play_circle',
  book: 'Icons.book',
  camera: 'Icons.camera_alt',
  music: 'Icons.music_note',
  feed: 'Icons.dynamic_feed',
};

function pickIcon(name: unknown): string {
  const key = String(name ?? '').toLowerCase().trim();
  return ICONS[key] ?? 'Icons.circle';
}

function str(v: unknown, fallback = ''): string {
  const s = typeof v === 'string' ? v : v == null ? '' : String(v);
  return s.trim() || fallback;
}

/** Escape an arbitrary string into a safe Dart single-quoted string literal. */
function dart(s: string): string {
  const escaped = s
    .replace(/\\/g, '\\\\')
    .replace(/\$/g, '\\$')
    .replace(/'/g, "\\'")
    .replace(/\r/g, '')
    .replace(/\n/g, '\\n');
  return `'${escaped}'`;
}

function hexToArgb(hex: string): string {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim());
  const rgb = m ? m[1] : '2563EB';
  return `0xFF${rgb.toUpperCase()}`;
}

/** Coerce whatever the LLM returned into a valid, renderable AppSpec. */
export function normalizeSpec(raw: unknown, fallbackName: string): AppSpec {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const appName = str(o.appName ?? o.name, fallbackName || 'My App').slice(0, 40);
  const tagline = str(o.tagline ?? o.description, 'Built by the AI App Factory').slice(0, 120);
  const primaryColor = str(o.primaryColor ?? o.color, '#2563EB');

  let screensRaw = Array.isArray(o.screens) ? o.screens : [];
  let screens: AppScreenSpec[] = screensRaw.map((s) => {
    const so = (s && typeof s === 'object' ? s : {}) as Record<string, unknown>;
    const itemsRaw = Array.isArray(so.items) ? so.items : [];
    const items: AppItemSpec[] = itemsRaw.slice(0, 12).map((it) => {
      const io = (it && typeof it === 'object' ? it : {}) as Record<string, unknown>;
      return {
        title: str(io.title ?? io.name, 'Item').slice(0, 80),
        subtitle: str(io.subtitle ?? io.summary, '').slice(0, 120),
        detail: str(io.detail ?? io.description ?? io.body, '').slice(0, 600),
      };
    });
    return {
      title: str(so.title ?? so.name, 'Screen').slice(0, 24),
      icon: pickIcon(so.icon),
      description: str(so.description ?? so.subtitle, '').slice(0, 200),
      items,
    };
  });

  // Guarantee a full multi-screen app.
  const defaults: AppScreenSpec[] = [
    { title: 'Home', icon: 'Icons.home', description: 'Welcome', items: [] },
    { title: 'Explore', icon: 'Icons.explore', description: 'Discover more', items: [] },
    { title: 'Favorites', icon: 'Icons.favorite', description: 'Your saved items', items: [] },
    { title: 'Profile', icon: 'Icons.person', description: 'Your account', items: [] },
  ];
  screens = screens.filter((s) => s.title);
  let i = 0;
  while (screens.length < 3) screens.push(defaults[i++ % defaults.length]);
  screens = screens.slice(0, 5);

  // Ensure every screen has some content so no screen looks empty.
  screens = screens.map((s, idx) => {
    if (s.items.length > 0) return s;
    const items: AppItemSpec[] = Array.from({ length: 4 }).map((_, k) => ({
      title: `${s.title} item ${k + 1}`,
      subtitle: appName,
      detail: `${s.description || s.title} — sample content ${k + 1} for ${appName}.`,
    }));
    return { ...s, items };
  });

  return { appName, tagline, primaryColor, screens };
}

/** Produce the multi-file Flutter project sources from the spec. */
export function generateDartFiles(spec: AppSpec): { path: string; content: string }[] {
  const argb = hexToArgb(spec.primaryColor);

  const screensDart = spec.screens
    .map((s) => {
      const items = s.items
        .map(
          (it) =>
            `      AppItem(title: ${dart(it.title)}, subtitle: ${dart(it.subtitle)}, detail: ${dart(it.detail)}),`,
        )
        .join('\n');
      return [
        '  AppScreen(',
        `    title: ${dart(s.title)},`,
        `    icon: ${pickIcon(s.icon.replace('Icons.', ''))},`,
        `    description: ${dart(s.description)},`,
        '    items: [',
        items,
        '    ],',
        '  ),',
      ].join('\n');
    })
    .join('\n');

  const models = `import 'package:flutter/material.dart';

class AppItem {
  final String title;
  final String subtitle;
  final String detail;
  const AppItem({required this.title, required this.subtitle, required this.detail});
}

class AppScreen {
  final String title;
  final IconData icon;
  final String description;
  final List<AppItem> items;
  const AppScreen({
    required this.title,
    required this.icon,
    required this.description,
    required this.items,
  });
}
`;

  const data = `import 'package:flutter/material.dart';
import 'models.dart';

// GENERATED by the AI App Factory — do not edit by hand.
const String kAppName = ${dart(spec.appName)};
const String kTagline = ${dart(spec.tagline)};
const int kPrimaryColor = ${argb};

final List<AppScreen> kScreens = [
${screensDart}
];
`;

  const theme = `import 'package:flutter/material.dart';

ThemeData buildAppTheme(int seed) {
  final scheme = ColorScheme.fromSeed(seedColor: Color(seed));
  return ThemeData(
    useMaterial3: true,
    colorScheme: scheme,
    appBarTheme: AppBarTheme(
      backgroundColor: scheme.primary,
      foregroundColor: scheme.onPrimary,
      elevation: 0,
    ),
    cardTheme: CardTheme(
      elevation: 0,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      margin: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
    ),
  );
}
`;

  const main = `import 'package:flutter/material.dart';
import 'theme.dart';
import 'data.dart';
import 'screens/root_nav.dart';

void main() => runApp(const MyApp());

class MyApp extends StatelessWidget {
  const MyApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: kAppName,
      debugShowCheckedModeBanner: false,
      theme: buildAppTheme(kPrimaryColor),
      home: const RootNav(),
    );
  }
}
`;

  const rootNav = `import 'package:flutter/material.dart';
import '../data.dart';
import 'list_screen.dart';

class RootNav extends StatefulWidget {
  const RootNav({super.key});

  @override
  State<RootNav> createState() => _RootNavState();
}

class _RootNavState extends State<RootNav> {
  int _index = 0;

  @override
  Widget build(BuildContext context) {
    final screen = kScreens[_index];
    return Scaffold(
      appBar: AppBar(
        title: Text(_index == 0 ? kAppName : screen.title),
        centerTitle: false,
      ),
      body: ListScreen(screen: screen),
      bottomNavigationBar: NavigationBar(
        selectedIndex: _index,
        onDestinationSelected: (i) => setState(() => _index = i),
        destinations: [
          for (final s in kScreens)
            NavigationDestination(icon: Icon(s.icon), label: s.title),
        ],
      ),
    );
  }
}
`;

  const listScreen = `import 'package:flutter/material.dart';
import '../models.dart';
import 'detail_screen.dart';

class ListScreen extends StatelessWidget {
  final AppScreen screen;
  const ListScreen({super.key, required this.screen});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return ListView(
      padding: const EdgeInsets.only(top: 16, bottom: 24),
      children: [
        if (screen.description.isNotEmpty)
          Padding(
            padding: const EdgeInsets.fromLTRB(20, 4, 20, 12),
            child: Text(
              screen.description,
              style: theme.textTheme.titleMedium?.copyWith(
                color: theme.colorScheme.onSurfaceVariant,
              ),
            ),
          ),
        for (final item in screen.items)
          Card(
            child: ListTile(
              contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
              leading: CircleAvatar(
                backgroundColor: theme.colorScheme.primaryContainer,
                child: Icon(screen.icon, color: theme.colorScheme.onPrimaryContainer),
              ),
              title: Text(item.title,
                  style: const TextStyle(fontWeight: FontWeight.w600)),
              subtitle: item.subtitle.isEmpty ? null : Text(item.subtitle),
              trailing: const Icon(Icons.chevron_right),
              onTap: () => Navigator.of(context).push(
                MaterialPageRoute(builder: (_) => DetailScreen(item: item)),
              ),
            ),
          ),
      ],
    );
  }
}
`;

  const detailScreen = `import 'package:flutter/material.dart';
import '../models.dart';

class DetailScreen extends StatelessWidget {
  final AppItem item;
  const DetailScreen({super.key, required this.item});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Scaffold(
      appBar: AppBar(title: Text(item.title)),
      body: ListView(
        padding: const EdgeInsets.all(20),
        children: [
          if (item.subtitle.isNotEmpty)
            Text(item.subtitle,
                style: theme.textTheme.titleLarge
                    ?.copyWith(fontWeight: FontWeight.bold)),
          const SizedBox(height: 12),
          Text(
            item.detail.isEmpty ? 'No further details available.' : item.detail,
            style: theme.textTheme.bodyLarge?.copyWith(height: 1.5),
          ),
        ],
      ),
    );
  }
}
`;

  return [
    { path: 'lib/main.dart', content: main },
    { path: 'lib/theme.dart', content: theme },
    { path: 'lib/models.dart', content: models },
    { path: 'lib/data.dart', content: data },
    { path: 'lib/screens/root_nav.dart', content: rootNav },
    { path: 'lib/screens/list_screen.dart', content: listScreen },
    { path: 'lib/screens/detail_screen.dart', content: detailScreen },
  ];
}

function flutterEnv(): NodeJS.ProcessEnv {
  return { ...process.env, PATH: `${FLUTTER_DIR}:${process.env.PATH ?? ''}` };
}

async function run(args: string[], cwd: string, timeoutMs = 8 * 60 * 1000) {
  try {
    const { stdout, stderr } = await execFileP(FLUTTER_BIN, args, {
      cwd,
      env: flutterEnv(),
      timeout: timeoutMs,
      maxBuffer: 32 * 1024 * 1024,
    });
    return { ok: true, log: `${stdout}\n${stderr}`.trim() };
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string; message?: string };
    return { ok: false, log: `${err.stdout ?? ''}\n${err.stderr ?? ''}\n${err.message ?? ''}`.trim() };
  }
}

function safePackageName(name: string): string {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return /^[a-z]/.test(base) ? base.slice(0, 40) : `app_${base}`.slice(0, 40);
}

export interface GeneratedFile {
  path: string;
  content: string;
}

/** Parse the coder/fixer delimiter protocol into files. Tolerant of stray
 *  prose and markdown fences around the blocks. */
export function parseFileBlocks(text: string): GeneratedFile[] {
  const cleaned = text.replace(/```[a-zA-Z]*\n?/g, '');
  const re = /=== FILE:\s*(.+?)\s*===\s*\n([\s\S]*?)\n?=== END ===/g;
  const files: GeneratedFile[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(cleaned)) !== null) {
    const p = m[1].trim();
    const content = m[2];
    if (p) files.push({ path: p, content });
  }
  return files;
}

/** Write model-authored files into the project, restricted to lib/. Returns
 *  whether a usable fileset (with an entrypoint) was written. */
async function writeModelFiles(dir: string, files: GeneratedFile[]): Promise<boolean> {
  const libRoot = path.join(dir, 'lib');
  await fs.rm(libRoot, { recursive: true, force: true });
  await fs.mkdir(libRoot, { recursive: true });

  let wrote = 0;
  let hasMain = false;
  for (const f of files) {
    const rel = f.path.replace(/^\.?\/+/, '');
    if (!rel.startsWith('lib/') || rel.includes('..')) continue; // lib/ only, no traversal
    const dest = path.resolve(dir, rel);
    if (!dest.startsWith(libRoot + path.sep)) continue;
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.writeFile(dest, f.content, 'utf8');
    wrote++;
    if (rel === 'lib/main.dart') hasMain = true;
  }
  return wrote > 0 && hasMain;
}

async function writeTemplate(dir: string, spec: AppSpec) {
  await fs.rm(path.join(dir, 'lib'), { recursive: true, force: true });
  for (const f of generateDartFiles(spec)) {
    const dest = path.join(dir, f.path);
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.writeFile(dest, f.content, 'utf8');
  }
}

async function readLibFiles(dir: string): Promise<GeneratedFile[]> {
  const libRoot = path.join(dir, 'lib');
  const out: GeneratedFile[] = [];
  async function walk(d: string) {
    for (const entry of await fs.readdir(d, { withFileTypes: true })) {
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.name.endsWith('.dart')) {
        out.push({ path: path.relative(dir, full), content: await fs.readFile(full, 'utf8') });
      }
    }
  }
  if (existsSync(libRoot)) await walk(libRoot);
  return out;
}

export type BuildMode = 'model-authored' | 'template-fallback';

export interface BuildResult {
  dir: string;
  mode: BuildMode;
  fixRounds: number;
  webReady: boolean;
  apkPath: string | null;
  sourcePath: string | null;
  log: string;
}

export interface BuildInput {
  files: GeneratedFile[];
  fallbackSpec: AppSpec;
}

export interface BuildHooks {
  onLog?: (line: string) => void;
  /** Given build errors + current files, return a corrected fileset. */
  fix?: (errors: string, files: GeneratedFile[]) => Promise<GeneratedFile[]>;
}

const MAX_FIX_ROUNDS = 3;

/**
 * Scaffolds a Flutter project, compiles the MODEL-AUTHORED source (running an
 * analyze → fix loop to repair compile errors), and builds it for web (for the
 * in-dashboard emulator) and Android (downloadable APK). Falls back to the
 * deterministic template only if the model's code cannot be made to build.
 */
export async function buildApp(
  projectId: string,
  input: BuildInput,
  hooks: BuildHooks = {},
): Promise<BuildResult> {
  const log = (l: string) => hooks.onLog?.(l);
  const spec = input.fallbackSpec;
  await fs.mkdir(WORKSPACE_ROOT, { recursive: true });
  const dir = path.join(WORKSPACE_ROOT, projectId);
  await fs.rm(dir, { recursive: true, force: true });

  const pkg = safePackageName(spec.appName || 'factory_app');
  let fullLog = '';
  let mode: BuildMode = 'model-authored';
  let fixRounds = 0;

  log(`scaffolding flutter project (${pkg})…`);
  const create = await run(['create', '--platforms=web,android', '--project-name', pkg, dir], WORKSPACE_ROOT, 3 * 60 * 1000);
  fullLog += `${create.log}\n`;
  if (!create.ok && !existsSync(path.join(dir, 'pubspec.yaml'))) {
    return { dir, mode, fixRounds, webReady: false, apkPath: null, sourcePath: null, log: `flutter create failed:\n${create.log}` };
  }

  // 1) Write the model-authored files (fall back immediately if unusable).
  let usingModel = await writeModelFiles(dir, input.files);
  if (!usingModel) {
    log('model produced no usable files — using template fallback.');
    fullLog += '\nmodel fileset unusable (no lib/main.dart) — template fallback\n';
    mode = 'template-fallback';
    await writeTemplate(dir, spec);
  }

  await run(['pub', 'get'], dir, 2 * 60 * 1000);

  // 2) analyze → fix loop (only for model-authored code).
  if (usingModel) {
    for (let round = 0; round <= MAX_FIX_ROUNDS; round++) {
      log(round === 0 ? 'analyzing model code…' : `applying AI fix (round ${round})…`);
      const analyze = await run(['analyze', '--no-fatal-infos'], dir);
      fullLog += `\n=== flutter analyze (round ${round}) ===\n${analyze.log}\n`;
      if (analyze.ok) break;
      if (!hooks.fix || round === MAX_FIX_ROUNDS) break;

      const current = await readLibFiles(dir);
      let fixed: GeneratedFile[] = [];
      try {
        fixed = await hooks.fix(analyze.log, current);
      } catch (e) {
        fullLog += `fix call failed: ${String((e as Error).message ?? e)}\n`;
      }
      if (!fixed.length || !(await writeModelFiles(dir, fixed))) {
        fullLog += 'fixer returned no usable fileset — stopping fix loop\n';
        break;
      }
      fixRounds = round + 1;
      await run(['pub', 'get'], dir, 2 * 60 * 1000);
    }
  }

  // 3) Build web.
  log('building web (this powers the emulator)…');
  let web = await run(
    ['build', 'web', '--release', '--web-renderer', 'html', '--base-href', `/api/preview/${projectId}/`],
    dir,
  );
  fullLog += `\n=== flutter build web ===\n${web.log}\n`;

  // 3a) One extra fix attempt using real build errors, then rebuild.
  if (!web.ok && usingModel && hooks.fix && fixRounds < MAX_FIX_ROUNDS) {
    log('build failed — one more AI fix from build errors…');
    const current = await readLibFiles(dir);
    try {
      const fixed = await hooks.fix(web.log, current);
      if (fixed.length && (await writeModelFiles(dir, fixed))) {
        fixRounds++;
        await run(['pub', 'get'], dir, 2 * 60 * 1000);
        web = await run(
          ['build', 'web', '--release', '--web-renderer', 'html', '--base-href', `/api/preview/${projectId}/`],
          dir,
        );
        fullLog += `\n=== flutter build web (after fix) ===\n${web.log}\n`;
      }
    } catch {
      /* fall through to fallback */
    }
  }

  let webReady = web.ok && existsSync(path.join(dir, 'build/web/index.html'));

  // 3b) Last resort: deterministic template so a build never yields nothing.
  if (!webReady && usingModel) {
    log('model code would not build — falling back to template.');
    fullLog += '\nmodel code did not build — template fallback\n';
    mode = 'template-fallback';
    usingModel = false;
    await writeTemplate(dir, spec);
    await run(['pub', 'get'], dir, 2 * 60 * 1000);
    web = await run(
      ['build', 'web', '--release', '--web-renderer', 'html', '--base-href', `/api/preview/${projectId}/`],
      dir,
    );
    fullLog += `\n=== flutter build web (template) ===\n${web.log}\n`;
    webReady = web.ok && existsSync(path.join(dir, 'build/web/index.html'));
  }

  // Give the app a human-friendly title on Android.
  const manifest = path.join(dir, 'android/app/src/main/AndroidManifest.xml');
  try {
    const xml = await fs.readFile(manifest, 'utf8');
    await fs.writeFile(manifest, xml.replace(/android:label="[^"]*"/, `android:label="${spec.appName.replace(/"/g, '')}"`));
  } catch {
    /* non-fatal */
  }

  log('building Android APK…');
  const apk = await run(['build', 'apk', '--debug'], dir);
  fullLog += `\n=== flutter build apk ===\n${apk.log}\n`;
  const apkBuilt = path.join(dir, 'build/app/outputs/flutter-apk/app-debug.apk');
  const apkPath = apk.ok && existsSync(apkBuilt) ? apkBuilt : null;

  // Zip the source for the "Source" download.
  let sourcePath: string | null = null;
  try {
    const zipPath = path.join(dir, 'source.zip');
    await execFileP('zip', ['-r', '-q', zipPath, 'lib', 'pubspec.yaml'], { cwd: dir, timeout: 60_000, maxBuffer: 32 * 1024 * 1024 });
    if (existsSync(zipPath)) sourcePath = zipPath;
  } catch {
    /* zip is best-effort */
  }

  const header = `mode: ${mode}\nfix_rounds: ${fixRounds}\n`;
  return { dir, mode, fixRounds, webReady, apkPath, sourcePath, log: (header + fullLog).slice(-16000) };
}
