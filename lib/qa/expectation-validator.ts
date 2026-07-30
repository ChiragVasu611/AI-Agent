/**
 * Validates a test case's "Expected Result" against the REAL observed state of a
 * live page. Every assertion here reads actual DOM / URL / network state — none
 * of it is inferred, simulated, or randomised.
 *
 * A PASS is only ever returned when a concrete, named check actually succeeded.
 * When the expected result cannot be mapped to a checkable assertion we return
 * `inconclusive` — the engine turns that into BLOCKED, never into PASS.
 */

import type { Page } from 'playwright';

export interface PageSignals {
  /** Console errors emitted since the step began. */
  consoleErrors: string[];
  /** Uncaught page exceptions since the step began. */
  pageErrors: string[];
  /** Network requests that outright failed. */
  failedRequests: string[];
  /** XHR/fetch calls observed, with status codes. */
  apiCalls: Array<{ url: string; status: number; ms: number }>;
  /** Downloads triggered during the step. */
  downloads: string[];
  /** Dialogs (alert/confirm/prompt) opened during the step. */
  dialogs: string[];
  /** URL before the step ran — lets us detect navigation. */
  urlBefore: string;
}

export interface ValidationOutcome {
  status: 'pass' | 'fail' | 'inconclusive';
  /** What the engine actually observed, phrased for a bug report. */
  actual: string;
  /** Which named assertion ran, e.g. "text-visible", "url-changed". */
  assertion: string;
}

/**
 * "not"/"never"/"shouldn't" directly negate the verb of the sentence they're
 * in, so inverting the whole check is correct. "without" does NOT belong here:
 * sheets overwhelmingly use it as a manner clause on a POSITIVE expectation
 * ("should load without overlap", "launch successfully without crash") — not
 * as "this should not happen". Treating it as a full-sentence negation was
 * confirmed to invert a real failure ("nothing found") into a false PASS
 * against a real device running a real uploaded sheet.
 */
const NEGATION_RE = /\b(?:not|no longer|shouldn'?t|should not|must not|never)\b/i;

/**
 * Interrogative idioms that contain "not" but assert nothing either way: "check
 * if the button is cut off or not", "verify the label is true or false". These
 * ask *whether*, they don't assert a negative, so they must never flip a
 * verdict. Global on purpose — a sheet step routinely asks this twice in one
 * sentence ("cut off or not ... GIF load or not"), and stripping only the first
 * occurrence leaves a stray "not" behind that still reads as a negation. This
 * exact gap (present on the Android validator until fixed there) inverted a
 * real "element not found" failure into a false PASS.
 */
const INTERROGATIVE_RE = /\b(?:or\s+not|whether(?:\s+or\s+not)?|true\s+or\s+false|yes\s+or\s+no)\b/gi;

/**
 * Whether the expectation is phrased negatively ("should NOT be displayed").
 *
 * Quoted literals are stripped first: they are the *subject* being asserted on,
 * not assertion grammar. Without this, an expectation like
 *   Text "This Does Not Exist" is displayed
 * reads as negated and inverts to a false PASS when the text is genuinely absent.
 * Interrogative idioms are stripped next, before the negation check runs, so
 * their embedded "not" cannot be mistaken for a real negation.
 */
function isNegated(expected: string): boolean {
  const bare = expected.replace(/["'“”‘’][^"'“”‘’]*["'“”‘’]/g, ' ');
  return NEGATION_RE.test(bare.replace(INTERROGATIVE_RE, ' '));
}

/** Quoted literal inside an expectation is the exact text to look for. */
function quoted(text: string): string | null {
  const m = text.match(/["'“”‘’]([^"'“”‘’]{2,})["'“”‘’]/);
  return m ? m[1].trim() : null;
}

/**
 * Meaningful words to search the page for, when the expectation has no quoted
 * literal. Drops assertion boilerplate ("should be displayed") so we search for
 * the subject ("dashboard"), not the grammar.
 */
const STOP_WORDS = new Set([
  'the', 'a', 'an', 'is', 'are', 'be', 'been', 'should', 'must', 'will', 'shall', 'to', 'of', 'and',
  'or', 'on', 'in', 'at', 'with', 'for', 'that', 'this', 'it', 'user', 'users', 'system', 'app',
  'application', 'page', 'screen', 'successfully', 'success', 'correctly', 'properly', 'displayed',
  'display', 'shown', 'show', 'visible', 'appear', 'appears', 'appearing', 'redirected', 'redirect',
  'navigated', 'navigate', 'able', 'see', 'seen', 'view', 'viewed', 'get', 'gets', 'receive', 'without',
]);

/**
 * Compare URLs ignoring an empty query/hash. A GET form submit can turn
 * "/login" into "/login?" without navigating anywhere — treating that as a
 * successful redirect is a false PASS.
 */
function sameLocation(a: string, b: string): boolean {
  const norm = (u: string) => u.replace(/[?#]$/, '').replace(/\/$/, '');
  return norm(a) === norm(b);
}

function keywords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP_WORDS.has(w))
    .slice(0, 6);
}

async function bodyText(page: Page): Promise<string> {
  return page.evaluate(() => document.body?.innerText ?? '').catch(() => '');
}

/** Is text present and actually rendered (not display:none / zero-size)? */
async function isTextVisible(page: Page, needle: string): Promise<boolean> {
  try {
    return await page.getByText(needle, { exact: false }).first().isVisible({ timeout: 2500 });
  } catch {
    return false;
  }
}

/**
 * Detect which *kind* of expectation this is, so we run the assertion the
 * sheet author actually meant. Ordered most-specific first.
 */
type ExpectationKind =
  | 'navigation' | 'validation-message' | 'toast' | 'dialog' | 'api' | 'download'
  | 'loading' | 'image' | 'list' | 'search' | 'login' | 'logout' | 'form-submit'
  | 'field-value' | 'element-state' | 'text';

function classify(expected: string): ExpectationKind {
  const e = expected.toLowerCase();
  if (/\b(?:redirect|navigat|land(?:s|ed)? on|taken to|open(?:s|ed)? the|url\b)/.test(e)) return 'navigation';
  if (/\b(?:validation|error message|required field|invalid|warning message)\b/.test(e)) return 'validation-message';
  if (/\b(?:toast|snackbar|flash message)\b/.test(e)) return 'toast';
  if (/\b(?:dialog|modal|popup|pop-up|alert|bottom sheet|bottomsheet)\b/.test(e)) return 'dialog';
  if (/\b(?:api|endpoint|response|status code|200|201|4\d\d|5\d\d)\b/.test(e)) return 'api';
  if (/\b(?:download|downloaded|file is saved)\b/.test(e)) return 'download';
  if (/\b(?:loader|loading|spinner|progress)\b/.test(e)) return 'loading';
  if (/\b(?:image|icon|logo|thumbnail|avatar)\b/.test(e)) return 'image';
  if (/\b(?:list|items|records|rows|table|grid)\b/.test(e)) return 'list';
  if (/\b(?:search result|filtered|matching)\b/.test(e)) return 'search';
  if (/\b(?:logout|log out|signed out|sign out)\b/.test(e)) return 'logout';
  if (/\b(?:login|logged in|signed in|authenticated|dashboard|home ?page)\b/.test(e)) return 'login';
  if (/\b(?:submitted|saved|created|updated|deleted|added|removed)\b/.test(e)) return 'form-submit';
  if (/\b(?:field (?:contains|shows|has)|value is|prefilled|pre-filled)\b/.test(e)) return 'field-value';
  if (/\b(?:enabled|disabled|greyed|grayed|clickable|checked|unchecked)\b/.test(e)) return 'element-state';
  return 'text';
}

export async function validateExpectation(
  page: Page,
  expectedRaw: string,
  signals: PageSignals,
): Promise<ValidationOutcome> {
  const expected = String(expectedRaw ?? '').trim();
  if (!expected) {
    return { status: 'inconclusive', actual: 'The sheet did not specify an Expected Result, so nothing could be asserted.', assertion: 'none' };
  }

  const negated = isNegated(expected);
  const kind = classify(expected);
  const urlNow = page.url();

  // A hard page exception means the app broke — that fails any expectation.
  if (signals.pageErrors.length > 0) {
    return {
      status: 'fail',
      actual: `The page threw an uncaught exception during this step: ${signals.pageErrors[0]}`,
      assertion: 'page-exception',
    };
  }

  switch (kind) {
    case 'navigation': {
      const changed = !sameLocation(urlNow, signals.urlBefore);
      const literal = quoted(expected);
      // "redirected to /dashboard" — match the path fragment if one is named.
      const pathHint = literal ?? expected.match(/\/[\w\-/]{2,}/)?.[0] ?? null;
      if (pathHint) {
        const matches = urlNow.toLowerCase().includes(pathHint.toLowerCase());
        return {
          status: matches !== negated ? 'pass' : 'fail',
          actual: `URL after the step is "${urlNow}" (was "${signals.urlBefore}"); expected it to ${negated ? 'not ' : ''}contain "${pathHint}".`,
          assertion: 'url-contains',
        };
      }
      return {
        status: changed !== negated ? 'pass' : 'fail',
        actual: changed
          ? `Navigation occurred: "${signals.urlBefore}" → "${urlNow}".`
          : `No navigation occurred — the URL stayed at "${urlNow}".`,
        assertion: 'url-changed',
      };
    }

    case 'validation-message':
    case 'toast': {
      const literal = quoted(expected);
      const selector = kind === 'toast'
        ? '[role="status"], [role="alert"], .toast, [data-sonner-toast], .snackbar, .Toastify__toast'
        : '[role="alert"], [aria-invalid="true"], .error, .invalid-feedback, .field-error, .help-block, .text-destructive';
      const nodes = await page.locator(selector).allInnerTexts().catch(() => [] as string[]);
      const visibleText = nodes.map((t) => t.trim()).filter(Boolean);
      const found = literal
        ? visibleText.some((t) => t.toLowerCase().includes(literal.toLowerCase())) || (await isTextVisible(page, literal))
        : visibleText.length > 0;
      return {
        status: found !== negated ? 'pass' : 'fail',
        actual: visibleText.length > 0
          ? `${kind === 'toast' ? 'Toast/status' : 'Validation'} message(s) rendered: ${visibleText.slice(0, 3).map((t) => `"${t}"`).join(', ')}.`
          : `No ${kind === 'toast' ? 'toast/status' : 'validation'} element was rendered on the page after this step.`,
        assertion: kind,
      };
    }

    case 'dialog': {
      const nativeDialog = signals.dialogs.length > 0;
      const domDialog = await page.locator('[role="dialog"], [role="alertdialog"], dialog[open], .modal.show, [data-state="open"][role]').first()
        .isVisible({ timeout: 2000 }).catch(() => false);
      const found = nativeDialog || domDialog;
      return {
        status: found !== negated ? 'pass' : 'fail',
        actual: found
          ? `A dialog was present${nativeDialog ? ` (native: ${signals.dialogs[0]})` : ' (in-DOM modal)'}.`
          : 'No dialog, modal, or bottom sheet was present after this step.',
        assertion: 'dialog-visible',
      };
    }

    case 'api': {
      const wantStatus = expected.match(/\b([1-5]\d\d)\b/)?.[1];
      if (signals.apiCalls.length === 0) {
        return {
          status: negated ? 'pass' : 'fail',
          actual: 'No XHR/fetch API call was observed during this step.',
          assertion: 'api-call',
        };
      }
      if (wantStatus) {
        const match = signals.apiCalls.find((c) => String(c.status) === wantStatus);
        return {
          status: Boolean(match) !== negated ? 'pass' : 'fail',
          actual: `Observed API responses: ${signals.apiCalls.slice(0, 4).map((c) => `${c.status} ${c.url}`).join('; ')}.`,
          assertion: 'api-status',
        };
      }
      const errors = signals.apiCalls.filter((c) => c.status >= 400);
      return {
        status: (errors.length === 0) !== negated ? 'pass' : 'fail',
        actual: errors.length > 0
          ? `${errors.length} API call(s) returned an error: ${errors.slice(0, 3).map((c) => `${c.status} ${c.url}`).join('; ')}.`
          : `All ${signals.apiCalls.length} API call(s) returned success statuses.`,
        assertion: 'api-success',
      };
    }

    case 'download': {
      const got = signals.downloads.length > 0;
      return {
        status: got !== negated ? 'pass' : 'fail',
        actual: got ? `Download triggered: ${signals.downloads.join(', ')}.` : 'No download was triggered during this step.',
        assertion: 'download',
      };
    }

    case 'loading': {
      const spinner = await page.locator('[role="progressbar"], .spinner, .loader, .loading, [aria-busy="true"]').first()
        .isVisible({ timeout: 1500 }).catch(() => false);
      return {
        status: spinner !== negated ? 'pass' : 'fail',
        actual: spinner ? 'A loading/progress indicator was visible.' : 'No loading or progress indicator was visible at assertion time.',
        assertion: 'loading-indicator',
      };
    }

    case 'image': {
      const broken = await page.evaluate(() => {
        const imgs = Array.from(document.querySelectorAll('img'));
        return {
          total: imgs.length,
          broken: imgs.filter((i) => i.complete && i.naturalWidth === 0).length,
        };
      }).catch(() => ({ total: 0, broken: 0 }));
      if (broken.total === 0) {
        return { status: negated ? 'pass' : 'fail', actual: 'No <img> elements were present on the page.', assertion: 'image-visible' };
      }
      return {
        status: (broken.broken === 0) !== negated ? 'pass' : 'fail',
        actual: `${broken.total} image(s) present, ${broken.broken} failed to load.`,
        assertion: 'image-loaded',
      };
    }

    case 'list':
    case 'search': {
      const count = await page.locator('li, tbody tr, [role="row"], [role="listitem"], .list-item, .card').count().catch(() => 0);
      const wantMin = Number(expected.match(/\b(\d+)\s+(?:items?|records?|rows?|results?)/i)?.[1] ?? 1);
      const ok = count >= wantMin;
      return {
        status: ok !== negated ? 'pass' : 'fail',
        actual: `${count} list/row item(s) rendered on the page (expected at least ${wantMin}).`,
        assertion: 'list-items',
      };
    }

    case 'logout': {
      const text = (await bodyText(page)).toLowerCase();
      const looksLoggedOut = /\b(?:log ?in|sign ?in)\b/.test(text) || /login|signin/i.test(urlNow);
      return {
        status: looksLoggedOut !== negated ? 'pass' : 'fail',
        actual: looksLoggedOut
          ? `The page shows a sign-in affordance and the URL is "${urlNow}" — consistent with a logged-out state.`
          : `No sign-in affordance found; URL is "${urlNow}" — the session still appears active.`,
        assertion: 'logged-out',
      };
    }

    case 'login': {
      const literal = quoted(expected);
      if (literal) {
        const seen = await isTextVisible(page, literal);
        return {
          status: seen !== negated ? 'pass' : 'fail',
          actual: seen ? `Text "${literal}" is visible; URL is "${urlNow}".` : `Text "${literal}" was not found on the page. URL is "${urlNow}".`,
          assertion: 'text-visible',
        };
      }
      const text = (await bodyText(page)).toLowerCase();
      const stillOnLogin = /\b(?:log ?in|sign ?in)\b/.test(text) && /login|signin|auth/i.test(urlNow);
      const navigated = !sameLocation(urlNow, signals.urlBefore);
      const ok = navigated && !stillOnLogin;
      return {
        status: ok !== negated ? 'pass' : 'fail',
        actual: ok
          ? `Authenticated view reached — navigated from "${signals.urlBefore}" to "${urlNow}".`
          : `Still on an unauthenticated view (URL "${urlNow}"${stillOnLogin ? ', sign-in form still present' : ', no navigation occurred'}).`,
        assertion: 'authenticated',
      };
    }

    case 'field-value': {
      const literal = quoted(expected);
      if (!literal) break;
      const values = await page.evaluate(() =>
        Array.from(document.querySelectorAll('input, textarea, select')).map((el) => (el as HTMLInputElement).value ?? ''),
      ).catch(() => [] as string[]);
      const found = values.some((v) => v.toLowerCase().includes(literal.toLowerCase()));
      return {
        status: found !== negated ? 'pass' : 'fail',
        actual: found ? `A field contains "${literal}".` : `No field contained "${literal}". Current field values: ${values.filter(Boolean).slice(0, 4).join(', ') || '(all empty)'}.`,
        assertion: 'field-value',
      };
    }

    case 'element-state': {
      const literal = quoted(expected) ?? keywords(expected)[0] ?? '';
      if (!literal) break;
      const el = page.getByText(literal, { exact: false }).first();
      const wantDisabled = /\b(?:disabled|greyed|grayed)\b/i.test(expected);
      const disabled = await el.isDisabled({ timeout: 2000 }).catch(() => null);
      if (disabled === null) break;
      const ok = wantDisabled ? disabled : !disabled;
      return {
        status: ok !== negated ? 'pass' : 'fail',
        actual: `Element matching "${literal}" is ${disabled ? 'disabled' : 'enabled'}; expected ${wantDisabled ? 'disabled' : 'enabled'}.`,
        assertion: 'element-state',
      };
    }

    case 'form-submit': {
      const navigated = !sameLocation(urlNow, signals.urlBefore);
      const apiOk = signals.apiCalls.length > 0 && signals.apiCalls.every((c) => c.status < 400);
      const apiBad = signals.apiCalls.filter((c) => c.status >= 400);
      const literal = quoted(expected);
      if (literal) {
        const seen = await isTextVisible(page, literal);
        return {
          status: seen !== negated ? 'pass' : 'fail',
          actual: seen ? `Confirmation text "${literal}" is visible.` : `Confirmation text "${literal}" was not found after submission.`,
          assertion: 'text-visible',
        };
      }
      if (apiBad.length > 0) {
        return {
          status: negated ? 'pass' : 'fail',
          actual: `Submission produced failing API call(s): ${apiBad.slice(0, 3).map((c) => `${c.status} ${c.url}`).join('; ')}.`,
          assertion: 'form-submit',
        };
      }
      const ok = navigated || apiOk;
      return {
        status: ok !== negated ? 'pass' : 'fail',
        actual: ok
          ? `Submission took effect — ${navigated ? `navigated to "${urlNow}"` : `${signals.apiCalls.length} API call(s) succeeded`}.`
          : 'No navigation and no API call followed the submission — there is no evidence the form was submitted.',
        assertion: 'form-submit',
      };
    }

    default:
      break;
  }

  // Fallback: plain text-presence assertion against the real rendered page.
  const literal = quoted(expected);
  if (literal) {
    const seen = await isTextVisible(page, literal);
    return {
      status: seen !== negated ? 'pass' : 'fail',
      actual: seen ? `Text "${literal}" is visible on the page.` : `Text "${literal}" was not visible on the page.`,
      assertion: 'text-visible',
    };
  }

  const words = keywords(expected);
  if (words.length === 0) {
    return {
      status: 'inconclusive',
      actual: `The expected result "${expected}" contains no assertable subject, so no automated check could be derived.`,
      assertion: 'none',
    };
  }

  const text = (await bodyText(page)).toLowerCase();
  const hits = words.filter((w) => text.includes(w));
  // Require a majority of the meaningful words — a single incidental match is
  // not evidence the expectation was met.
  const ok = hits.length >= Math.ceil(words.length / 2);
  return {
    status: ok !== negated ? 'pass' : 'fail',
    actual: ok
      ? `Page content matches the expectation (found: ${hits.join(', ')}).`
      : `Page content does not match the expectation — searched for [${words.join(', ')}], found only [${hits.join(', ') || 'none'}].`,
    assertion: 'text-keywords',
  };
}
