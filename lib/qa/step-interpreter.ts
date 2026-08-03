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
  | 'hover' | 'press' | 'scroll' | 'wait' | 'submit' | 'verify' | 'proceed'
  | 'volume'
  // Gestures and device actions a manual tester performs routinely. Without
  // these, ordinary sheet phrasings ("Long press the item", "Minimise the app",
  // "Kill and reopen the app") were unmappable — and an unmappable step is a
  // step never performed, so the case cannot honestly be called a pass.
  | 'longpress' | 'doubletap' | 'home' | 'restart' | 'screenshot'
  | 'unknown';

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

/**
 * The control a tap-style step names.
 *
 * When a sheet quotes a control, the quote IS the target and everything around
 * it is prose. `cleanTarget` alone only strips quote characters, so
 * `Tap the "Close" button on the advertisement.` became the target
 * `Close on the advertisement.` — a label no app has, failing a step that was
 * perfectly executable. Observed on a real run.
 *
 * Quoting control names is how sheets normally write them
 * (`Tap "Start Your AI Journey" button`), and those only worked before because
 * nothing followed the closing quote. Preferring the quoted literal makes the
 * common form robust regardless of surrounding wording.
 */
function tapTarget(rest: string): string {
  const quoted = extractPairedQuote(rest);
  return quoted ? quoted.trim() : cleanTarget(rest);
}

/**
 * A quoted span delimited by a MATCHING pair, tried widest-first.
 *
 * `extractQuoted` treats every quote character as interchangeable, so the
 * apostrophe inside a label closed the span early: `Tap "Let's Create a Magic"
 * button` yielded the target `Let`. That is a real label in this sheet, so the
 * step could never match. Requiring the same delimiter on both ends keeps
 * apostrophes inside the label where they belong, and double/smart quotes are
 * tried before single ones so a bare apostrophe cannot win.
 */
function extractPairedQuote(text: string): string | null {
  for (const [open, close] of [['"', '"'], ['“', '”'], ['‘', '’'], ["'", "'"]]) {
    const re = new RegExp(`${escapeRe(open)}([^${escapeRe(close)}]+)${escapeRe(close)}`);
    const m = text.match(re);
    if (m && m[1].trim()) return m[1];
  }
  return null;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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
/**
 * "Slide", "drag" and "flick" are the same gesture a sheet means by "swipe" —
 * left out, steps like "Slide review manually" were unmappable and blocked.
 */
const SCROLL_RE = /^(?:scroll|swipe|slide|drag|flick)\b/i;
/** "Increase volume", "turn the volume down" — a real hardware key press. */
const VOLUME_RE = /^(?:increase|decrease|raise|lower|turn)\b[^.]*\bvolume\b|^volume\b/i;
const WAIT_RE = /^(?:wait|pause|sleep)\b/i;
const SUBMIT_RE = /^(?:submit|send)\b/i;
const CHECK_RE = /^(?:check|tick|enable)\b/i;
const UNCHECK_RE = /^(?:uncheck|untick|disable)\b/i;

/** "Long press the item", "press and hold the thumbnail". */
const LONGPRESS_RE = /^(?:long[\s-]?press|press\s+and\s+hold|hold)\b/i;
/** "Double tap the image". Tested before CLICK_RE, which would swallow "tap". */
const DOUBLETAP_RE = /^double[\s-]?(?:tap|click)\b/i;
/** "Minimise the app", "send the app to the background", "press home". */
const HOME_RE = /^(?:minimi[sz]e|background)\b|^(?:put|send|move)\b[^.]*\b(?:background)\b|^press\s+home\b|^go\s+to\s+home\s+screen\b/i;
/**
 * "Kill and reopen the app", "force stop the app and launch again". A restart is
 * destructive, so it is honoured ONLY when the sheet asks for it explicitly —
 * the engine never restarts on its own initiative.
 */
const RESTART_RE = /^(?:kill|force[\s-]?stop|terminate|quit)\b[^.]*\b(?:reopen|re-?open|relaunch|launch|start|open)\b|^restart\s+the\s+app\b/i;
/** "Take a screenshot" — every step already captures one, so this is satisfied. */
const SCREENSHOT_RE = /^(?:take|capture)\b[^.]*\bscreen\s?shot\b|^screenshot\b/i;

/**
 * "Wait for the video to finish", "wait until the list loads" — a duration-less
 * wait. `WAIT_RE` alone parsed these as 1 second (the regex found no digits and
 * defaulted), which is not what the sheet asked for.
 */
const WAIT_FOR_EVENT_RE = /^(?:wait|pause)\b[^.]*\b(?:until|for)\b/i;

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

/**
 * Direction of a scroll/slide gesture. "bottom to top" describes the content's
 * travel, so it is an upward swipe; a bare "top"/"up" means the same thing.
 */
function scrollDirection(raw: string): 'up' | 'down' | 'left' | 'right' {
  if (/\bright\b/i.test(raw)) return 'right';
  if (/\bleft\b/i.test(raw)) return 'left';
  if (/\bbottom\s+to\s+top\b|\bup\b|\btop\b/i.test(raw)) return 'up';
  return 'down';
}

/**
 * Split a compound instruction ("Increase volume and slide review manually")
 * into the actions it actually asks for, so both halves genuinely execute
 * instead of the whole step being reported as unmappable.
 *
 * Deliberately only attempted when the step as a whole cannot be interpreted:
 * a step like `Tap "Save and Continue"` must never be torn in half, and leaving
 * already-mappable steps untouched guarantees that cannot happen.
 */
export function interpretStepParts(rawStep: string, testData = ''): StepAction[] {
  const whole = interpretStep(rawStep, testData);
  const raw = String(rawStep ?? '').trim();

  // A quoted literal may itself contain "and" — `Tap "Save and Continue"` is one
  // control, not two steps — so quoted steps are never split.
  if (/["'“”‘’]/.test(raw)) return [whole];
  // An assertion reads as a single expectation however many clauses it lists.
  if (whole.kind === 'verify') return [whole];

  const clauses = raw
    .split(/\s*(?:,\s*then\b|;|\band\s+also\b|\band\s+then\b|\band\b|\bthen\b)\s*/i)
    .map((s) => s.trim())
    .filter((s) => s.length > 2);
  if (clauses.length < 2) return [whole];

  const parts = clauses.map((c) => interpretStep(c, testData));
  // Every clause must independently read as an instruction — its own leading
  // action verb, and a mapping the executor can carry out. That is what stops an
  // unquoted control label ("Click Save and Exit") being torn in half: "Exit"
  // alone is not verb-led, so that step stays whole.
  const allVerbLed = clauses.every(startsWithActionVerb);
  const allMappable = parts.every((p) => p.kind !== 'unknown');
  return allVerbLed && allMappable ? parts : [whole];
}

/** Every leading verb the interpreter recognises, for compound-split safety. */
const ACTION_VERB_RES = [
  VERIFY_RE, NAVIGATE_RE, INSTALL_THEN_LAUNCH_RE, CLICK_RE, TYPE_RE, CLEAR_RE,
  HOVER_RE, SCROLL_RE, WAIT_RE, SUBMIT_RE, CHECK_RE, UNCHECK_RE, PROCEED_RE, VOLUME_RE,
  LONGPRESS_RE, DOUBLETAP_RE, HOME_RE, RESTART_RE, SCREENSHOT_RE,
];

function startsWithActionVerb(clause: string): boolean {
  return ACTION_VERB_RES.some((re) => re.test(clause.trim()));
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
  // "Check the Terms box" / "Check the consent option" is an INTERACTION, not an
  // assertion. The exception used to name only "checkbox"/"tick box", so a bare
  // "box" — or "terms"/"consent"/"agree" — was read as something to verify and
  // the box was never ticked.
  if (VERIFY_RE.test(raw) && !/\b(?:checkbox|tick ?box|box|terms|consent|agree)\b/i.test(raw)) {
    return { kind: 'verify', target: raw.replace(VERIFY_RE, '').trim(), value: '', raw };
  }

  const strip = (re: RegExp) => raw.replace(re, '').trim();

  if (INSTALL_THEN_LAUNCH_RE.test(raw)) {
    return { kind: 'navigate', target: '', value: '', raw };
  }
  // "Tap the back button" / "press device back" means the hardware Back key.
  // Searching the hierarchy for a control labelled "back" finds nothing on most
  // screens, which failed the step for the wrong reason.
  if (/\b(?:back)\b/i.test(raw) && (CLICK_RE.test(raw) || /^(?:go|navigate)\b/i.test(raw))
      && !/\bback\s+to\s+(?!the\s+(?:previous|last)\b)/i.test(raw)) {
    return { kind: 'press', target: '', value: 'Escape', raw };
  }
  // Device-level actions, before the generic verbs. "Double tap" must beat
  // CLICK_RE's "tap", and "Kill and reopen the app" must beat NAVIGATE_RE.
  if (SCREENSHOT_RE.test(raw)) {
    return { kind: 'screenshot', target: '', value: '', raw };
  }
  if (RESTART_RE.test(raw)) {
    return { kind: 'restart', target: '', value: '', raw };
  }
  if (HOME_RE.test(raw)) {
    return { kind: 'home', target: '', value: '', raw };
  }
  if (DOUBLETAP_RE.test(raw)) {
    return { kind: 'doubletap', target: tapTarget(strip(DOUBLETAP_RE)), value: '', raw };
  }
  if (LONGPRESS_RE.test(raw)) {
    return { kind: 'longpress', target: tapTarget(strip(LONGPRESS_RE)), value: '', raw };
  }
  if (NAVIGATE_RE.test(raw)) {
    const url = raw.match(/https?:\/\/\S+/)?.[0] ?? raw.match(/\s(\/[\w\-/]*)/)?.[1] ?? '';
    return { kind: 'navigate', target: cleanTarget(strip(NAVIGATE_RE)), value: url, raw };
  }
  // "Wait until the list loads" has no duration — settle on the screen instead
  // of silently substituting one second.
  if (WAIT_FOR_EVENT_RE.test(raw) && !/\d/.test(raw)) {
    return { kind: 'wait', target: cleanTarget(strip(WAIT_RE)), value: 'settle', raw };
  }
  if (WAIT_RE.test(raw)) {
    return { kind: 'wait', target: '', value: raw.match(/(\d+)/)?.[1] ?? '1', raw };
  }
  if (VOLUME_RE.test(raw)) {
    return { kind: 'volume', target: '', value: /\b(?:decrease|lower|down|mute|reduce)\b/i.test(raw) ? 'down' : 'up', raw };
  }
  if (SCROLL_RE.test(raw)) {
    return { kind: 'scroll', target: cleanTarget(strip(SCROLL_RE)), value: scrollDirection(raw), raw };
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
    return { kind: 'click', target: tapTarget(strip(CLICK_RE)), value: '', raw };
  }
  // Bare assertions with no leading verb: "Dashboard is displayed"
  if (/\b(?:is|are)\s+(?:displayed|visible|shown|present)\b/i.test(raw)) {
    return { kind: 'verify', target: raw, value: '', raw };
  }

  return { kind: 'unknown', target: cleanTarget(raw), value: '', raw };
}
