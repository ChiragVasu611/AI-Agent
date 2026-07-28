/**
 * Deterministic natural-language → structured web action parser.
 *
 * Test case sheets are written by humans in prose ("Click the Login button",
 * "Enter valid email in the email field"). To *actually* execute a step against
 * a real browser we must turn that prose into a concrete action + target.
 *
 * This parser is fully deterministic — no AI, no randomness. If a step cannot be
 * confidently mapped it returns kind 'unknown', and the executor reports the step
 * as blocked with the reason rather than guessing an outcome. Guessing is exactly
 * the "dummy execution" this engine exists to eliminate.
 */

export type StepActionKind =
  | 'navigate' | 'click' | 'type' | 'select' | 'check' | 'uncheck' | 'clear'
  | 'hover' | 'press' | 'scroll' | 'wait' | 'submit' | 'verify' | 'proceed' | 'unknown';

export interface StepAction {
  kind: StepActionKind;
  /** Human label of the element to act on, e.g. "Login", "email". */
  target: string;
  /** Value to type/select/press, when the action needs one. */
  value: string;
  /** The original step text, kept verbatim for reporting. */
  raw: string;
}

/** Pull a quoted literal out of a step: Enter "user@test.com" → user@test.com */
function extractQuoted(text: string): string | null {
  const m = text.match(/["'“”‘’]([^"'“”‘’]+)["'“”‘’]/);
  return m ? m[1].trim() : null;
}

/**
 * Strip UI-noun noise so "the Login button" → "Login" and "the email field" → "email".
 * Playwright's accessible-name matching wants the label, not the widget type.
 */
function cleanTarget(raw: string): string {
  return raw
    // Repeated: "to the login page" sheds both "to" and "the".
    .replace(/^(?:(?:on|in|into|to|the|a|an)\s+)+/i, '')
    .replace(/\s+(?:button|btn|link|field|input|box|textbox|text box|icon|tab|menu|option|checkbox|dropdown|drop-down|select|toggle|item|element|page|screen|section)s?\b/gi, '')
    .replace(/["'“”‘’]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Test data like "email: a@b.com, password: secret" → the value for a named field. */
export function valueFromTestData(testData: string, field: string): string | null {
  if (!testData || !field) return null;
  const key = field.toLowerCase().replace(/\s+/g, '');
  for (const chunk of testData.split(/[\n,;|]+/)) {
    const [k, ...rest] = chunk.split(/[:=]/);
    if (!k || rest.length === 0) continue;
    if (k.toLowerCase().replace(/\s+/g, '').includes(key)) return rest.join(':').trim();
  }
  return null;
}

const VERIFY_RE = /^(?:verify|validate|assert|check|confirm|ensure|observe|user\s+should|should|it\s+should|expect)\b/i;
const NAVIGATE_RE = /^(?:navigate|open|launch|go|visit|load|browse|relaunch|restart)\b/i;
/**
 * "Install app and launch it" — installation is handled once during run
 * preparation, so by the time steps execute the only actionable part left is
 * the launch. Treated as navigation rather than left unmappable.
 */
const INSTALL_THEN_LAUNCH_RE = /^install\b/i;
const CLICK_RE = /^(?:click|tap|press|select|choose|hit|activate)\b/i;
const TYPE_RE = /^(?:enter|type|input|fill|provide|key\s*in|write|set)\b/i;
const CLEAR_RE = /^(?:clear|erase|empty|remove\s+text)\b/i;
const HOVER_RE = /^(?:hover|mouse\s*over)\b/i;
const SCROLL_RE = /^(?:scroll|swipe)\b/i;
const WAIT_RE = /^(?:wait|pause|sleep)\b/i;
const SUBMIT_RE = /^(?:submit|send)\b/i;
const CHECK_RE = /^(?:check|tick|enable)\b/i;
const UNCHECK_RE = /^(?:uncheck|untick|disable)\b/i;

/**
 * Steps that mean "move the app forward" without naming a specific control.
 * Real sheets are full of these ("Continue application flow", "Complete
 * permission flow (if displayed)", "Proceed to onboarding"). Treating them as
 * unmappable strands the run on whatever screen it is currently on, which is
 * indistinguishable from the engine having stopped.
 */
const PROCEED_RE = /^(?:continue|proceed|move on|move to|go ahead|advance|complete|finish|reach|dismiss|skip|close)\b/i;
const PROCEED_CONTEXT_RE = /\b(?:flow|next screen|onboarding|permission|if (?:displayed|shown|present|any)|ad|advertisement|popup|pop-up|dialog|banner)\b/i;

/**
 * "Enter valid email in the Email field" → target "Email", value from test data.
 * "Type 'abc' into search"               → target "search", value "abc".
 */
function parseTypeStep(rest: string, raw: string, testData: string): StepAction {
  const quoted = extractQuoted(rest);
  // Split on the preposition that introduces the target: "<value> in|into|on <target>"
  const split = rest.match(/^(.*?)\s+(?:in|into|on|to|within)\s+(.+)$/i);

  let target = '';
  let value = quoted ?? '';

  if (split) {
    target = cleanTarget(split[2]);
    if (!quoted) {
      const lhs = split[1].replace(/^(?:a|an|the|valid|invalid|correct|incorrect|registered)\s+/i, '').trim();
      // "Enter valid email" — the LHS names the field, not a literal value.
      value = valueFromTestData(testData, target) ?? valueFromTestData(testData, lhs) ?? lhs;
    }
  } else {
    target = cleanTarget(rest);
    value = quoted ?? valueFromTestData(testData, target) ?? '';
  }

  return { kind: 'type', target, value, raw };
}

export function interpretStep(rawStep: string, testData = ''): StepAction {
  const raw = String(rawStep ?? '').trim();
  if (!raw) return { kind: 'unknown', target: '', value: '', raw };

  // Verification must be tested BEFORE click, because "check that X is visible"
  // is an assertion while "check the Terms checkbox" is an interaction.
  //
  // A leading verify/validate/assert verb is intent enough on its own — real
  // sheets write bare assertions like "Verify app launch" with no copula, and
  // requiring one left them unmappable. Only an explicit checkbox reference
  // falls through to the interaction handler.
  if (VERIFY_RE.test(raw) && !/\b(?:checkbox|tick ?box)\b/i.test(raw)) {
    return { kind: 'verify', target: raw.replace(VERIFY_RE, '').trim(), value: '', raw };
  }

  const strip = (re: RegExp) => raw.replace(re, '').trim();

  if (INSTALL_THEN_LAUNCH_RE.test(raw)) {
    return { kind: 'navigate', target: '', value: '', raw };
  }
  if (NAVIGATE_RE.test(raw)) {
    const url = raw.match(/https?:\/\/\S+/)?.[0] ?? raw.match(/\s(\/[\w\-/]*)/)?.[1] ?? '';
    return { kind: 'navigate', target: cleanTarget(strip(NAVIGATE_RE)), value: url, raw };
  }
  if (WAIT_RE.test(raw)) {
    return { kind: 'wait', target: '', value: raw.match(/(\d+)/)?.[1] ?? '1', raw };
  }
  if (SCROLL_RE.test(raw)) {
    return { kind: 'scroll', target: cleanTarget(strip(SCROLL_RE)), value: /up|top/i.test(raw) ? 'up' : 'down', raw };
  }
  if (HOVER_RE.test(raw)) {
    return { kind: 'hover', target: cleanTarget(strip(HOVER_RE)), value: '', raw };
  }
  if (CLEAR_RE.test(raw)) {
    return { kind: 'clear', target: cleanTarget(strip(CLEAR_RE)), value: '', raw };
  }
  if (UNCHECK_RE.test(raw)) {
    return { kind: 'uncheck', target: cleanTarget(strip(UNCHECK_RE)), value: '', raw };
  }
  if (CHECK_RE.test(raw) && /\b(?:checkbox|box|terms|agree|consent|option)\b/i.test(raw)) {
    return { kind: 'check', target: cleanTarget(strip(CHECK_RE)), value: '', raw };
  }
  // "Continue application flow" / "Complete permission flow (if displayed)" —
  // move forward using whatever affordance the current screen actually offers.
  if (PROCEED_RE.test(raw) || (PROCEED_CONTEXT_RE.test(raw) && !CLICK_RE.test(raw) && !TYPE_RE.test(raw) && !VERIFY_RE.test(raw))) {
    return { kind: 'proceed', target: cleanTarget(raw), value: '', raw };
  }
  if (TYPE_RE.test(raw)) {
    return parseTypeStep(strip(TYPE_RE), raw, testData);
  }
  if (/\bfrom\b.*\b(?:dropdown|drop-down|select|list)\b/i.test(raw) && CLICK_RE.test(raw)) {
    const m = raw.match(/^(?:\w+)\s+(.*?)\s+from\s+(?:the\s+)?(.+)$/i);
    return { kind: 'select', target: cleanTarget(m?.[2] ?? ''), value: (extractQuoted(raw) ?? m?.[1] ?? '').trim(), raw };
  }
  if (SUBMIT_RE.test(raw)) {
    return { kind: 'submit', target: cleanTarget(strip(SUBMIT_RE)), value: '', raw };
  }
  if (/^press\b/i.test(raw) && /\b(?:enter|tab|escape|esc|space|backspace|arrow)\b/i.test(raw)) {
    const key = raw.match(/\b(enter|tab|escape|esc|space|backspace|arrowup|arrowdown|arrowleft|arrowright)\b/i)?.[1] ?? 'Enter';
    const norm = key.toLowerCase() === 'esc' ? 'Escape' : key.charAt(0).toUpperCase() + key.slice(1).toLowerCase();
    return { kind: 'press', target: '', value: norm, raw };
  }
  if (CLICK_RE.test(raw)) {
    return { kind: 'click', target: cleanTarget(strip(CLICK_RE)), value: '', raw };
  }
  // Bare assertions with no leading verb: "Dashboard is displayed"
  if (/\b(?:is|are)\s+(?:displayed|visible|shown|present)\b/i.test(raw)) {
    return { kind: 'verify', target: raw, value: '', raw };
  }

  return { kind: 'unknown', target: cleanTarget(raw), value: '', raw };
}
