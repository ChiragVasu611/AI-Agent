/**
 * Executes an interpreted test step against a REAL Chromium page via Playwright.
 *
 * Nothing here simulates. Every action is a genuine browser interaction and every
 * reported outcome describes what actually happened — including the failure text
 * when an element could not be found or an interaction threw.
 */

import { chromium, type Browser, type BrowserContext, type Page, type Response as PwResponse } from 'playwright';
import type { StepAction } from '@/lib/qa/step-interpreter';
import type { PageSignals } from '@/lib/qa/expectation-validator';

const ACTION_TIMEOUT_MS = 8000;
const NAV_TIMEOUT_MS = 25000;
const VIEWPORT = { width: 1366, height: 900 };

export interface ExecutionSession {
  browser: Browser;
  context: BrowserContext;
  page: Page;
  /** Signals accumulated since the last resetSignals() call. */
  signals: PageSignals;
  resetSignals(): void;
  close(): Promise<void>;
}

export interface StepExecutionResult {
  ok: boolean;
  /** Description of what the engine actually did or why it could not act. */
  detail: string;
}

export async function createExecutionSession(startUrl: string): Promise<ExecutionSession> {
  const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const context = await browser.newContext({ viewport: VIEWPORT, acceptDownloads: true });
  const page = await context.newPage();

  const signals: PageSignals = {
    consoleErrors: [], pageErrors: [], failedRequests: [], apiCalls: [], downloads: [], dialogs: [], urlBefore: startUrl,
  };

  page.on('console', (msg) => { if (msg.type() === 'error') signals.consoleErrors.push(msg.text()); });
  page.on('pageerror', (err) => signals.pageErrors.push(err.message));
  page.on('requestfailed', (req) => signals.failedRequests.push(`${req.url()} — ${req.failure()?.errorText ?? 'failed'}`));
  page.on('download', (d) => signals.downloads.push(d.suggestedFilename()));
  // Auto-dismiss native dialogs so execution never hangs, but record that they fired.
  page.on('dialog', async (d) => {
    signals.dialogs.push(`${d.type()}: ${d.message()}`);
    await d.dismiss().catch(() => {});
  });
  page.on('response', (res: PwResponse) => {
    try {
      const rt = res.request().resourceType();
      if (rt === 'xhr' || rt === 'fetch') {
        const timing = res.request().timing();
        signals.apiCalls.push({ url: res.url(), status: res.status(), ms: Math.max(0, Math.round(timing.responseEnd - timing.requestStart)) });
      }
    } catch {
      // response can be collected before we read it — not an execution failure
    }
  });

  page.setDefaultTimeout(ACTION_TIMEOUT_MS);

  return {
    browser,
    context,
    page,
    signals,
    resetSignals() {
      signals.consoleErrors.length = 0;
      signals.pageErrors.length = 0;
      signals.failedRequests.length = 0;
      signals.apiCalls.length = 0;
      signals.downloads.length = 0;
      signals.dialogs.length = 0;
      signals.urlBefore = page.url();
    },
    async close() {
      await context.close().catch(() => {});
      await browser.close().catch(() => {});
    },
  };
}

/**
 * Resolve a human label ("Login", "email") to a real element, trying the
 * strategies a human would: role/name, label, placeholder, visible text, then
 * common attribute conventions. Returns null when nothing matches — the caller
 * reports that as a real failure rather than assuming success.
 */
async function resolve(page: Page, target: string, forInput: boolean): Promise<{ locator: import('playwright').Locator; how: string } | null> {
  const t = target.trim();
  if (!t) return null;

  const candidates: Array<{ locator: import('playwright').Locator; how: string }> = forInput
    ? [
      { locator: page.getByLabel(t, { exact: false }), how: 'label' },
      { locator: page.getByPlaceholder(t, { exact: false }), how: 'placeholder' },
      { locator: page.getByRole('textbox', { name: new RegExp(escapeRe(t), 'i') }), how: 'role=textbox' },
      { locator: page.locator(`input[name*="${cssEscape(t)}" i], textarea[name*="${cssEscape(t)}" i]`), how: 'name attribute' },
      { locator: page.locator(`input[id*="${cssEscape(t)}" i], textarea[id*="${cssEscape(t)}" i]`), how: 'id attribute' },
      { locator: page.locator(`input[type="${cssEscape(t.toLowerCase())}"]`), how: 'input type' },
    ]
    : [
      { locator: page.getByRole('button', { name: new RegExp(escapeRe(t), 'i') }), how: 'role=button' },
      { locator: page.getByRole('link', { name: new RegExp(escapeRe(t), 'i') }), how: 'role=link' },
      { locator: page.getByTestId(t), how: 'test id' },
      { locator: page.getByText(t, { exact: false }), how: 'visible text' },
      { locator: page.getByLabel(t, { exact: false }), how: 'label' },
      { locator: page.locator(`[aria-label*="${cssEscape(t)}" i]`), how: 'aria-label' },
      { locator: page.locator(`[name*="${cssEscape(t)}" i], [id*="${cssEscape(t)}" i]`), how: 'name/id attribute' },
    ];

  for (const c of candidates) {
    try {
      const first = c.locator.first();
      if (await first.isVisible({ timeout: 1200 })) return { locator: first, how: c.how };
    } catch {
      // strategy did not match — try the next one
    }
  }
  return null;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function cssEscape(s: string): string {
  return s.replace(/["\\]/g, '\\$&');
}

/** Absolute URL for a step that named a path or a bare host. */
function resolveUrl(value: string, baseUrl: string): string {
  if (/^https?:\/\//i.test(value)) return value;
  try {
    return new URL(value || '/', baseUrl).toString();
  } catch {
    return baseUrl;
  }
}

export async function executeStep(
  page: Page,
  action: StepAction,
  baseUrl: string,
): Promise<StepExecutionResult> {
  try {
    switch (action.kind) {
      case 'navigate': {
        const url = resolveUrl(action.value || '', baseUrl);
        const res = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });
        await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
        return { ok: true, detail: `Navigated to "${url}" (HTTP ${res?.status() ?? 'unknown'}).` };
      }

      case 'click': {
        const found = await resolve(page, action.target, false);
        if (!found) return { ok: false, detail: `No visible, clickable element matching "${action.target}" was found on the page.` };
        await found.locator.click({ timeout: ACTION_TIMEOUT_MS });
        await page.waitForLoadState('networkidle', { timeout: 4000 }).catch(() => {});
        return { ok: true, detail: `Clicked the element matching "${action.target}" (resolved by ${found.how}).` };
      }

      case 'type': {
        const found = await resolve(page, action.target, true);
        if (!found) return { ok: false, detail: `No input field matching "${action.target}" was found on the page.` };
        if (!action.value) {
          return { ok: false, detail: `Step asks to enter a value into "${action.target}", but neither the step nor the Test Data column supplied one.` };
        }
        await found.locator.fill(action.value, { timeout: ACTION_TIMEOUT_MS });
        return { ok: true, detail: `Entered "${action.value}" into "${action.target}" (resolved by ${found.how}).` };
      }

      case 'select': {
        const found = await resolve(page, action.target, true);
        if (!found) return { ok: false, detail: `No dropdown matching "${action.target}" was found on the page.` };
        await found.locator.selectOption({ label: action.value }, { timeout: ACTION_TIMEOUT_MS });
        return { ok: true, detail: `Selected "${action.value}" from "${action.target}".` };
      }

      case 'check':
      case 'uncheck': {
        const found = await resolve(page, action.target, false);
        if (!found) return { ok: false, detail: `No checkbox matching "${action.target}" was found on the page.` };
        if (action.kind === 'check') await found.locator.check({ timeout: ACTION_TIMEOUT_MS });
        else await found.locator.uncheck({ timeout: ACTION_TIMEOUT_MS });
        return { ok: true, detail: `${action.kind === 'check' ? 'Checked' : 'Unchecked'} "${action.target}".` };
      }

      case 'clear': {
        const found = await resolve(page, action.target, true);
        if (!found) return { ok: false, detail: `No input field matching "${action.target}" was found to clear.` };
        await found.locator.fill('', { timeout: ACTION_TIMEOUT_MS });
        return { ok: true, detail: `Cleared the "${action.target}" field.` };
      }

      case 'hover': {
        const found = await resolve(page, action.target, false);
        if (!found) return { ok: false, detail: `No element matching "${action.target}" was found to hover over.` };
        await found.locator.hover({ timeout: ACTION_TIMEOUT_MS });
        return { ok: true, detail: `Hovered over "${action.target}".` };
      }

      case 'press': {
        await page.keyboard.press(action.value || 'Enter');
        await page.waitForLoadState('networkidle', { timeout: 4000 }).catch(() => {});
        return { ok: true, detail: `Pressed the "${action.value || 'Enter'}" key.` };
      }

      case 'scroll': {
        const dir = action.value === 'up' ? -1 : 1;
        await page.evaluate((d) => window.scrollBy(0, d * window.innerHeight * 0.8), dir);
        return { ok: true, detail: `Scrolled ${action.value === 'up' ? 'up' : 'down'} one viewport.` };
      }

      case 'wait': {
        const secs = Math.min(10, Math.max(1, Number(action.value) || 1));
        await page.waitForTimeout(secs * 1000);
        return { ok: true, detail: `Waited ${secs}s.` };
      }

      case 'submit': {
        const found = await resolve(page, action.target || 'submit', false);
        if (found) {
          await found.locator.click({ timeout: ACTION_TIMEOUT_MS });
        } else {
          const form = page.locator('form').first();
          if (!(await form.count())) return { ok: false, detail: 'No submit control and no <form> element were found on the page.' };
          await form.evaluate((f: HTMLFormElement) => f.requestSubmit());
        }
        await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
        return { ok: true, detail: 'Submitted the form.' };
      }

      case 'verify':
        // Assertion-only step — no interaction. The validator does the real work.
        return { ok: true, detail: 'Assertion step — evaluated against the live page state.' };

      case 'unknown':
      default:
        return { ok: false, detail: `The step could not be mapped to a browser action, so it was not executed: "${action.raw}".` };
    }
  } catch (e) {
    return { ok: false, detail: `The action threw during execution: ${(e as Error).message.split('\n')[0]}` };
  }
}

/** Real PNG screenshot of the current viewport, as a data URL. */
export async function captureScreenshot(page: Page): Promise<string | null> {
  try {
    const buf = await page.screenshot({ type: 'png', timeout: 6000 });
    return `data:image/png;base64,${buf.toString('base64')}`;
  } catch {
    return null;
  }
}

/** Best-effort human-readable screen name from the live page. */
export async function currentScreenName(page: Page): Promise<string> {
  try {
    const heading = await page.locator('h1, [role="heading"]').first().innerText({ timeout: 1500 }).catch(() => '');
    if (heading?.trim()) return heading.trim().slice(0, 60);
    const title = await page.title();
    if (title?.trim()) return title.trim().slice(0, 60);
    return new URL(page.url()).pathname || '/';
  } catch {
    return 'Unknown';
  }
}
