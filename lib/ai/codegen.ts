/**
 * Flutter source emitter.
 *
 * Produces real, compilable Dart for a multi-screen app whose features come
 * from the analyzed profile. The generated app is genuinely functional:
 *   - bottom-navigation shell across the core screens
 *   - working search filtering (stateful)
 *   - a favourites toggle backed by shared app state
 *   - a light/dark theme switch driven from Settings
 *   - push navigation to per-item detail screens
 *
 * It uses only the Flutter SDK (no third-party packages) so `flutter create`
 * + `flutter build apk` compiles it reliably. `${'$'}` is used wherever a
 * literal Dart `$` must survive the JS template literal.
 */
import type { AppProfile, GeneratedFile } from './factory';

const D = '$'; // literal Dart dollar sign inside JS template strings

function dartString(s: string): string {
  return `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

export function generateFlutterFiles(p: AppProfile, referenceUrl: string): GeneratedFile[] {
  const core = p.features.filter((f) => f.screen !== 'Settings');
  const navFeatures = core.slice(0, 4); // bottom nav tabs
  const files: GeneratedFile[] = [];

  // ---- theme ----
  files.push({
    path: 'lib/theme/app_theme.dart',
    language: 'dart',
    content: `import 'package:flutter/material.dart';

class AppTheme {
  static const seed = Color(0xFF${p.palette.primary.slice(1)});
  static const accent = Color(0xFF${p.palette.accent.slice(1)});

  static ThemeData get light => _base(Brightness.light);
  static ThemeData get dark => _base(Brightness.dark);

  static ThemeData _base(Brightness b) {
    final scheme = ColorScheme.fromSeed(seedColor: seed, brightness: b);
    return ThemeData(
      useMaterial3: true,
      colorScheme: scheme,
      appBarTheme: const AppBarTheme(centerTitle: false),
      cardTheme: CardTheme(
        elevation: 0,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      ),
    );
  }
}
`,
  });

  // ---- data + shared state ----
  const featureItems = (f: (typeof p.features)[number]) =>
    Array.from({ length: 6 }, (_, i) => `FeedItem(id: '${f.screen}-${i}', title: ${dartString(`${f.name} item ${i + 1}`)}, subtitle: ${dartString(f.description)})`).join(',\n      ');

  files.push({
    path: 'lib/data/app_data.dart',
    language: 'dart',
    content: `import 'package:flutter/foundation.dart';

/// A single piece of content shown in a feature list.
class FeedItem {
  final String id;
  final String title;
  final String subtitle;
  const FeedItem({required this.id, required this.title, required this.subtitle});
}

class FeatureData {
  final String screen;
  final String title;
  final String description;
  final List<FeedItem> items;
  const FeatureData({required this.screen, required this.title, required this.description, required this.items});
}

/// Seed content derived from the analyzed reference app.
const List<FeatureData> kFeatures = [
${core
  .map(
    (f) => `  FeatureData(
    screen: ${dartString(f.screen)},
    title: ${dartString(f.name)},
    description: ${dartString(f.description)},
    items: [
      ${featureItems(f)},
    ],
  ),`,
  )
  .join('\n')}
];

/// Shared favourites state — a real, app-wide store the UI reads and mutates.
class AppState extends ChangeNotifier {
  final Set<String> _favorites = <String>{};
  Set<String> get favorites => _favorites;
  bool isFavorite(String id) => _favorites.contains(id);
  void toggleFavorite(String id) {
    if (!_favorites.remove(id)) _favorites.add(id);
    notifyListeners();
  }
}

final appState = AppState();
`,
  });

  // ---- detail screen ----
  files.push({
    path: 'lib/screens/detail_screen.dart',
    language: 'dart',
    content: `import 'package:flutter/material.dart';
import '../data/app_data.dart';

class DetailScreen extends StatelessWidget {
  final FeedItem item;
  const DetailScreen({super.key, required this.item});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: Text(item.title)),
      body: AnimatedBuilder(
        animation: appState,
        builder: (context, _) {
          final fav = appState.isFavorite(item.id);
          return ListView(
            padding: const EdgeInsets.all(16),
            children: [
              Container(
                height: 180,
                decoration: BoxDecoration(
                  borderRadius: BorderRadius.circular(20),
                  gradient: LinearGradient(colors: [
                    Theme.of(context).colorScheme.primary,
                    Theme.of(context).colorScheme.tertiary,
                  ]),
                ),
                child: const Center(child: Icon(Icons.apps, size: 64, color: Colors.white)),
              ),
              const SizedBox(height: 16),
              Text(item.title, style: Theme.of(context).textTheme.headlineSmall),
              const SizedBox(height: 8),
              Text(item.subtitle, style: Theme.of(context).textTheme.bodyMedium),
              const SizedBox(height: 24),
              FilledButton.icon(
                onPressed: () => appState.toggleFavorite(item.id),
                icon: Icon(fav ? Icons.favorite : Icons.favorite_border),
                label: Text(fav ? 'Remove from favourites' : 'Add to favourites'),
              ),
            ],
          );
        },
      ),
    );
  }
}
`,
  });

  // ---- generic feature screen (search + favourite + navigate) ----
  files.push({
    path: 'lib/screens/feature_screen.dart',
    language: 'dart',
    content: `import 'package:flutter/material.dart';
import '../data/app_data.dart';
import 'detail_screen.dart';

class FeatureScreen extends StatefulWidget {
  final FeatureData feature;
  const FeatureScreen({super.key, required this.feature});

  @override
  State<FeatureScreen> createState() => _FeatureScreenState();
}

class _FeatureScreenState extends State<FeatureScreen> {
  String _query = '';

  @override
  Widget build(BuildContext context) {
    final items = widget.feature.items
        .where((i) => i.title.toLowerCase().contains(_query.toLowerCase()))
        .toList();
    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.all(12),
          child: TextField(
            decoration: const InputDecoration(
              prefixIcon: Icon(Icons.search),
              hintText: 'Search',
              border: OutlineInputBorder(),
            ),
            onChanged: (v) => setState(() => _query = v),
          ),
        ),
        Expanded(
          child: AnimatedBuilder(
            animation: appState,
            builder: (context, _) => items.isEmpty
                ? const Center(child: Text('No results'))
                : ListView.separated(
                    itemCount: items.length,
                    separatorBuilder: (_, __) => const Divider(height: 1),
                    itemBuilder: (context, i) {
                      final item = items[i];
                      final fav = appState.isFavorite(item.id);
                      return ListTile(
                        leading: CircleAvatar(child: Text((i + 1).toString())),
                        title: Text(item.title),
                        subtitle: Text(item.subtitle, maxLines: 1, overflow: TextOverflow.ellipsis),
                        trailing: IconButton(
                          icon: Icon(fav ? Icons.favorite : Icons.favorite_border,
                              color: fav ? Colors.pink : null),
                          onPressed: () => appState.toggleFavorite(item.id),
                        ),
                        onTap: () => Navigator.of(context).push(
                          MaterialPageRoute(builder: (_) => DetailScreen(item: item)),
                        ),
                      );
                    },
                  ),
          ),
        ),
      ],
    );
  }
}
`,
  });

  // ---- home dashboard ----
  files.push({
    path: 'lib/screens/home_screen.dart',
    language: 'dart',
    content: `import 'package:flutter/material.dart';
import '../data/app_data.dart';
import 'feature_screen.dart';

class HomeScreen extends StatelessWidget {
  const HomeScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return GridView.count(
      crossAxisCount: 2,
      padding: const EdgeInsets.all(16),
      mainAxisSpacing: 12,
      crossAxisSpacing: 12,
      childAspectRatio: 1.1,
      children: kFeatures.map((f) {
        return Card(
          clipBehavior: Clip.antiAlias,
          child: InkWell(
            onTap: () => Navigator.of(context).push(
              MaterialPageRoute(
                builder: (_) => Scaffold(
                  appBar: AppBar(title: Text(f.title)),
                  body: FeatureScreen(feature: f),
                ),
              ),
            ),
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Icon(Icons.dashboard_customize,
                      color: Theme.of(context).colorScheme.primary, size: 32),
                  Text(f.title, style: Theme.of(context).textTheme.titleMedium),
                  Text(f.description,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: Theme.of(context).textTheme.bodySmall),
                ],
              ),
            ),
          ),
        );
      }).toList(),
    );
  }
}
`,
  });

  // ---- settings ----
  files.push({
    path: 'lib/screens/settings_screen.dart',
    language: 'dart',
    content: `import 'package:flutter/material.dart';
import '../data/app_data.dart';

class SettingsScreen extends StatelessWidget {
  final bool isDark;
  final VoidCallback onToggleTheme;
  const SettingsScreen({super.key, required this.isDark, required this.onToggleTheme});

  @override
  Widget build(BuildContext context) {
    return ListView(
      children: [
        SwitchListTile(
          title: const Text('Dark theme'),
          subtitle: const Text('Toggle between light and dark mode'),
          value: isDark,
          onChanged: (_) => onToggleTheme(),
        ),
        const ListTile(leading: Icon(Icons.notifications), title: Text('Notifications')),
        const ListTile(leading: Icon(Icons.lock), title: Text('Privacy & Security')),
        AnimatedBuilder(
          animation: appState,
          builder: (context, _) => ListTile(
            leading: const Icon(Icons.favorite),
            title: const Text('Favourites'),
            trailing: Text(appState.favorites.length.toString()),
          ),
        ),
        const ListTile(leading: Icon(Icons.info_outline), title: Text('About'),
            subtitle: Text(${dartString(`Generated from ${referenceUrl}`)})),
      ],
    );
  }
}
`,
  });

  // ---- root shell (bottom nav) ----
  const navScreens = navFeatures
    .map(
      (f, i) => `    _NavItem(
      label: ${dartString(f.name)},
      icon: Icons.${['home', 'grid_view', 'explore', 'list_alt'][i] ?? 'circle'},
      builder: () => FeatureScreen(feature: kFeatures[${core.findIndex((c) => c.screen === f.screen)}]),
    ),`,
    )
    .join('\n');

  files.push({
    path: 'lib/screens/root_shell.dart',
    language: 'dart',
    content: `import 'package:flutter/material.dart';
import '../data/app_data.dart';
import 'home_screen.dart';
import 'feature_screen.dart';
import 'settings_screen.dart';

class _NavItem {
  final String label;
  final IconData icon;
  final Widget Function() builder;
  _NavItem({required this.label, required this.icon, required this.builder});
}

class RootShell extends StatefulWidget {
  final bool isDark;
  final VoidCallback onToggleTheme;
  const RootShell({super.key, required this.isDark, required this.onToggleTheme});

  @override
  State<RootShell> createState() => _RootShellState();
}

class _RootShellState extends State<RootShell> {
  int _index = 0;

  late final List<_NavItem> _items = [
    _NavItem(label: 'Home', icon: Icons.home, builder: () => const HomeScreen()),
${navScreens}
    _NavItem(
      label: 'Settings',
      icon: Icons.settings,
      builder: () => SettingsScreen(isDark: widget.isDark, onToggleTheme: widget.onToggleTheme),
    ),
  ];

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: Text(_items[_index].label)),
      body: _items[_index].builder(),
      bottomNavigationBar: NavigationBar(
        selectedIndex: _index,
        onDestinationSelected: (i) => setState(() => _index = i),
        destinations: _items
            .map((it) => NavigationDestination(icon: Icon(it.icon), label: it.label))
            .toList(),
      ),
    );
  }
}
`,
  });

  // ---- main ----
  files.push({
    path: 'lib/main.dart',
    language: 'dart',
    content: `import 'package:flutter/material.dart';
import 'theme/app_theme.dart';
import 'screens/root_shell.dart';

void main() => runApp(const FactoryApp());

class FactoryApp extends StatefulWidget {
  const FactoryApp({super.key});

  @override
  State<FactoryApp> createState() => _FactoryAppState();
}

class _FactoryAppState extends State<FactoryApp> {
  ThemeMode _mode = ThemeMode.dark;

  void _toggleTheme() =>
      setState(() => _mode = _mode == ThemeMode.dark ? ThemeMode.light : ThemeMode.dark);

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: ${dartString(p.appName)},
      debugShowCheckedModeBanner: false,
      theme: AppTheme.light,
      darkTheme: AppTheme.dark,
      themeMode: _mode,
      home: RootShell(isDark: _mode == ThemeMode.dark, onToggleTheme: _toggleTheme),
    );
  }
}
`,
  });

  // ---- widget smoke test ----
  files.push({
    path: 'test/widget_test.dart',
    language: 'dart',
    content: `import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:factory_app/main.dart';

void main() {
  testWidgets('App boots and shows the navigation shell', (tester) async {
    await tester.pumpWidget(const FactoryApp());
    await tester.pumpAndSettle();
    expect(find.byType(NavigationBar), findsOneWidget);
  });
}
`,
  });

  // ---- README ----
  files.push({
    path: 'README.md',
    language: 'markdown',
    content: `# ${p.appName}

Generated by the **AI App Factory** from [${referenceUrl}](${referenceUrl}).

- **Platform:** Flutter (cross-platform)
- **Package:** ${p.packageName}
- **Category:** ${p.category}

## Features
${p.features.map((f) => `- **${f.name}** — ${f.description}`).join('\n')}

## Run
\`\`\`bash
flutter pub get
flutter run
\`\`\`
`,
  });

  return files;
}
