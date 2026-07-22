/**
 * Flutter source emitter — generates a genuinely FUNCTIONAL app.
 *
 * The output is not a static mockup: it ships a persistent data store
 * (shared_preferences), full CRUD (add via a validated form, edit, delete),
 * search/filter, a favourites/cart system, a live stats dashboard and a
 * light/dark theme toggle — all wired to real state that survives a restart.
 *
 * Everything is parameterised by the analysed app category so an e-commerce
 * build talks about products & a cart total, a finance build about
 * transactions & a balance, a productivity build about tasks & completion, etc.
 *
 * Uses only the Flutter SDK + shared_preferences so `flutter build apk`/`web`
 * compile reliably. Generated Dart avoids `$`-interpolation (it would collide
 * with the JS template literal); string concatenation is used instead.
 */
import type { AppProfile, GeneratedFile } from './factory';

function dartString(s: string): string {
  return `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

interface CatConfig {
  itemNoun: string;
  itemNounPlural: string;
  collectionTitle: string;
  showValue: boolean;
  valueLabel: string;
  showDone: boolean;
  favoriteVerb: string;
  favoriteNoun: string;
  metricLabel: string;
  metricKind: 'sum' | 'sumFavorites' | 'completed' | 'favCount' | 'count';
  currency: boolean;
  addTitle: string;
}

function catConfig(category: string): CatConfig {
  switch (category) {
    case 'ecommerce':
      return { itemNoun: 'Product', itemNounPlural: 'Products', collectionTitle: 'Catalog', showValue: true, valueLabel: 'Price', showDone: false, favoriteVerb: 'Add to cart', favoriteNoun: 'Cart', metricLabel: 'Cart total', metricKind: 'sumFavorites', currency: true, addTitle: 'Add product' };
    case 'finance':
      return { itemNoun: 'Transaction', itemNounPlural: 'Transactions', collectionTitle: 'Transactions', showValue: true, valueLabel: 'Amount', showDone: false, favoriteVerb: 'Flag', favoriteNoun: 'Flagged', metricLabel: 'Balance', metricKind: 'sum', currency: true, addTitle: 'Add transaction' };
    case 'productivity':
      return { itemNoun: 'Task', itemNounPlural: 'Tasks', collectionTitle: 'Tasks', showValue: false, valueLabel: 'Value', showDone: true, favoriteVerb: 'Star', favoriteNoun: 'Starred', metricLabel: 'Completed', metricKind: 'completed', currency: false, addTitle: 'Add task' };
    case 'media':
      return { itemNoun: 'Track', itemNounPlural: 'Tracks', collectionTitle: 'Browse', showValue: false, valueLabel: 'Value', showDone: false, favoriteVerb: 'Add to library', favoriteNoun: 'Library', metricLabel: 'In library', metricKind: 'favCount', currency: false, addTitle: 'Add track' };
    case 'social':
      return { itemNoun: 'Post', itemNounPlural: 'Posts', collectionTitle: 'Feed', showValue: false, valueLabel: 'Value', showDone: false, favoriteVerb: 'Like', favoriteNoun: 'Liked', metricLabel: 'Posts', metricKind: 'count', currency: false, addTitle: 'New post' };
    default:
      return { itemNoun: 'Item', itemNounPlural: 'Items', collectionTitle: 'Items', showValue: false, valueLabel: 'Value', showDone: false, favoriteVerb: 'Save', favoriteNoun: 'Saved', metricLabel: 'Items', metricKind: 'count', currency: false, addTitle: 'Add item' };
  }
}

/** Dart expression (string) that renders the home dashboard metric. */
function metricExpr(c: CatConfig): string {
  switch (c.metricKind) {
    case 'sum': return "kCurrency + store.totalValue.toStringAsFixed(2)";
    case 'sumFavorites': return "kCurrency + store.favoritesValue.toStringAsFixed(2)";
    case 'completed': return "store.doneCount.toString() + ' / ' + store.items.length.toString()";
    case 'favCount': return "store.favoritesCount.toString()";
    case 'count': return "store.items.length.toString()";
  }
}

export function generateFlutterFiles(p: AppProfile, referenceUrl: string): GeneratedFile[] {
  const c = catConfig(p.category);
  const files: GeneratedFile[] = [];

  // Seed items derived from the analysed features.
  const seed = p.features.slice(0, 8).map((f, i) => {
    const value = c.showValue ? (9.99 + i * 7).toFixed(2) : '0';
    return `Item(id: ${dartString('seed-' + i)}, title: ${dartString(f.name)}, subtitle: ${dartString(f.description)}, value: ${value}, done: false, favorite: ${i % 4 === 0 ? 'true' : 'false'})`;
  }).join(',\n    ');

  // ---- theme ----
  files.push({
    path: 'lib/theme/app_theme.dart',
    language: 'dart',
    content: `import 'package:flutter/material.dart';

class AppTheme {
  static const seed = Color(0xFF${p.palette.primary.slice(1)});

  static ThemeData get light => _base(Brightness.light);
  static ThemeData get dark => _base(Brightness.dark);

  static ThemeData _base(Brightness b) {
    final scheme = ColorScheme.fromSeed(seedColor: seed, brightness: b);
    return ThemeData(
      useMaterial3: true,
      colorScheme: scheme,
      appBarTheme: const AppBarTheme(centerTitle: false),
      inputDecorationTheme: const InputDecorationTheme(border: OutlineInputBorder()),
      cardTheme: CardTheme(
        elevation: 0,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      ),
    );
  }
}
`,
  });

  // ---- model ----
  files.push({
    path: 'lib/data/models.dart',
    language: 'dart',
    content: `/// A single record in the app's collection.
class Item {
  String id;
  String title;
  String subtitle;
  double value;
  bool done;
  bool favorite;

  Item({
    required this.id,
    required this.title,
    required this.subtitle,
    this.value = 0,
    this.done = false,
    this.favorite = false,
  });

  Map<String, dynamic> toJson() => {
        'id': id,
        'title': title,
        'subtitle': subtitle,
        'value': value,
        'done': done,
        'favorite': favorite,
      };

  factory Item.fromJson(Map<String, dynamic> j) => Item(
        id: j['id'] as String,
        title: j['title'] as String,
        subtitle: (j['subtitle'] ?? '') as String,
        value: (j['value'] ?? 0).toDouble(),
        done: (j['done'] ?? false) as bool,
        favorite: (j['favorite'] ?? false) as bool,
      );
}
`,
  });

  // ---- store (persistent, ChangeNotifier) ----
  files.push({
    path: 'lib/data/store.dart',
    language: 'dart',
    content: `import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'models.dart';

const kCurrency = '\\u0024'; // '$' rendered without clashing with codegen

/// App-wide persistent state. All mutations save to shared_preferences and
/// notify listeners so the UI stays in sync — real, durable functionality.
class AppStore extends ChangeNotifier {
  List<Item> items = [];
  ThemeMode themeMode = ThemeMode.dark;

  static const _itemsKey = 'items_v1';
  static const _themeKey = 'theme_v1';

  List<Item> seed() => [
    ${seed}
  ];

  Future<void> load() async {
    final prefs = await SharedPreferences.getInstance();
    final raw = prefs.getString(_itemsKey);
    if (raw != null && raw.isNotEmpty) {
      final list = jsonDecode(raw) as List;
      items = list.map((e) => Item.fromJson(e as Map<String, dynamic>)).toList();
    } else {
      items = seed();
      await _persistItems(prefs);
    }
    themeMode = prefs.getString(_themeKey) == 'light' ? ThemeMode.light : ThemeMode.dark;
    notifyListeners();
  }

  Future<void> _persistItems(SharedPreferences prefs) async {
    await prefs.setString(_itemsKey, jsonEncode(items.map((e) => e.toJson()).toList()));
  }

  Future<void> _save() async {
    final prefs = await SharedPreferences.getInstance();
    await _persistItems(prefs);
  }

  int _seq = 0;
  String _nextId() {
    _seq++;
    return 'item-' + DateTime.now().millisecondsSinceEpoch.toString() + '-' + _seq.toString();
  }

  void addItem(String title, String subtitle, double value) {
    items.insert(0, Item(id: _nextId(), title: title, subtitle: subtitle, value: value));
    _save();
    notifyListeners();
  }

  void updateItem(Item item, String title, String subtitle, double value) {
    item.title = title;
    item.subtitle = subtitle;
    item.value = value;
    _save();
    notifyListeners();
  }

  void deleteItem(String id) {
    items.removeWhere((e) => e.id == id);
    _save();
    notifyListeners();
  }

  void toggleFavorite(String id) {
    final it = items.firstWhere((e) => e.id == id, orElse: () => Item(id: '', title: '', subtitle: ''));
    if (it.id.isEmpty) return;
    it.favorite = !it.favorite;
    _save();
    notifyListeners();
  }

  void toggleDone(String id) {
    final it = items.firstWhere((e) => e.id == id, orElse: () => Item(id: '', title: '', subtitle: ''));
    if (it.id.isEmpty) return;
    it.done = !it.done;
    _save();
    notifyListeners();
  }

  Future<void> clearAll() async {
    items = seed();
    await _save();
    notifyListeners();
  }

  void setTheme(bool dark) async {
    themeMode = dark ? ThemeMode.dark : ThemeMode.light;
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_themeKey, dark ? 'dark' : 'light');
    notifyListeners();
  }

  List<Item> get favorites => items.where((e) => e.favorite).toList();
  int get favoritesCount => favorites.length;
  int get doneCount => items.where((e) => e.done).length;
  double get totalValue => items.fold(0.0, (s, e) => s + e.value);
  double get favoritesValue => favorites.fold(0.0, (s, e) => s + e.value);
}

final store = AppStore();
`,
  });

  // ---- add / edit form ----
  const valueField = c.showValue
    ? `
              TextFormField(
                controller: _value,
                keyboardType: const TextInputType.numberWithOptions(decimal: true),
                decoration: const InputDecoration(labelText: ${dartString(c.valueLabel)}),
                validator: (v) {
                  if (v == null || v.trim().isEmpty) return 'Enter a ${c.valueLabel.toLowerCase()}';
                  if (double.tryParse(v.trim()) == null) return 'Must be a number';
                  return null;
                },
              ),
              const SizedBox(height: 12),`
    : '';

  files.push({
    path: 'lib/screens/add_item_screen.dart',
    language: 'dart',
    content: `import 'package:flutter/material.dart';
import '../data/models.dart';
import '../data/store.dart';

/// Add or edit a record via a validated form — real create/update behaviour.
class AddItemScreen extends StatefulWidget {
  final Item? existing;
  const AddItemScreen({super.key, this.existing});

  @override
  State<AddItemScreen> createState() => _AddItemScreenState();
}

class _AddItemScreenState extends State<AddItemScreen> {
  final _formKey = GlobalKey<FormState>();
  late final TextEditingController _title = TextEditingController(text: widget.existing?.title ?? '');
  late final TextEditingController _subtitle = TextEditingController(text: widget.existing?.subtitle ?? '');
  late final TextEditingController _value =
      TextEditingController(text: widget.existing == null ? '' : widget.existing!.value.toStringAsFixed(2));

  @override
  void dispose() {
    _title.dispose();
    _subtitle.dispose();
    _value.dispose();
    super.dispose();
  }

  void _submit() {
    if (!_formKey.currentState!.validate()) return;
    final title = _title.text.trim();
    final subtitle = _subtitle.text.trim();
    final value = double.tryParse(_value.text.trim()) ?? 0;
    if (widget.existing == null) {
      store.addItem(title, subtitle, value);
    } else {
      store.updateItem(widget.existing!, title, subtitle, value);
    }
    Navigator.of(context).pop();
  }

  @override
  Widget build(BuildContext context) {
    final editing = widget.existing != null;
    return Scaffold(
      appBar: AppBar(title: Text(editing ? 'Edit ${c.itemNoun}' : ${dartString(c.addTitle)})),
      body: Form(
        key: _formKey,
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            TextFormField(
              controller: _title,
              decoration: const InputDecoration(labelText: 'Title'),
              textInputAction: TextInputAction.next,
              validator: (v) => (v == null || v.trim().isEmpty) ? 'Title is required' : null,
            ),
            const SizedBox(height: 12),
            TextFormField(
              controller: _subtitle,
              decoration: const InputDecoration(labelText: 'Description'),
              maxLines: 2,
            ),
            const SizedBox(height: 12),${valueField}
            FilledButton.icon(
              onPressed: _submit,
              icon: const Icon(Icons.check),
              label: Text(editing ? 'Save changes' : 'Add ${c.itemNoun}'),
            ),
          ],
        ),
      ),
    );
  }
}
`,
  });

  // ---- detail ----
  files.push({
    path: 'lib/screens/detail_screen.dart',
    language: 'dart',
    content: `import 'package:flutter/material.dart';
import '../data/store.dart';
import 'add_item_screen.dart';

class DetailScreen extends StatelessWidget {
  final String itemId;
  const DetailScreen({super.key, required this.itemId});

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: store,
      builder: (context, _) {
        final matches = store.items.where((e) => e.id == itemId).toList();
        if (matches.isEmpty) {
          return Scaffold(appBar: AppBar(), body: const Center(child: Text('Removed')));
        }
        final item = matches.first;
        return Scaffold(
          appBar: AppBar(
            title: Text(item.title),
            actions: [
              IconButton(
                icon: const Icon(Icons.edit),
                onPressed: () => Navigator.of(context).push(
                  MaterialPageRoute(builder: (_) => AddItemScreen(existing: item)),
                ),
              ),
              IconButton(
                icon: const Icon(Icons.delete_outline),
                onPressed: () {
                  store.deleteItem(item.id);
                  Navigator.of(context).pop();
                },
              ),
            ],
          ),
          body: ListView(
            padding: const EdgeInsets.all(16),
            children: [
              Container(
                height: 160,
                decoration: BoxDecoration(
                  borderRadius: BorderRadius.circular(20),
                  gradient: LinearGradient(colors: [
                    Theme.of(context).colorScheme.primary,
                    Theme.of(context).colorScheme.tertiary,
                  ]),
                ),
                child: const Center(child: Icon(Icons.apps, size: 56, color: Colors.white)),
              ),
              const SizedBox(height: 16),
              Text(item.title, style: Theme.of(context).textTheme.headlineSmall),
              const SizedBox(height: 8),
              Text(item.subtitle, style: Theme.of(context).textTheme.bodyMedium),
              const SizedBox(height: 8),
              ${c.showValue ? "Text(${dartString(c.valueLabel + ': ')} + kCurrency + item.value.toStringAsFixed(2), style: Theme.of(context).textTheme.titleMedium)," : "const SizedBox.shrink(),"}
              const SizedBox(height: 24),
              FilledButton.icon(
                onPressed: () => store.toggleFavorite(item.id),
                icon: Icon(item.favorite ? Icons.favorite : Icons.favorite_border),
                label: Text(item.favorite ? 'Remove from ${c.favoriteNoun}' : ${dartString(c.favoriteVerb)}),
              ),
            ],
          ),
        );
      },
    );
  }
}
`,
  });

  // ---- collection (search + CRUD list) ----
  const doneLeading = c.showDone
    ? `Checkbox(value: item.done, onChanged: (_) => store.toggleDone(item.id))`
    : `CircleAvatar(child: Text((i + 1).toString()))`;
  const valueTrailingText = c.showValue
    ? `Text(kCurrency + item.value.toStringAsFixed(2), style: Theme.of(context).textTheme.labelLarge),`
    : ``;

  files.push({
    path: 'lib/screens/collection_screen.dart',
    language: 'dart',
    content: `import 'package:flutter/material.dart';
import '../data/store.dart';
import 'detail_screen.dart';
import 'add_item_screen.dart';

/// The main working screen: search, add, edit, delete, favourite — all live.
class CollectionScreen extends StatefulWidget {
  const CollectionScreen({super.key});

  @override
  State<CollectionScreen> createState() => _CollectionScreenState();
}

class _CollectionScreenState extends State<CollectionScreen> {
  String _query = '';

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () => Navigator.of(context).push(
          MaterialPageRoute(builder: (_) => const AddItemScreen()),
        ),
        icon: const Icon(Icons.add),
        label: const Text('Add ${c.itemNoun}'),
      ),
      body: Column(
        children: [
          Padding(
            padding: const EdgeInsets.all(12),
            child: TextField(
              decoration: const InputDecoration(prefixIcon: Icon(Icons.search), hintText: 'Search'),
              onChanged: (v) => setState(() => _query = v),
            ),
          ),
          Expanded(
            child: AnimatedBuilder(
              animation: store,
              builder: (context, _) {
                final items = store.items
                    .where((e) => e.title.toLowerCase().contains(_query.toLowerCase()))
                    .toList();
                if (items.isEmpty) {
                  return const Center(child: Text('No ${c.itemNounPlural.toLowerCase()} yet — tap Add.'));
                }
                return ListView.separated(
                  padding: const EdgeInsets.only(bottom: 88),
                  itemCount: items.length,
                  separatorBuilder: (_, __) => const Divider(height: 1),
                  itemBuilder: (context, i) {
                    final item = items[i];
                    return Dismissible(
                      key: ValueKey(item.id),
                      direction: DismissDirection.endToStart,
                      background: Container(
                        alignment: Alignment.centerRight,
                        color: Colors.red.withOpacity(0.15),
                        padding: const EdgeInsets.only(right: 20),
                        child: const Icon(Icons.delete, color: Colors.red),
                      ),
                      onDismissed: (_) => store.deleteItem(item.id),
                      child: ListTile(
                        leading: ${doneLeading},
                        title: Text(
                          item.title,
                          style: item.done ? const TextStyle(decoration: TextDecoration.lineThrough) : null,
                        ),
                        subtitle: Text(item.subtitle, maxLines: 1, overflow: TextOverflow.ellipsis),
                        trailing: Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            ${valueTrailingText}
                            IconButton(
                              icon: Icon(item.favorite ? Icons.favorite : Icons.favorite_border,
                                  color: item.favorite ? Colors.pink : null),
                              onPressed: () => store.toggleFavorite(item.id),
                            ),
                          ],
                        ),
                        onTap: () => Navigator.of(context).push(
                          MaterialPageRoute(builder: (_) => DetailScreen(itemId: item.id)),
                        ),
                      ),
                    );
                  },
                );
              },
            ),
          ),
        ],
      ),
    );
  }
}
`,
  });

  // ---- favourites ----
  files.push({
    path: 'lib/screens/favorites_screen.dart',
    language: 'dart',
    content: `import 'package:flutter/material.dart';
import '../data/store.dart';
import 'detail_screen.dart';

class FavoritesScreen extends StatelessWidget {
  const FavoritesScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: store,
      builder: (context, _) {
        final favs = store.favorites;
        if (favs.isEmpty) {
          return const Center(child: Text('Nothing in ${c.favoriteNoun} yet.'));
        }
        return ListView.separated(
          itemCount: favs.length,
          separatorBuilder: (_, __) => const Divider(height: 1),
          itemBuilder: (context, i) {
            final item = favs[i];
            return ListTile(
              leading: const Icon(Icons.favorite, color: Colors.pink),
              title: Text(item.title),
              subtitle: Text(item.subtitle, maxLines: 1, overflow: TextOverflow.ellipsis),
              onTap: () => Navigator.of(context).push(
                MaterialPageRoute(builder: (_) => DetailScreen(itemId: item.id)),
              ),
            );
          },
        );
      },
    );
  }
}
`,
  });

  // ---- home dashboard (live stats) ----
  files.push({
    path: 'lib/screens/home_screen.dart',
    language: 'dart',
    content: `import 'package:flutter/material.dart';
import '../data/store.dart';

class HomeScreen extends StatelessWidget {
  final void Function(int) onOpenTab;
  const HomeScreen({super.key, required this.onOpenTab});

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: store,
      builder: (context, _) {
        return ListView(
          padding: const EdgeInsets.all(16),
          children: [
            Text('Overview', style: Theme.of(context).textTheme.titleLarge),
            const SizedBox(height: 12),
            Row(
              children: [
                _StatCard(label: ${dartString(c.itemNounPlural)}, value: store.items.length.toString(), icon: Icons.list_alt, onTap: () => onOpenTab(1)),
                const SizedBox(width: 12),
                _StatCard(label: ${dartString(c.favoriteNoun)}, value: store.favoritesCount.toString(), icon: Icons.favorite, onTap: () => onOpenTab(2)),
                const SizedBox(width: 12),
                _StatCard(label: ${dartString(c.metricLabel)}, value: ${metricExpr(c)}, icon: Icons.insights, onTap: () => onOpenTab(1)),
              ],
            ),
            const SizedBox(height: 20),
            Text('Quick actions', style: Theme.of(context).textTheme.titleMedium),
            const SizedBox(height: 8),
            Card(
              child: ListTile(
                leading: const Icon(Icons.add_circle_outline),
                title: const Text('Add ${c.itemNoun}'),
                subtitle: const Text('Create a new record'),
                onTap: () => onOpenTab(1),
              ),
            ),
            Card(
              child: ListTile(
                leading: const Icon(Icons.search),
                title: const Text('Browse ${c.itemNounPlural}'),
                onTap: () => onOpenTab(1),
              ),
            ),
          ],
        );
      },
    );
  }
}

class _StatCard extends StatelessWidget {
  final String label;
  final String value;
  final IconData icon;
  final VoidCallback onTap;
  const _StatCard({required this.label, required this.value, required this.icon, required this.onTap});

  @override
  Widget build(BuildContext context) {
    return Expanded(
      child: Card(
        clipBehavior: Clip.antiAlias,
        child: InkWell(
          onTap: onTap,
          child: Padding(
            padding: const EdgeInsets.all(14),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Icon(icon, color: Theme.of(context).colorScheme.primary),
                const SizedBox(height: 8),
                Text(value, style: Theme.of(context).textTheme.titleLarge),
                Text(label, style: Theme.of(context).textTheme.bodySmall, maxLines: 1, overflow: TextOverflow.ellipsis),
              ],
            ),
          ),
        ),
      ),
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
import '../data/store.dart';

class SettingsScreen extends StatelessWidget {
  const SettingsScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: store,
      builder: (context, _) {
        return ListView(
          children: [
            SwitchListTile(
              title: const Text('Dark theme'),
              subtitle: const Text('Toggle light / dark mode'),
              value: store.themeMode == ThemeMode.dark,
              onChanged: store.setTheme,
            ),
            ListTile(
              leading: const Icon(Icons.list_alt),
              title: const Text(${dartString(c.itemNounPlural)}),
              trailing: Text(store.items.length.toString()),
            ),
            ListTile(
              leading: const Icon(Icons.favorite),
              title: const Text(${dartString(c.favoriteNoun)}),
              trailing: Text(store.favoritesCount.toString()),
            ),
            ListTile(
              leading: const Icon(Icons.delete_sweep),
              title: const Text('Reset data'),
              subtitle: const Text('Restore the seed ${c.itemNounPlural.toLowerCase()}'),
              onTap: () async {
                final ok = await showDialog<bool>(
                  context: context,
                  builder: (ctx) => AlertDialog(
                    title: const Text('Reset data?'),
                    content: const Text('This restores the original sample data.'),
                    actions: [
                      TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')),
                      FilledButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Reset')),
                    ],
                  ),
                );
                if (ok == true) store.clearAll();
              },
            ),
            const AboutListTile(
              icon: Icon(Icons.info_outline),
              applicationName: ${dartString(p.appName)},
              applicationVersion: '0.1.0',
              child: Text('About'),
            ),
          ],
        );
      },
    );
  }
}
`,
  });

  // ---- root shell (bottom nav) ----
  files.push({
    path: 'lib/screens/root_shell.dart',
    language: 'dart',
    content: `import 'package:flutter/material.dart';
import 'home_screen.dart';
import 'collection_screen.dart';
import 'favorites_screen.dart';
import 'settings_screen.dart';

class RootShell extends StatefulWidget {
  const RootShell({super.key});

  @override
  State<RootShell> createState() => _RootShellState();
}

class _RootShellState extends State<RootShell> {
  int _index = 0;

  @override
  Widget build(BuildContext context) {
    final titles = ['Home', ${dartString(c.collectionTitle)}, ${dartString(c.favoriteNoun)}, 'Settings'];
    final pages = [
      HomeScreen(onOpenTab: (i) => setState(() => _index = i)),
      const CollectionScreen(),
      const FavoritesScreen(),
      const SettingsScreen(),
    ];
    return Scaffold(
      appBar: AppBar(title: Text(titles[_index])),
      body: pages[_index],
      bottomNavigationBar: NavigationBar(
        selectedIndex: _index,
        onDestinationSelected: (i) => setState(() => _index = i),
        destinations: [
          const NavigationDestination(icon: Icon(Icons.home_outlined), selectedIcon: Icon(Icons.home), label: 'Home'),
          NavigationDestination(icon: const Icon(Icons.list_alt_outlined), selectedIcon: const Icon(Icons.list_alt), label: ${dartString(c.collectionTitle)}),
          const NavigationDestination(icon: Icon(Icons.favorite_border), selectedIcon: Icon(Icons.favorite), label: ${dartString(c.favoriteNoun)}),
          const NavigationDestination(icon: Icon(Icons.settings_outlined), selectedIcon: Icon(Icons.settings), label: 'Settings'),
        ],
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
import 'data/store.dart';
import 'screens/root_shell.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await store.load();
  runApp(const FactoryApp());
}

class FactoryApp extends StatelessWidget {
  const FactoryApp({super.key});

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: store,
      builder: (context, _) {
        return MaterialApp(
          title: ${dartString(p.appName)},
          debugShowCheckedModeBanner: false,
          theme: AppTheme.light,
          darkTheme: AppTheme.dark,
          themeMode: store.themeMode,
          home: const RootShell(),
        );
      },
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

- **Platform:** Flutter (Android + Web)
- **Package:** ${p.packageName}
- **Category:** ${p.category}

## Functionality
- Persistent data store (\`shared_preferences\`) — data survives restarts
- Full CRUD: add via a validated form, edit, delete (swipe), search
- ${c.favoriteNoun} system + live stats dashboard (${c.metricLabel})
- Light / dark theme toggle
${p.features.map((f) => `- ${f.name} — ${f.description}`).join('\n')}

## Run
\`\`\`bash
flutter pub get
flutter run          # device / emulator
flutter run -d chrome  # web
\`\`\`
`,
  });

  return files;
}
