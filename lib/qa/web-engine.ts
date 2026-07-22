import os from 'os';
import { chromium, type Page, type Response as PwResponse } from 'playwright';
import { connectToDatabase } from '@/lib/mongodb/connect';
import { QaTestRun } from '@/lib/mongodb/models/QaTestRun';
import { QaProject } from '@/lib/mongodb/models/QaProject';
import { QaBug } from '@/lib/mongodb/models/QaBug';
import { QaScreenshot } from '@/lib/mongodb/models/QaScreenshot';
import { QaTestCaseResult } from '@/lib/mongodb/models/QaTestCaseResult';
import { sleep, log } from '@/lib/qa/runtime-helpers';
import type { QaBugType, QaSeverity } from '@/lib/types';

const NAV_TIMEOUT_MS = 25000;
const MAX_PAGES = 5;
const PERF_BUDGET_MS = 3000;

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
        screenshotDataUrl = `data:image/png;base64,${buf.toString('base64')}`;
        await QaScreenshot.create({ runId, screenName: url, testStep: 'Page load', imageDataUrl: screenshotDataUrl });
      } catch {
        await log(runId, 'automation', 'warn', `Could not capture a screenshot for ${url}.`);
      }

      const checks = runChecksForModules(run.modules, obs);
      for (const check of checks) {
        totalCases += 1;
        const failedStepNumber = check.result === 'fail' ? 1 : null;

        const caseDoc = await QaTestCaseResult.create({
          runId, testCaseId: check.testCaseId, name: check.name, module: check.module, screen: url, result: check.result, failedStepNumber,
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
    }

    await context.close();
  } catch (e) {
    await log(runId, 'error', 'error', `Execution error: ${(e as Error).message}`);
  } finally {
    await browser.close();
  }

  const criticalOrHigh = severityCounts.critical + severityCounts.high;
  const avgLoadMs = loadTimes.length > 0 ? loadTimes.reduce((a, b) => a + b, 0) / loadTimes.length : 0;
  const performanceScore = Math.max(20, Math.round(100 - Math.min(70, avgLoadMs / 60) - criticalOrHigh * 8));

  run.status = criticalOrHigh > 0 ? 'failed' : failedCases > 0 ? 'partial' : 'passed';
  run.progress = 100;
  run.currentStep = 'Completed';
  run.currentCase = null;
  run.totalCases = totalCases;
  run.passedCases = passedCases;
  run.failedCases = failedCases;
  run.performanceScore = performanceScore;
  run.completedAt = new Date();
  await run.save();

  await log(runId, 'automation', 'info', `Run completed: ${run.status.toUpperCase()} — ${passedCases}/${totalCases} checks passed across ${visited.size} page(s), avg load ${Math.round(avgLoadMs)}ms.`);
}
