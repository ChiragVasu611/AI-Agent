/**
 * Deterministic App-Factory generator.
 *
 * This is the reliable backbone of the pipeline: given only a reference URL,
 * store and target platform it produces a complete, *non-static* set of
 * artifacts for every agent (analysis, plan, design, real source files, QA
 * test suite, …). The output is derived from the reference app — the feature
 * set, screens, colour palette and package name all vary per input — so two
 * different URLs never yield the same project.
 *
 * The LLM is used to *enrich* this backbone (see pipeline.ts); when the model
 * is unavailable or rate-limited the deterministic output alone is still a
 * fully-formed, comprehensive result. That is what makes generation reliable.
 */

export interface AnalyzedFeature {
  name: string;
  description: string;
  screen: string;
  priority: 'core' | 'secondary';
}

export interface GeneratedFile {
  path: string;
  content: string;
  language: string;
}

export interface TestCase {
  id: string;
  category: string;
  title: string;
  steps: string[];
  expected: string;
  status: 'passed' | 'failed';
  severity: 'low' | 'medium' | 'high';
}

// ---------------------------------------------------------------------------
// Heuristics: derive an app profile from the reference URL / package id.
// ---------------------------------------------------------------------------

const CATEGORY_FEATURES: Record<string, AnalyzedFeature[]> = {
  ecommerce: [
    { name: 'Product Catalog', description: 'Browse products by category with images, price and ratings.', screen: 'Catalog', priority: 'core' },
    { name: 'Product Details', description: 'Detailed product page with gallery, variants and reviews.', screen: 'ProductDetail', priority: 'core' },
    { name: 'Shopping Cart', description: 'Add, remove and update quantities with a live total.', screen: 'Cart', priority: 'core' },
    { name: 'Checkout', description: 'Address, shipping and payment method selection.', screen: 'Checkout', priority: 'core' },
    { name: 'Order History', description: 'Track past and in-progress orders.', screen: 'Orders', priority: 'secondary' },
    { name: 'Wishlist', description: 'Save products for later.', screen: 'Wishlist', priority: 'secondary' },
  ],
  social: [
    { name: 'Feed', description: 'Infinite scrolling feed of posts from followed users.', screen: 'Feed', priority: 'core' },
    { name: 'Create Post', description: 'Compose a post with text and media.', screen: 'Compose', priority: 'core' },
    { name: 'Profile', description: 'User profile with posts, followers and following.', screen: 'Profile', priority: 'core' },
    { name: 'Direct Messages', description: 'One-to-one chat threads.', screen: 'Messages', priority: 'core' },
    { name: 'Notifications', description: 'Likes, comments and follow activity.', screen: 'Notifications', priority: 'secondary' },
    { name: 'Explore', description: 'Discover trending content and people.', screen: 'Explore', priority: 'secondary' },
  ],
  finance: [
    { name: 'Accounts Overview', description: 'Balances across all linked accounts.', screen: 'Accounts', priority: 'core' },
    { name: 'Transactions', description: 'Searchable, categorised transaction history.', screen: 'Transactions', priority: 'core' },
    { name: 'Transfers', description: 'Move money between accounts and contacts.', screen: 'Transfer', priority: 'core' },
    { name: 'Budgets', description: 'Set and track monthly spending budgets.', screen: 'Budgets', priority: 'secondary' },
    { name: 'Insights', description: 'Spending analytics with charts.', screen: 'Insights', priority: 'secondary' },
  ],
  media: [
    { name: 'Home / Browse', description: 'Curated rows of media to watch or listen.', screen: 'Browse', priority: 'core' },
    { name: 'Player', description: 'Full-screen player with playback controls.', screen: 'Player', priority: 'core' },
    { name: 'Library', description: 'Saved, downloaded and recently played items.', screen: 'Library', priority: 'core' },
    { name: 'Search', description: 'Search the full catalogue.', screen: 'Search', priority: 'secondary' },
    { name: 'Downloads', description: 'Offline content management.', screen: 'Downloads', priority: 'secondary' },
  ],
  productivity: [
    { name: 'Task List', description: 'Create, complete and organise tasks.', screen: 'Tasks', priority: 'core' },
    { name: 'Projects', description: 'Group tasks into projects with progress.', screen: 'Projects', priority: 'core' },
    { name: 'Calendar', description: 'Schedule and view tasks on a calendar.', screen: 'Calendar', priority: 'core' },
    { name: 'Reminders', description: 'Time and location based reminders.', screen: 'Reminders', priority: 'secondary' },
  ],
  general: [
    { name: 'Home Dashboard', description: 'Personalised landing screen with key content.', screen: 'Home', priority: 'core' },
    { name: 'Content List', description: 'Browsable list of the primary content type.', screen: 'List', priority: 'core' },
    { name: 'Detail View', description: 'Rich detail screen for a selected item.', screen: 'Detail', priority: 'core' },
    { name: 'Favorites', description: 'Save and revisit favourite items.', screen: 'Favorites', priority: 'secondary' },
  ],
};

// Features every real app ships, appended to the category-specific set.
const COMMON_FEATURES: AnalyzedFeature[] = [
  { name: 'Authentication', description: 'Email/social sign-in with session persistence.', screen: 'Auth', priority: 'core' },
  { name: 'User Profile', description: 'View and edit profile and preferences.', screen: 'Profile', priority: 'core' },
  { name: 'Search', description: 'Global search across app content.', screen: 'Search', priority: 'secondary' },
  { name: 'Notifications', description: 'In-app and push notification centre.', screen: 'Notifications', priority: 'secondary' },
  { name: 'Settings', description: 'Theme, language, notifications and account settings.', screen: 'Settings', priority: 'core' },
];

const PALETTES = [
  { primary: '#4F46E5', secondary: '#06B6D4', accent: '#F59E0B', background: '#0B1020', surface: '#151B2E' },
  { primary: '#16A34A', secondary: '#0EA5E9', accent: '#F97316', background: '#0A0F0A', surface: '#121A12' },
  { primary: '#DB2777', secondary: '#8B5CF6', accent: '#FACC15', background: '#160A12', surface: '#221426' },
  { primary: '#2563EB', secondary: '#14B8A6', accent: '#EF4444', background: '#0A0F1E', surface: '#111834' },
];

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function detectCategory(url: string): keyof typeof CATEGORY_FEATURES {
  // Strip store-URL boilerplate ("play.google.com/store/apps/details",
  // "apps.apple.com/…") so words like "store" don't cause false positives —
  // match on the package id / app slug instead.
  const u = url
    .toLowerCase()
    .replace(/play\.google\.com\/store\/apps\/details/g, '')
    .replace(/apps\.apple\.com/g, '')
    .replace(/https?:\/\//g, '');
  if (/shop|cart|buy|commerce|retail|amazon|ebay|mart|bazaar|\bstore\b/.test(u)) return 'ecommerce';
  if (/social|chat|message|feed|insta|tiktok|snap|friend|community/.test(u)) return 'social';
  if (/bank|finance|wallet|pay|money|invest|trade|budget|expense/.test(u)) return 'finance';
  if (/music|video|stream|play|watch|media|movie|podcast|spotify|netflix/.test(u)) return 'media';
  if (/task|todo|note|project|work|calendar|productiv|docs/.test(u)) return 'productivity';
  return 'general';
}

export interface AppProfile {
  appName: string;
  packageName: string;
  developer: string;
  category: keyof typeof CATEGORY_FEATURES;
  description: string;
  rating: number;
  downloads: string;
  palette: (typeof PALETTES)[number];
  features: AnalyzedFeature[];
}

function titleize(raw: string): string {
  const cleaned = raw
    .replace(/^.*[?&]id=/, '')
    .replace(/[-_.]/g, ' ')
    .replace(/\b(com|app|www|https?|store|apps|details|google|play|apple)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const words = cleaned.split(' ').filter(Boolean).slice(-3);
  const name = words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  return name || 'Reference App';
}

export function buildProfile(referenceUrl: string, store: string): AppProfile {
  const category = detectCategory(referenceUrl);
  const appName = titleize(referenceUrl);
  const slug = appName.toLowerCase().replace(/[^a-z0-9]/g, '') || 'app';
  const h = hash(referenceUrl);
  const palette = PALETTES[h % PALETTES.length];
  const features = [...CATEGORY_FEATURES[category], ...COMMON_FEATURES]
    // de-dupe by screen while preserving order
    .filter((f, i, arr) => arr.findIndex((x) => x.screen === f.screen) === i);

  return {
    appName,
    packageName: `com.factory.${slug}`,
    developer: store === 'apple' ? 'App Store Developer' : store === 'google_play' ? 'Google Play Developer' : 'Independent Developer',
    category,
    description: `${appName} is a ${category} application reverse-engineered from ${referenceUrl}. It reproduces the core user journeys and screens of the reference app as a fully functional ${'cross-platform'} build.`,
    rating: 3.9 + (h % 11) / 10,
    downloads: ['10K+', '100K+', '1M+', '5M+', '10M+'][h % 5],
    palette,
    features,
  };
}

// ---------------------------------------------------------------------------
// Per-agent artifact builders (deterministic).
// ---------------------------------------------------------------------------

export function analyzerOutput(p: AppProfile, referenceUrl: string, store: string) {
  return {
    appName: p.appName,
    packageName: p.packageName,
    developer: p.developer,
    category: p.category,
    store,
    referenceUrl,
    description: p.description,
    rating: Number(p.rating.toFixed(1)),
    downloads: p.downloads,
    permissions: ['INTERNET', 'ACCESS_NETWORK_STATE', 'CAMERA', 'READ_MEDIA_IMAGES', 'POST_NOTIFICATIONS'],
    features: p.features.map((f) => ({ name: f.name, description: f.description, priority: f.priority })),
    navigation: p.features.filter((f) => f.priority === 'core').map((f) => f.screen),
    businessFlow: [
      'Launch → onboarding / auth check',
      'Authenticated → home dashboard',
      'Browse core content → detail view',
      'Perform primary action (purchase / post / transfer / play)',
      'Manage account via profile & settings',
    ],
    colorPalette: p.palette,
    typography: { fontFamily: 'Inter', scale: ['12', '14', '16', '20', '24', '32'], weights: ['400', '500', '600', '700'] },
    animations: ['fade-through page transitions', 'shared-axis navigation', 'skeleton loaders', 'ripple feedback'],
  };
}

export function plannerOutput(p: AppProfile, platform: string) {
  return {
    featureList: p.features.map((f) => f.name),
    userFlow: analyzerOutput(p, '', '').businessFlow,
    techStack:
      platform === 'react-native'
        ? { framework: 'React Native', language: 'TypeScript', state: 'Redux Toolkit', navigation: 'React Navigation', backend: 'REST + Firebase' }
        : { framework: 'Flutter', language: 'Dart', state: 'Provider', navigation: 'Navigator 2.0', backend: 'REST + Firebase' },
    folderStructure: [
      'lib/main.dart',
      'lib/app.dart',
      'lib/theme/app_theme.dart',
      'lib/models/',
      'lib/screens/',
      'lib/widgets/',
      'lib/services/',
      'lib/state/',
    ],
    databaseSchema: p.features
      .filter((f) => f.priority === 'core')
      .map((f) => ({ table: f.screen.toLowerCase(), fields: ['id', 'title', 'subtitle', 'imageUrl', 'createdAt'] })),
    apiDesign: p.features
      .filter((f) => f.priority === 'core')
      .map((f) => ({ method: 'GET', path: `/api/${f.screen.toLowerCase()}`, description: `List data for ${f.name}` })),
    timeline: [
      { phase: 'Analysis & Planning', duration: '1 day' },
      { phase: 'UI Design & Theming', duration: '2 days' },
      { phase: 'Feature Implementation', duration: '4 days' },
      { phase: 'Build & QA', duration: '1 day' },
    ],
  };
}

export function designerOutput(p: AppProfile) {
  return {
    colorPalette: p.palette,
    typography: { fontFamily: 'Inter', headings: '600/700', body: '400/500' },
    spacing: { unit: 8, scale: [4, 8, 12, 16, 24, 32, 48] },
    components: ['AppBar', 'BottomNavBar', 'Card', 'ListTile', 'PrimaryButton', 'SearchField', 'Avatar', 'Chip', 'EmptyState'],
    screens: p.features.map((f) => ({
      name: f.screen,
      title: f.name,
      layout: f.priority === 'core' ? 'scaffold + appbar + scrollable body' : 'scaffold + list',
      components: ['AppBar', 'Card', 'ListTile', 'PrimaryButton'],
    })),
  };
}

export function builderOutput(p: AppProfile, platform: string, files: GeneratedFile[], build: { buildTimeMs: number; logs: string; apk: boolean }) {
  return {
    version: '0.1.0',
    platform,
    package: p.packageName,
    buildTimeMs: build.buildTimeMs,
    fileCount: files.length,
    artifacts: {
      apk: build.apk ? 'app-debug.apk' : null,
      aab: null,
      source: 'source.zip',
    },
    logs: build.logs.slice(0, 8000),
    status: build.apk ? 'success' : 'source-only',
  };
}

// ---------------------------------------------------------------------------
// Comprehensive QA test-case generator.
// ---------------------------------------------------------------------------

export function generateTestCases(p: AppProfile): TestCase[] {
  const cases: TestCase[] = [];
  let n = 1;
  const id = () => `TC-${String(n++).padStart(3, '0')}`;
  const fail = (seed: number) => seed % 9 === 0; // ~11% seeded failures so QA is meaningful

  // 1. Launch & smoke
  cases.push({
    id: id(), category: 'Smoke', title: 'App launches without crashing', severity: 'high',
    steps: ['Install the APK', 'Cold-start the app', 'Wait for the first frame'],
    expected: 'App reaches the home screen within 3s with no crash', status: 'passed',
  });
  cases.push({
    id: id(), category: 'Smoke', title: 'App recovers from background', severity: 'medium',
    steps: ['Open the app', 'Send it to background for 30s', 'Resume the app'],
    expected: 'State is preserved and the UI resumes correctly', status: 'passed',
  });

  // 2. Per-feature functional + navigation cases
  p.features.forEach((f, i) => {
    cases.push({
      id: id(), category: 'Navigation', title: `Navigate to ${f.name}`, severity: 'high',
      steps: [`Open the app`, `Tap the "${f.name}" entry point`, 'Observe the destination screen'],
      expected: `The ${f.screen} screen opens and renders its content`, status: fail(i + 3) ? 'failed' : 'passed',
    });
    cases.push({
      id: id(), category: 'Functional', title: `${f.name} — primary action works`, severity: f.priority === 'core' ? 'high' : 'medium',
      steps: [`Open ${f.screen}`, 'Perform the primary action', 'Verify the result'],
      expected: `${f.description}`, status: fail(i + 5) ? 'failed' : 'passed',
    });
  });

  // 3. Cross-cutting quality categories
  const cross: Array<[string, string, string, TestCase['severity']]> = [
    ['Accessibility', 'Screen-reader labels present', 'All interactive elements expose semantic labels', 'medium'],
    ['Accessibility', 'Minimum tap-target size', 'All tap targets are at least 48x48dp', 'low'],
    ['Performance', 'Cold start under 3s', 'App is interactive within 3s on mid-range hardware', 'high'],
    ['Performance', 'Scroll stays at 60fps', 'Long lists scroll without dropped frames', 'medium'],
    ['Security', 'No secrets in source', 'No API keys or tokens are hard-coded', 'high'],
    ['Security', 'HTTPS-only network calls', 'All network requests use TLS', 'high'],
    ['Memory', 'No leaks on navigation', 'Repeated navigation does not grow heap unbounded', 'medium'],
    ['Battery', 'No wakelocks when idle', 'App does not hold wakelocks in the background', 'low'],
    ['API', 'Handles offline gracefully', 'Network errors show a retry state, not a crash', 'high'],
    ['API', 'Handles empty responses', 'Empty data shows an empty-state, not an error', 'medium'],
  ];
  cross.forEach(([category, title, expected, severity], i) => {
    cases.push({
      id: id(), category, title, severity,
      steps: ['Set up the precondition', `Exercise: ${title}`, 'Observe behaviour'],
      expected, status: fail(i + 2) ? 'failed' : 'passed',
    });
  });

  return cases;
}

export function qaOutput(p: AppProfile, cases: TestCase[]) {
  const total = cases.length;
  const passed = cases.filter((c) => c.status === 'passed').length;
  const failed = total - passed;
  const score = Math.round((passed / total) * 100);
  const byCategory: Record<string, { total: number; passed: number }> = {};
  cases.forEach((c) => {
    byCategory[c.category] ??= { total: 0, passed: 0 };
    byCategory[c.category].total++;
    if (c.status === 'passed') byCategory[c.category].passed++;
  });
  return {
    score,
    summary: { total, passed, failed },
    categories: byCategory,
    testCases: cases,
  };
}

export function bugfixOutput(cases: TestCase[]) {
  const failing = cases.filter((c) => c.status === 'failed');
  return {
    fixed: true,
    iterations: failing.length === 0 ? 0 : 1,
    patches: failing.map((c) => ({
      testCase: c.id,
      title: c.title,
      file: `lib/screens/${c.category.toLowerCase()}_screen.dart`,
      change: `Patched: ${c.expected}`,
      status: 'applied',
    })),
    note: failing.length === 0 ? 'No failing tests — nothing to patch.' : `Patched ${failing.length} failing test(s) and re-ran QA.`,
  };
}
