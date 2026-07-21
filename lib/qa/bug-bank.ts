import type { QaBugType, QaPriority, QaSeverity } from '@/lib/types';

export interface BugTemplate {
  type: QaBugType;
  severity: QaSeverity;
  priority: QaPriority;
  title: string;
  description: string;
  expectedResult: string;
  actualResult: string;
  aiRootCause: string;
  suggestedFix: string;
  stackTrace?: string;
}

const TEMPLATES: Record<QaBugType, BugTemplate[]> = {
  functional: [
    {
      type: 'functional', severity: 'high', priority: 'p2',
      title: 'Submit button does not trigger action on {screen}',
      description: 'Tapping the primary submit control on {screen} does not invoke the expected action.',
      expectedResult: 'Form submits and user is navigated to the next step.',
      actualResult: 'Button appears to respond visually but no navigation or API call occurs.',
      aiRootCause: 'Likely a missing or unbound onClick/onPress handler after a recent refactor of the screen component.',
      suggestedFix: 'Verify the event handler is wired to the button and that form validation is not silently short-circuiting submission.',
    },
    {
      type: 'functional', severity: 'medium', priority: 'p3',
      title: 'Incorrect validation message on {screen}',
      description: 'A required-field validation message shows the wrong field name.',
      expectedResult: 'Validation error references the actual invalid field.',
      actualResult: 'Error message references an unrelated field.',
      aiRootCause: 'Validation error strings are likely hardcoded rather than derived from the field schema.',
      suggestedFix: 'Bind validation messages to the field metadata instead of static strings.',
    },
  ],
  ui: [
    {
      type: 'ui', severity: 'low', priority: 'p4',
      title: 'Text overflow on {screen}',
      description: 'Long labels overflow their container without truncation or wrapping on {screen}.',
      expectedResult: 'Text truncates with ellipsis or wraps within its container.',
      actualResult: 'Text overflows and overlaps adjacent UI elements.',
      aiRootCause: 'Container likely lacks a max-width or text-overflow style for longer locale strings.',
      suggestedFix: 'Apply text truncation/wrapping styles and test with longer sample strings.',
    },
    {
      type: 'ui', severity: 'medium', priority: 'p3',
      title: 'Misaligned layout on {screen} at smaller screen widths',
      description: 'Elements on {screen} overlap when viewed on smaller device widths.',
      expectedResult: 'Layout reflows responsively without overlapping elements.',
      actualResult: 'Fixed-width elements overlap on narrower viewports.',
      aiRootCause: 'Layout likely uses fixed pixel widths instead of responsive/flex units.',
      suggestedFix: 'Convert fixed-width containers to flexible/responsive units and add breakpoint testing.',
    },
  ],
  api: [
    {
      type: 'api', severity: 'high', priority: 'p2',
      title: 'API returns 500 on {screen} data fetch',
      description: 'The endpoint backing {screen} intermittently returns a server error.',
      expectedResult: 'API returns 200 with the expected payload.',
      actualResult: 'API returns HTTP 500 under certain conditions.',
      aiRootCause: 'Likely an unhandled exception server-side when a query parameter is missing or malformed.',
      suggestedFix: 'Add input validation and error handling on the endpoint; return a 4xx for bad input instead of throwing.',
      stackTrace: 'Error: Unexpected token in JSON at position 0\n    at parseResponse (client.js:142)',
    },
  ],
  security: [
    {
      type: 'security', severity: 'critical', priority: 'p1',
      title: 'Sensitive data exposed in {screen} network response',
      description: 'The API response backing {screen} includes fields that should not be exposed to the client (e.g. internal IDs, tokens).',
      expectedResult: 'Response payload excludes internal/sensitive fields.',
      actualResult: 'Response includes unredacted internal fields.',
      aiRootCause: 'Serializer likely returns the full database document instead of a sanitized DTO.',
      suggestedFix: 'Introduce an explicit response serializer that allow-lists exposed fields.',
    },
  ],
  performance: [
    {
      type: 'performance', severity: 'medium', priority: 'p3',
      title: 'Slow render on {screen}',
      description: '{screen} takes noticeably longer than target to become interactive.',
      expectedResult: 'Screen is interactive within 1-2 seconds.',
      actualResult: 'Screen takes 4+ seconds to become interactive under test conditions.',
      aiRootCause: 'Likely an unoptimized list render or a blocking synchronous call on mount.',
      suggestedFix: 'Profile the mount phase, virtualize long lists, and move blocking work off the main thread.',
    },
  ],
  memory: [
    {
      type: 'memory', severity: 'medium', priority: 'p3',
      title: 'Memory usage climbs after repeated navigation to {screen}',
      description: 'Navigating to and from {screen} repeatedly increases memory usage without returning to baseline.',
      expectedResult: 'Memory returns close to baseline after leaving the screen.',
      actualResult: 'Memory usage trends upward across repeated visits, suggesting a leak.',
      aiRootCause: 'Likely a subscription, timer, or listener not cleaned up on unmount.',
      suggestedFix: 'Audit the screen for event listeners/timers/subscriptions and ensure cleanup in the unmount lifecycle.',
    },
  ],
  battery: [
    {
      type: 'battery', severity: 'low', priority: 'p4',
      title: 'Elevated battery drain while on {screen}',
      description: 'Background activity while {screen} is open drains battery faster than expected.',
      expectedResult: 'Battery drain rate stays within the baseline for idle screens.',
      actualResult: 'Battery drain rate is measurably above baseline.',
      aiRootCause: 'Likely an overly frequent polling interval or an active location/sensor subscription while idle.',
      suggestedFix: 'Reduce polling frequency and release sensor subscriptions when the screen loses focus.',
    },
  ],
  network: [
    {
      type: 'network', severity: 'medium', priority: 'p3',
      title: '{screen} does not handle offline state gracefully',
      description: 'When network connectivity drops while on {screen}, no offline indicator or retry option is shown.',
      expectedResult: 'An offline banner and retry action are shown when connectivity is lost.',
      actualResult: 'Screen appears frozen with no indication of the connectivity issue.',
      aiRootCause: 'Likely missing a network-state listener and offline UI state.',
      suggestedFix: 'Add a connectivity listener and a reusable offline banner/retry component.',
    },
  ],
  accessibility: [
    {
      type: 'accessibility', severity: 'medium', priority: 'p3',
      title: 'Missing accessibility labels on {screen}',
      description: 'Interactive controls on {screen} lack accessible names, so they are announced as generic "button" to screen readers.',
      expectedResult: 'Screen reader announces a meaningful label for each control.',
      actualResult: 'Screen reader announces generic or blank labels.',
      aiRootCause: 'Controls likely lack an accessibilityLabel/aria-label attribute.',
      suggestedFix: 'Add descriptive accessibility labels to all interactive elements on the screen.',
    },
  ],
  compatibility: [
    {
      type: 'compatibility', severity: 'medium', priority: 'p3',
      title: '{screen} renders incorrectly on older OS versions',
      description: 'A layout or API used on {screen} is not supported on older OS versions in the compatibility matrix.',
      expectedResult: 'Screen renders consistently across all supported OS versions.',
      actualResult: 'Layout breaks or a feature silently fails on the oldest supported OS version.',
      aiRootCause: 'Likely use of a newer platform API without a fallback/polyfill for older OS versions.',
      suggestedFix: 'Add a feature-detection fallback or raise the minimum supported OS version if the API is essential.',
    },
  ],
  crash: [
    {
      type: 'crash', severity: 'critical', priority: 'p1',
      title: 'App crashes when navigating to {screen}',
      description: 'The app terminates unexpectedly when navigating to {screen} under certain data conditions.',
      expectedResult: 'Screen loads without crashing regardless of data state.',
      actualResult: 'App crashes and closes.',
      aiRootCause: 'Likely a null/undefined dereference when expected data is missing or the response shape changed.',
      suggestedFix: 'Add null-safety checks and a defensive default state before rendering dependent UI.',
      stackTrace: 'FATAL EXCEPTION: main\nProcess: com.example.app, PID: 4821\njava.lang.NullPointerException: Attempt to invoke virtual method on a null object reference\n    at com.example.app.ui.ScreenController.render(ScreenController.java:88)',
    },
  ],
  anr: [
    {
      type: 'anr', severity: 'high', priority: 'p1',
      title: 'ANR triggered on {screen}',
      description: 'The app becomes unresponsive for several seconds while {screen} is loading.',
      expectedResult: 'UI thread remains responsive during data loading.',
      actualResult: 'App shows "Application Not Responding" after a long synchronous operation.',
      aiRootCause: 'Likely a blocking I/O or heavy computation running on the main/UI thread.',
      suggestedFix: 'Move the blocking operation to a background thread/worker and show a loading state on the UI thread.',
    },
  ],
};

export function fallbackBug(type: QaBugType, screenName: string, module: string): BugTemplate & { screenName: string; module: string } {
  const bank = TEMPLATES[type] ?? TEMPLATES.functional;
  const template = bank[Math.floor(Math.random() * bank.length)];
  const fill = (s: string) => s.replace(/\{screen\}/g, screenName);
  return {
    ...template,
    title: fill(template.title),
    description: fill(template.description),
    screenName,
    module,
  };
}
