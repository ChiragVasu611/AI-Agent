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

/**
 * NOTE: `randomScreen()` and its bank of invented screen names were removed
 * along with the simulated engine. Screen names now come only from the live
 * target — the resolved activity on Android, or the real URL/title on the web.
 * Nothing in this platform invents the name of a screen it did not observe.
 */
