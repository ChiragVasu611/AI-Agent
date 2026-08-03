import os from 'os';
import { chromium, type Page, type Response as PwResponse } from 'playwright';
import { connectToDatabase } from '@/lib/mongodb/connect';
import { QaTestRun } from '@/lib/mongodb/models/QaTestRun';
import { QaProject } from '@/lib/mongodb/models/QaProject';
import { QaBug } from '@/lib/mongodb/models/QaBug';
import { QaScreenshot } from '@/lib/mongodb/models/QaScreenshot';
import { QaTestCaseResult } from '@/lib/mongodb/models/QaTestCaseResult';
import { sleep, log } from '@/lib/qa/runtime-helpers';
import { onRunCompleted } from '@/lib/issue-boards/sync';
import { evidenceKey, getEvidenceStore, pngSize } from '@/lib/qa/evidence/store';
import type { QaBugType, QaSeverity } from '@/lib/types';

/**
 * Persists a page frame to the evidence store, keeping only metadata in Mongo.
 * Falls back to an inline payload if the store is unavailable — a real captured
 * frame is never discarded just because storage misbehaved.
 */
async function storePageFrame(runId: string, url: string, buf: Buffer): Promise<void> {
  const { randomUUID } = await import('crypto');
  try {
    const store = await getEvidenceStore();
    const key = evidenceKey(runId, 'screenshot', `${Date.now()}-${randomUUID()}.png`);
    const stored = await store.put(key, buf, 'image/png');
    const size = pngSize(buf);
    await QaScreenshot.create({
      runId,
      screenName: url,
      testStep: 'Page load',
      storageKey: stored.key,
      contentType: stored.contentType,
      bytes: stored.bytes,
      sha256: stored.sha256,
      width: size?.width ?? null,
      height: size?.height ?? null,
      imageDataUrl: null,
    });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('QA evidence store write failed; storing frame inline', (e as Error)?.message);
    await QaScreenshot.create({
      runId, screenName: url, testStep: 'Page load',
      imageDataUrl: `data:image/png;base64,${buf.toString('base64')}`,
    });
  }
}

const NAV_TIMEOUT_MS = 25000;
const MAX_PAGES = 12;
const PERF_BUDGET_MS = 3000;
const FUNCTIONAL_MODULES = ['functional', 'smoke', 'sanity', 'e2e', 'regression'];
const GOAL_CTA_RE = /sign\s*up|get\s*started|create\s*account|register|log\s*in|sign\s*in|add\s*to\s*cart|buy\s*now|checkout|subscribe|continue|next|submit|book\s*now|order\s*now|start|try\s*free/i;
const DESTRUCTIVE_RE = /delete|remove|logout|log\s*out|sign\s*out|cancel|deactivate|close\s*account/i;

interface CheckResult {
  testCaseId: string;
  name: string;
  module: string;
  result: 'pass' | 'fail';
  expectedResult: string;
  actualResult: string;
  bugType?: QaBugType;
  severity?: QaSeverity;
  rootCause?: string;
  suggestedFix?: string;
  /** Defect-phrased title used only when the check fails — falls back to `name` if omitted. */
  bugTitle?: string;
}

interface PageObservation {
  url: string;
  status: number | null;
  title: string;
  loadMs: number;
  headers: Record<string, string>;
  consoleErrors: string[];
  pageErrors: string[];
  failedRequests: string[];
  mixedContent: string[];
  hasViewportMeta: boolean;
  htmlLang: string | null;
  imagesMissingAlt: number;
  inputsMissingLabel: number;
  hasHorizontalOverflow: boolean;
  totalBytes: number;
  apiCalls: Array<{ url: string; status: number }>;
}

async function observePage(page: Page, url: string): Promise<PageObservation> {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  const failedRequests: string[] = [];
  const mixedContent: string[] = [];
  const apiCalls: Array<{ url: string; status: number }> = [];
  let totalBytes = 0;

  const onConsole = (msg: { type: () => string; text: () => string }) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  };
  const onPageError = (err: Error) => pageErrors.push(err.message);
  const onRequestFailed = (req: { url: () => string; failure: () => { errorText: string } | null }) => {
    failedRequests.push(`${req.url()} — ${req.failure()?.errorText ?? 'failed'}`);
  };
  const onResponse = async (res: PwResponse) => {
    try {
      const resUrl = res.url();
      const reqUrl = new URL(url);
      if (reqUrl.protocol === 'https:' && resUrl.startsWith('http://')) mixedContent.push(resUrl);
      const resourceType = res.request().resourceType();
      if (resourceType === 'xhr' || resourceType === 'fetch') apiCalls.push({ url: resUrl, status: res.status() });
      const lengthHeader = res.headers()['content-length'];
      if (lengthHeader) totalBytes += Number(lengthHeader) || 0;
    } catch {
      // response may already be gone by the time we read it — ignore
    }
  };

  page.on('console', onConsole);
  page.on('pageerror', onPageError);
  page.on('requestfailed', onRequestFailed);
  page.on('response', onResponse);

  const start = Date.now();
  let response: PwResponse | null = null;
  let navError: string | null = null;
  try {
    response = await page.goto(url, { waitUntil: 'load', timeout: NAV_TIMEOUT_MS });
  } catch (e) {
    navError = (e as Error).message;
  }
  const loadMs = Date.now() - start;
  await sleep(300);

  const domInfo = await page.evaluate(() => {
    const imgs = Array.from(document.querySelectorAll('img'));
    const inputs = Array.from(document.querySelectorAll('input, textarea, select'));
    const missingAlt = imgs.filter((i) => !i.hasAttribute('alt')).length;
    const missingLabel = inputs.filter((el) => {
      const id = el.getAttribute('id');
      const hasLabel = id ? Boolean(document.querySelector(`label[for="${id}"]`)) : false;
      return !hasLabel && !el.hasAttribute('aria-label') && !el.hasAttribute('aria-labelledby');
    }).length;
    return {
      title: document.title,
      hasViewportMeta: Boolean(document.querySelector('meta[name="viewport"]')),
      htmlLang: document.documentElement.getAttribute('lang'),
      imagesMissingAlt: missingAlt,
      inputsMissingLabel: missingLabel,
      hasHorizontalOverflow: document.documentElement.scrollWidth > window.innerWidth + 4,
    };
  }).catch(() => ({
    title: '', hasViewportMeta: false, htmlLang: null, imagesMissingAlt: 0, inputsMissingLabel: 0, hasHorizontalOverflow: false,
  }));

  page.off('console', onConsole);
  page.off('pageerror', onPageError);
  page.off('requestfailed', onRequestFailed);
  page.off('response', onResponse);

  if (navError) pageErrors.unshift(`Navigation error: ${navError}`);

  return {
    url,
    status: response?.status() ?? null,
    title: domInfo.title,
    loadMs,
    headers: response?.headers() ?? {},
    consoleErrors,
    pageErrors,
    failedRequests,
    mixedContent,
    hasViewportMeta: domInfo.hasViewportMeta,
    htmlLang: domInfo.htmlLang,
    imagesMissingAlt: domInfo.imagesMissingAlt,
    inputsMissingLabel: domInfo.inputsMissingLabel,
    hasHorizontalOverflow: domInfo.hasHorizontalOverflow,
    totalBytes,
    apiCalls,
  };
}

function runChecksForModules(modules: string[], obs: PageObservation): CheckResult[] {
  const checks: CheckResult[] = [];
  const has = (m: string) => modules.includes(m);
  let seq = 0;
  const id = () => `TC-web-${obs.url}-${++seq}`;

  if (has('functional') || has('smoke') || has('sanity')) {
    checks.push({
      testCaseId: id(), name: 'Page loads successfully', module: 'Functional Testing',
      result: obs.status != null && obs.status < 400 ? 'pass' : 'fail',
      expectedResult: 'Page responds with a 2xx/3xx HTTP status.',
      actualResult: obs.status != null ? `Received HTTP ${obs.status}.` : 'The page failed to load — no response was received.',
      bugType: 'functional', severity: 'critical',
      bugTitle: obs.status != null ? `Page returns HTTP ${obs.status}` : 'Page failed to load',
      rootCause: 'The server did not return a successful response for this URL.',
      suggestedFix: 'Check server logs for this route and confirm the URL is correct and the backend is healthy.',
    });
    checks.push({
      testCaseId: id(), name: 'Page has a title', module: 'Functional Testing',
      result: obs.title.trim().length > 0 ? 'pass' : 'fail',
      expectedResult: 'The <title> element is non-empty.',
      actualResult: obs.title.trim().length > 0 ? `Title: "${obs.title}".` : 'No <title> content was found.',
      bugType: 'functional', severity: 'low',
      bugTitle: 'Missing or empty page title',
      rootCause: 'The page is missing a <title> tag or it renders empty.',
      suggestedFix: 'Add a descriptive <title> tag for this route — it affects SEO and browser tab identification.',
    });
  }

  if (has('crash_detection') || has('monkey')) {
    checks.push({
      testCaseId: id(), name: 'No uncaught JavaScript errors', module: 'Crash Detection',
      result: obs.pageErrors.length === 0 ? 'pass' : 'fail',
      expectedResult: 'No uncaught exceptions during page load.',
      actualResult: obs.pageErrors.length === 0 ? 'No uncaught exceptions were observed.' : `${obs.pageErrors.length} uncaught exception(s): ${obs.pageErrors.slice(0, 3).join(' | ')}`,
      bugType: 'crash', severity: 'critical',
      bugTitle: 'Uncaught JavaScript exception during page load',
      rootCause: 'An unhandled JavaScript exception was thrown while the page was loading or rendering.',
      suggestedFix: 'Reproduce with browser DevTools open and fix the throwing code path; add error boundaries where applicable.',
    });
  }

  if (has('network')) {
    checks.push({
      testCaseId: id(), name: 'No failed network requests', module: 'Network Testing',
      result: obs.failedRequests.length === 0 ? 'pass' : 'fail',
      expectedResult: 'All requested resources load successfully.',
      actualResult: obs.failedRequests.length === 0 ? 'All observed requests completed.' : `${obs.failedRequests.length} request(s) failed: ${obs.failedRequests.slice(0, 3).join(' | ')}`,
      bugType: 'network', severity: 'medium',
      bugTitle: 'One or more network requests failed to load',
      rootCause: 'One or more network requests (script, stylesheet, image, or API call) failed to complete.',
      suggestedFix: 'Check the failing resource URLs for typos, missing files, or CORS/network issues.',
    });
  }

  if (has('api')) {
    const failedApi = obs.apiCalls.filter((c) => c.status >= 400);
    if (obs.apiCalls.length === 0) {
      checks.push({
        testCaseId: id(), name: 'API calls observed during page load', module: 'API Testing', result: 'pass',
        expectedResult: 'N/A — informational.',
        actualResult: 'No XHR/fetch API calls were observed during this page load.',
      });
    } else {
      checks.push({
        testCaseId: id(), name: 'API calls return successful status codes', module: 'API Testing',
        result: failedApi.length === 0 ? 'pass' : 'fail',
        expectedResult: 'Every observed XHR/fetch call returns a 2xx/3xx status.',
        actualResult: failedApi.length === 0
          ? `All ${obs.apiCalls.length} observed API call(s) returned successful statuses.`
          : `${failedApi.length}/${obs.apiCalls.length} API call(s) failed: ${failedApi.slice(0, 3).map((c) => `${c.url} → ${c.status}`).join(' | ')}`,
        bugType: 'api', severity: 'high',
        bugTitle: 'API call returned an error status',
        rootCause: 'A background API call made by the page returned an error status.',
        suggestedFix: 'Inspect the failing endpoint\'s server-side logs and confirm the request payload/auth are correct.',
      });
    }
  }

  if (has('ui_ux') || has('regression') || has('e2e')) {
    checks.push({
      testCaseId: id(), name: 'No horizontal overflow at viewport width', module: 'UI/UX Testing',
      result: obs.hasHorizontalOverflow ? 'fail' : 'pass',
      expectedResult: 'Page content fits within the viewport width without horizontal scrolling.',
      actualResult: obs.hasHorizontalOverflow ? 'The document is wider than the viewport, causing horizontal scroll.' : 'No horizontal overflow detected.',
      bugType: 'ui', severity: 'medium',
      bugTitle: 'Horizontal overflow at viewport width',
      rootCause: 'An element likely has a fixed width or missing responsive/overflow handling.',
      suggestedFix: 'Audit elements with fixed widths and add responsive (%, max-width, flex/grid) sizing.',
    });
    checks.push({
      testCaseId: id(), name: 'Images have alt text', module: 'UI/UX Testing',
      result: obs.imagesMissingAlt === 0 ? 'pass' : 'fail',
      expectedResult: 'Every <img> has an alt attribute.',
      actualResult: obs.imagesMissingAlt === 0 ? 'All images have alt attributes.' : `${obs.imagesMissingAlt} image(s) are missing an alt attribute.`,
      bugType: 'ui', severity: 'low',
      bugTitle: 'Images missing alt text',
      rootCause: 'Images were added without an alt attribute.',
      suggestedFix: 'Add descriptive alt text to every image (or alt="" for purely decorative images).',
    });
  }

  if (has('accessibility')) {
    checks.push({
      testCaseId: id(), name: 'Form controls have accessible labels', module: 'Accessibility Testing',
      result: obs.inputsMissingLabel === 0 ? 'pass' : 'fail',
      expectedResult: 'Every input/textarea/select has an associated <label>, aria-label, or aria-labelledby.',
      actualResult: obs.inputsMissingLabel === 0 ? 'All form controls have an accessible label.' : `${obs.inputsMissingLabel} form control(s) lack an accessible label.`,
      bugType: 'accessibility', severity: 'medium',
      bugTitle: 'Form controls missing accessible labels',
      rootCause: 'Form controls are missing label association, so screen readers cannot announce their purpose.',
      suggestedFix: 'Add a <label for="..."> or aria-label to each affected control.',
    });
    checks.push({
      testCaseId: id(), name: 'Document language is declared', module: 'Accessibility Testing',
      result: obs.htmlLang ? 'pass' : 'fail',
      expectedResult: '<html> has a lang attribute.',
      actualResult: obs.htmlLang ? `lang="${obs.htmlLang}".` : 'The <html> element has no lang attribute.',
      bugType: 'accessibility', severity: 'low',
      bugTitle: 'Document language not declared',
      rootCause: 'The document does not declare its language.',
      suggestedFix: 'Add lang="en" (or the appropriate locale) to the <html> tag.',
    });
  }

  if (has('security')) {
    const isHttps = obs.url.startsWith('https://');
    checks.push({
      testCaseId: id(), name: 'Page is served over HTTPS', module: 'Security Testing',
      result: isHttps ? 'pass' : 'fail',
      expectedResult: 'The page is served over HTTPS.',
      actualResult: isHttps ? 'Served over HTTPS.' : 'The page was served over plain HTTP.',
      bugType: 'security', severity: 'critical',
      bugTitle: 'Page served over plain HTTP',
      rootCause: 'The site does not enforce HTTPS.',
      suggestedFix: 'Configure TLS and redirect all HTTP traffic to HTTPS.',
    });
    checks.push({
      testCaseId: id(), name: 'No mixed content', module: 'Security Testing',
      result: obs.mixedContent.length === 0 ? 'pass' : 'fail',
      expectedResult: 'An HTTPS page loads no resources over plain HTTP.',
      actualResult: obs.mixedContent.length === 0 ? 'No mixed content detected.' : `${obs.mixedContent.length} resource(s) loaded over HTTP on an HTTPS page: ${obs.mixedContent.slice(0, 3).join(' | ')}`,
      bugType: 'security', severity: 'high',
      bugTitle: 'Mixed content loaded on an HTTPS page',
      rootCause: 'One or more sub-resources are hardcoded to an http:// URL.',
      suggestedFix: 'Update the affected resource URLs to https:// or protocol-relative URLs.',
    });
    const hsts = obs.headers['strict-transport-security'];
    checks.push({
      testCaseId: id(), name: 'Strict-Transport-Security header present', module: 'Security Testing',
      result: hsts ? 'pass' : 'fail',
      expectedResult: 'Response includes a Strict-Transport-Security header.',
      actualResult: hsts ? `Header present: ${hsts}` : 'No Strict-Transport-Security header was returned.',
      bugType: 'security', severity: 'medium',
      bugTitle: 'Missing Strict-Transport-Security header',
      rootCause: 'The server response does not include an HSTS header.',
      suggestedFix: 'Add a Strict-Transport-Security header at the web server/CDN level.',
    });
  }

  if (has('performance')) {
    checks.push({
      testCaseId: id(), name: `Page loads within ${PERF_BUDGET_MS}ms`, module: 'Performance Testing',
      result: obs.loadMs <= PERF_BUDGET_MS ? 'pass' : 'fail',
      expectedResult: `Load event fires within ${PERF_BUDGET_MS}ms.`,
      actualResult: `Measured load time: ${obs.loadMs}ms.`,
      bugType: 'performance', severity: obs.loadMs > PERF_BUDGET_MS * 2 ? 'high' : 'medium',
      bugTitle: `Page load exceeds the ${PERF_BUDGET_MS}ms budget`,
      rootCause: 'The page took longer than the performance budget to finish loading.',
      suggestedFix: 'Profile the network waterfall for large/slow resources and consider lazy-loading, compression, or a CDN.',
    });
  }

  return checks;
}

/**
 * Active functional testing: actually exercises the page like a user —
 * inventories interactive controls, fills & validates forms, and clicks the
 * primary goal/CTA — verifying the app *works*, not just that it loaded.
 * Every interaction is defensive (try/catch + short timeouts) and skips
 * destructive controls (delete/logout/etc.).
 */
async function runInteractionChecks(page: Page, url: string): Promise<CheckResult[]> {
  const checks: CheckResult[] = [];
  let seq = 0;
  const id = () => `TC-webfn-${url}-${++seq}`;

  // Capture any runtime error thrown while we interact.
  const interactionErrors: string[] = [];
  const onErr = (e: Error) => interactionErrors.push(e.message);
  page.on('pageerror', onErr);

  // Inventory the interactive surface.
  const inv = await page.evaluate(() => {
    const q = (sel: string) => document.querySelectorAll(sel).length;
    return {
      buttons: q('button, [role="button"], input[type="submit"], input[type="button"]'),
      links: q('a[href]'),
      inputs: q('input:not([type="hidden"]), textarea, select'),
      forms: q('form'),
      nav: q('nav, [role="navigation"], header a[href]'),
    };
  }).catch(() => ({ buttons: 0, links: 0, inputs: 0, forms: 0, nav: 0 }));

  const actionable = inv.buttons + inv.links + inv.inputs;
  checks.push({
    testCaseId: id(), name: 'Page exposes interactive controls', module: 'Functional Testing',
    result: actionable > 0 ? 'pass' : 'fail',
    expectedResult: 'The page provides usable controls (buttons, links or inputs) for the user.',
    actualResult: `Found ${inv.buttons} button(s), ${inv.links} link(s), ${inv.inputs} input(s), ${inv.forms} form(s).`,
    bugType: 'functional', severity: 'high',
    bugTitle: 'Page has no interactive controls',
    rootCause: 'The rendered page contains no buttons, links, or form inputs — it may be a dead/blank render or a hydration failure.',
    suggestedFix: 'Confirm the page renders its interactive UI (check client-side hydration and that content is not blocked).',
  });

  checks.push({
    testCaseId: id(), name: 'Primary navigation is present', module: 'Functional Testing',
    result: inv.nav > 0 ? 'pass' : 'fail',
    expectedResult: 'A navigation region or header links let the user move through the app.',
    actualResult: inv.nav > 0 ? `Found ${inv.nav} navigation link(s)/region(s).` : 'No <nav>, role="navigation", or header links were found.',
    bugType: 'ui', severity: 'medium',
    bugTitle: 'No navigation region detected',
    rootCause: 'The page does not expose a navigation region or header links.',
    suggestedFix: 'Provide a clear navigation region so users can reach the app\'s main sections.',
  });

  // Form functionality — fill the first form with valid test data and validate it.
  if (inv.forms > 0 && inv.inputs > 0) {
    try {
      const formResult = await page.evaluate(() => {
        const form = document.querySelector('form');
        if (!form) return { filled: 0, hasSubmit: false, valid: false };
        const fields = Array.from(form.querySelectorAll('input, textarea, select')) as Array<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>;
        let filled = 0;
        for (const el of fields) {
          const type = (el.getAttribute('type') || '').toLowerCase();
          if (['hidden', 'submit', 'button', 'reset', 'file'].includes(type)) continue;
          let value = 'Test';
          if (type === 'email') value = 'qa.tester@example.com';
          else if (type === 'password') value = 'Passw0rd!23';
          else if (type === 'tel') value = '5551234567';
          else if (type === 'number') value = '42';
          else if (type === 'url') value = 'https://example.com';
          else if (type === 'checkbox' || type === 'radio') { (el as HTMLInputElement).checked = true; filled++; el.dispatchEvent(new Event('change', { bubbles: true })); continue; }
          (el as HTMLInputElement).value = value;
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
          filled++;
        }
        const hasSubmit = Boolean(form.querySelector('button[type="submit"], input[type="submit"], button:not([type])'));
        const valid = typeof form.checkValidity === 'function' ? form.checkValidity() : true;
        return { filled, hasSubmit, valid };
      });
      const ok = formResult.filled > 0 && formResult.hasSubmit && formResult.valid;
      checks.push({
        testCaseId: id(), name: 'Primary form accepts input and validates', module: 'Functional Testing',
        result: ok ? 'pass' : 'fail',
        expectedResult: 'The main form accepts valid test data, has a submit control, and passes client-side validation.',
        actualResult: `Filled ${formResult.filled} field(s); submit control ${formResult.hasSubmit ? 'present' : 'MISSING'}; validation ${formResult.valid ? 'passed' : 'FAILED with valid test data'}.`,
        bugType: 'functional', severity: 'high',
        bugTitle: 'Primary form is not functional',
        rootCause: 'The form is missing a submit control or rejects otherwise-valid input, so users cannot complete it.',
        suggestedFix: 'Ensure the form has a submit button and that its validation accepts correctly-formatted input.',
      });
    } catch (e) {
      checks.push({
        testCaseId: id(), name: 'Primary form accepts input and validates', module: 'Functional Testing',
        result: 'fail',
        expectedResult: 'The main form can be filled and validated.',
        actualResult: `Interacting with the form threw an error: ${(e as Error).message}`,
        bugType: 'functional', severity: 'high',
        bugTitle: 'Form interaction throws an error',
        rootCause: 'An exception was thrown while filling the form.',
        suggestedFix: 'Check the form field event handlers for errors.',
      });
    }
  }

  // Goal / CTA reachability — find the primary call-to-action and exercise it.
  let goalActioned = false;
  try {
    const cta = page.getByRole('link', { name: GOAL_CTA_RE }).or(page.getByRole('button', { name: GOAL_CTA_RE })).first();
    const ctaCount = await cta.count();
    if (ctaCount > 0) {
      const label = ((await cta.textContent().catch(() => '')) || '').trim().slice(0, 40);
      const enabled = await cta.isEnabled().catch(() => false);
      const destructive = DESTRUCTIVE_RE.test(label);
      if (enabled && !destructive) {
        await cta.click({ timeout: 4000 }).catch(() => { /* click may navigate/detach */ });
        await sleep(1200);
        goalActioned = true;
      }
      checks.push({
        testCaseId: id(), name: 'Primary user goal (CTA) is actionable', module: 'E2E Testing',
        result: enabled ? 'pass' : 'fail',
        expectedResult: 'A prominent call-to-action (sign up, add to cart, checkout, submit, …) is present and clickable.',
        actualResult: enabled ? `CTA "${label}" is present and was exercised without a crash.` : `CTA "${label}" is present but disabled.`,
        bugType: 'functional', severity: 'high',
        bugTitle: 'Primary call-to-action is not actionable',
        rootCause: 'The main user-goal control is disabled or cannot be interacted with.',
        suggestedFix: 'Ensure the primary CTA is enabled and wired to its intended action.',
      });
    } else {
      checks.push({
        testCaseId: id(), name: 'Primary user goal (CTA) is actionable', module: 'E2E Testing',
        result: 'pass',
        expectedResult: 'A recognizable call-to-action drives the primary user goal.',
        actualResult: 'No standard call-to-action text was detected on this page (informational).',
      });
    }
  } catch {
    // getByRole/count can throw on navigation — treat as non-fatal.
  }

  await sleep(300);
  page.off('pageerror', onErr);

  // Interaction stability — did our clicks/typing surface any runtime errors?
  checks.push({
    testCaseId: id(), name: 'No runtime errors during user interaction', module: 'Functional Testing',
    result: interactionErrors.length === 0 ? 'pass' : 'fail',
    expectedResult: 'Interacting with the page (typing, clicking the CTA) raises no uncaught exceptions.',
    actualResult: interactionErrors.length === 0
      ? `Interactions completed cleanly${goalActioned ? ' (CTA exercised)' : ''}.`
      : `${interactionErrors.length} error(s) during interaction: ${interactionErrors.slice(0, 3).join(' | ')}`,
    bugType: 'crash', severity: 'high',
    bugTitle: 'Uncaught error triggered by user interaction',
    rootCause: 'A user interaction (input or click) triggered an unhandled JavaScript exception.',
    suggestedFix: 'Reproduce the interaction with DevTools open and fix the throwing handler.',
  });

  return checks;
}

export async function runWebTestExecution(runId: string) {
  await connectToDatabase();

  const run = await QaTestRun.findById(runId);
  if (!run) return;
  const project = await QaProject.findById(run.projectId).lean();
  if (!project) return;

  const targetUrl = (project as any).sourceRef as string;
  run.status = 'running';
  run.engineMode = 'real_browser';
  run.startedAt = new Date();
  await run.save();

  await log(runId, 'automation', 'info', `Launching a real headless Chromium browser to test ${targetUrl}.`);

  let browser;
  try {
    browser = await chromium.launch({ headless: true });
  } catch (e) {
    run.status = 'failed';
    run.errorMessage = `Could not launch the browser engine: ${(e as Error).message}`;
    run.completedAt = new Date();
    await run.save();
    await log(runId, 'error', 'error', run.errorMessage);
    await onRunCompleted(runId);
    return;
  }

  run.currentDevice = `Chromium ${browser.version()} (headless, real browser)`;
  await run.save();

  let totalCases = 0;
  let passedCases = 0;
  let failedCases = 0;
  let bugSeq = 0;
  const severityCounts: Record<string, number> = { critical: 0, high: 0, medium: 0, low: 0 };
  const loadTimes: number[] = [];
  const visited = new Set<string>();
  const queue: string[] = [targetUrl];
  const osInfo = `${os.type()} ${os.release()}`;

  try {
    const context = await browser.newContext({ viewport: { width: 1366, height: 900 } });
    const page = await context.newPage();

    while (queue.length > 0 && visited.size < MAX_PAGES) {
      const url = queue.shift()!;
      if (visited.has(url)) continue;
      visited.add(url);

      run.currentScreen = url;
      run.currentStep = 'Loading page';
      run.currentSuite = 'Web Execution';
      run.currentFeature = new URL(url).pathname || '/';
      run.progress = Math.round((visited.size / MAX_PAGES) * 90);
      await run.save();
      await log(runId, 'automation', 'info', `Navigating to ${url}...`);

      const obs = await observePage(page, url);
      loadTimes.push(obs.loadMs);

      if (obs.status == null) {
        await log(runId, 'error', 'error', `Failed to load ${url}: navigation error.`);
      } else {
        await log(runId, 'automation', 'info', `Loaded ${url} — HTTP ${obs.status} in ${obs.loadMs}ms.`);
      }
      obs.consoleErrors.forEach((msg) => log(runId, 'error', 'error', `[console] ${msg}`));
      obs.pageErrors.forEach((msg) => log(runId, 'crash', 'error', `[uncaught] ${msg}`));
      obs.failedRequests.forEach((msg) => log(runId, 'api', 'warn', `[request failed] ${msg}`));

      let screenshotDataUrl: string | null = null;
      try {
        const buf = await page.screenshot({ type: 'png' });
        // Bugs embed their own evidence image, so the data URL is still produced
        // for that; the gallery frame itself goes to the evidence store.
        screenshotDataUrl = `data:image/png;base64,${buf.toString('base64')}`;
        await storePageFrame(runId, url, buf);
      } catch {
        await log(runId, 'automation', 'warn', `Could not capture a screenshot for ${url}.`);
      }

      // Discover internal links BEFORE interacting — interactions can navigate away.
      if (visited.size < MAX_PAGES) {
        try {
          const links: string[] = await page.evaluate((origin: string) => Array.from(document.querySelectorAll('a[href]'))
            .map((a) => (a as HTMLAnchorElement).href)
            .filter((href) => href.startsWith(origin)), new URL(url).origin);
          for (const link of links) {
            const clean = link.split('#')[0];
            if (!visited.has(clean) && !queue.includes(clean) && clean !== url) queue.push(clean);
            if (queue.length + visited.size >= MAX_PAGES * 2) break;
          }
        } catch {
          // link discovery is best-effort
        }
      }

      const wantsFunctional = run.modules.some((m: string) => FUNCTIONAL_MODULES.includes(m));
      run.currentStep = wantsFunctional ? 'Running functional interactions' : 'Analyzing page';
      await run.save();
      const staticChecks = runChecksForModules(run.modules, obs);
      const interactionChecks = wantsFunctional ? await runInteractionChecks(page, url) : [];
      const checks = [...staticChecks, ...interactionChecks];
      for (const check of checks) {
        totalCases += 1;
        const failedStepNumber = check.result === 'fail' ? 1 : null;

        const caseDoc = await QaTestCaseResult.create({
          runId, testCaseId: check.testCaseId, name: check.name, module: check.module, screen: url, result: check.result,
          expectedResult: check.expectedResult, actualResult: check.actualResult, failedStepNumber,
        });

        if (check.result === 'pass') {
          passedCases += 1;
        } else {
          failedCases += 1;
          const severity = check.severity ?? 'medium';
          bugSeq += 1;
          const bugNumber = `BUG-${run.runNumber}-${String(bugSeq).padStart(3, '0')}`;

          const bug = await QaBug.create({
            userId: run.userId,
            projectId: run.projectId,
            runId,
            type: check.bugType ?? 'functional',
            module: check.module,
            feature: check.module,
            severity,
            priority: severity === 'critical' || severity === 'high' ? 'p1' : severity === 'medium' ? 'p2' : 'p3',
            bugNumber,
            testCaseId: check.testCaseId,
            failedStepNumber,
            title: check.bugTitle ?? check.name,
            description: `Automated real-browser check against ${url}.`,
            screenName: url,
            stepsToReproduce: [`Open ${url} in a browser`, `Observe: ${check.name}`],
            expectedResult: check.expectedResult,
            actualResult: check.actualResult,
            screenshotDataUrl,
            logs: [...obs.consoleErrors, ...obs.pageErrors, ...obs.failedRequests].join('\n') || 'No additional console/network output captured.',
            stackTrace: obs.pageErrors[0] ?? null,
            apiRequest: check.module === 'API Testing' ? url : null,
            apiResponse: check.module === 'API Testing' ? JSON.stringify(obs.apiCalls.slice(0, 5)) : null,
            deviceInfo: run.currentDevice,
            osVersion: osInfo,
            appVersion: run.buildVersion,
            aiRootCause: check.rootCause ?? 'See actual result for details.',
            suggestedFix: check.suggestedFix ?? 'Investigate the observed behavior directly.',
          });

          await QaTestCaseResult.findByIdAndUpdate(caseDoc._id, { bugId: bug._id });
          severityCounts[severity] += 1;
          await log(runId, 'error', 'error', `[${check.module}] FAILED: ${check.name} — bug ${bugNumber} created.`);
        }
      }
    }

    await context.close();
  } catch (e) {
    await log(runId, 'error', 'error', `Execution error: ${(e as Error).message}`);
  } finally {
    await browser.close();
  }

  const criticalOrHigh = severityCounts.critical + severityCounts.high;
  const avgLoadMs = loadTimes.length > 0 ? loadTimes.reduce((a, b) => a + b, 0) / loadTimes.length : 0;

  // Did the run actually exercise the site? A target that never loaded produces
  // no checks and therefore no bugs, and "no bugs" must never be reported as a
  // pass — that is indistinguishable from a genuinely clean run.
  const exercised = visited.size > 0 && totalCases > 0;

  // A score is only computed from real measurements. With no page loads there is
  // no latency to score, and a formula fed zeros would publish a perfect 100.
  const performanceScore = exercised && loadTimes.length > 0
    ? Math.max(20, Math.round(100 - Math.min(70, avgLoadMs / 60) - criticalOrHigh * 8))
    : null;

  run.status = !exercised
    ? 'failed'
    : criticalOrHigh > 0 ? 'failed' : failedCases > 0 ? 'partial' : 'passed';
  run.progress = 100;
  run.currentStep = exercised ? 'Completed' : 'Could not test the site';
  run.currentCase = null;
  run.totalCases = totalCases;
  run.passedCases = passedCases;
  run.failedCases = failedCases;
  run.performanceScore = performanceScore;
  if (!exercised) {
    run.errorMessage =
      `Run did not exercise the site: ${visited.size} page(s) loaded and ${totalCases} check(s) executed. `
      + 'No result is reported because nothing was measured.';
  }
  run.completedAt = new Date();
  await run.save();

  if (!exercised) {
    await log(runId, 'error', 'error', `RUN NOT VALID — ${run.errorMessage}`);
  }
  await log(runId, 'automation', 'info',
    `Run completed: ${run.status.toUpperCase()} — ${passedCases}/${totalCases} checks passed across ${visited.size} page(s)`
    + `${loadTimes.length > 0 ? `, avg load ${Math.round(avgLoadMs)}ms` : ', no page load timing captured'}.`);
  await onRunCompleted(runId);
}
