export interface QaModuleSpec {
  key: string;
  label: string;
  /** Which bug types this module is capable of surfacing (used to bias AI generation). */
  bugTypes: string[];
}

export const QA_MODULES: QaModuleSpec[] = [
  { key: 'functional', label: 'Functional Testing', bugTypes: ['functional'] },
  { key: 'ui_ux', label: 'UI/UX Testing', bugTypes: ['ui'] },
  { key: 'api', label: 'API Testing', bugTypes: ['api'] },
  { key: 'regression', label: 'Regression Testing', bugTypes: ['functional', 'ui'] },
  { key: 'compatibility', label: 'Compatibility Testing', bugTypes: ['compatibility'] },
  { key: 'accessibility', label: 'Accessibility Testing', bugTypes: ['accessibility'] },
  { key: 'security', label: 'Security Testing', bugTypes: ['security'] },
  { key: 'performance', label: 'Performance Testing', bugTypes: ['performance'] },
  { key: 'memory', label: 'Memory Testing', bugTypes: ['memory'] },
  { key: 'battery', label: 'Battery Testing', bugTypes: ['battery'] },
  { key: 'crash_detection', label: 'Crash Detection', bugTypes: ['crash'] },
  { key: 'anr_detection', label: 'ANR Detection', bugTypes: ['anr'] },
  { key: 'monkey', label: 'Monkey Testing', bugTypes: ['functional', 'crash'] },
  { key: 'localization', label: 'Localization Testing', bugTypes: ['ui'] },
  { key: 'network', label: 'Network Testing', bugTypes: ['network'] },
  { key: 'smoke', label: 'Smoke Testing', bugTypes: ['functional'] },
  { key: 'sanity', label: 'Sanity Testing', bugTypes: ['functional'] },
  { key: 'e2e', label: 'End-to-End Testing', bugTypes: ['functional', 'ui', 'api'] },
  { key: 'ai_exploratory', label: 'AI Exploratory Testing', bugTypes: ['functional', 'ui', 'security', 'performance'] },
];

export const QA_MODULE_BY_KEY = new Map(QA_MODULES.map((m) => [m.key, m]));

export const DEFAULT_SMOKE_MODULES = ['smoke', 'functional', 'ui_ux', 'crash_detection'];

const SCREEN_BANK = [
  'Splash', 'Onboarding', 'Login', 'Signup', 'Home', 'Search', 'Product List', 'Product Detail',
  'Cart', 'Checkout', 'Payment', 'Profile', 'Settings', 'Notifications',
];

export function randomScreen(): string {
  return SCREEN_BANK[Math.floor(Math.random() * SCREEN_BANK.length)];
}
