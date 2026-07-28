import type { UiNode } from './types';
import { centerOf, labelOf, shortId, isEditable, visibleText, parseHierarchy } from './ui-parser';
import { dumpHierarchy, tap, inputText, pressKey, KEY } from './device';
import { waitForStableUi } from './smart-wait';

/**
 * Login form handling.
 *
 * Fields are identified by their platform-level semantics — `password="true"`,
 * input class, and the accessibility label/hint/resource-id vocabulary that is
 * common across the ecosystem — never by app-specific ids. Credentials are
 * supplied by the run configuration; when none exist the engine prefers a
 * guest/skip path, and if login is truly mandatory it records the blocked
 * coverage and lets exploration continue everywhere else.
 */

export interface QaCredentials {
  email?: string | null;
  password?: string | null;
  phone?: string | null;
  otp?: string | null;
}

const EMAIL_HINT = /e-?mail|user ?name|userid|user_id|login_id|account/i;
const PHONE_HINT = /phone|mobile|msisdn|contact ?number/i;
const OTP_HINT = /otp|one ?time|verification ?code|\bcode\b|pin/i;
const PASSWORD_HINT = /pass ?word|passcode|pwd/i;

const SUBMIT_LABEL = /^(sign in|log ?in|login|continue|next|submit|verify|done|proceed)$/i;
const SUBMIT_ID = /(login|signin|sign_in|submit|continue|next|verify)(_?(btn|button))?$/i;

const GUEST_LABEL = /\b(skip|continue as guest|guest|later|maybe later|not now|browse|explore|continue without)\b/i;

export type FieldRole = 'email' | 'phone' | 'otp' | 'password' | 'unknown';

/** Classifies an input by platform semantics first, vocabulary second. */
export function classifyField(n: UiNode): FieldRole {
  if (n.password) return 'password';
  const hay = `${shortId(n)} ${n.contentDesc} ${n.text}`;
  if (PASSWORD_HINT.test(hay)) return 'password';
  if (OTP_HINT.test(hay)) return 'otp';
  if (PHONE_HINT.test(hay)) return 'phone';
  if (EMAIL_HINT.test(hay)) return 'email';
  return 'unknown';
}

export interface LoginFormInfo {
  present: boolean;
  fields: Array<{ node: UiNode; role: FieldRole }>;
  submit: UiNode | null;
  guestOption: UiNode | null;
}

export function inspectLoginForm(nodes: UiNode[]): LoginFormInfo {
  const editables = nodes.filter((n) => isEditable(n) && n.enabled);
  const fields = editables.map((node) => ({ node, role: classifyField(node) }));
  const hasPassword = fields.some((f) => f.role === 'password');
  const text = visibleText(nodes);
  const loginish = hasPassword || /\b(sign in|log ?in|otp|verification code)\b/.test(text);

  const submit = nodes.find((n) => n.enabled && n.clickable && SUBMIT_LABEL.test(labelOf(n)))
    ?? nodes.find((n) => n.enabled && SUBMIT_ID.test(n.resourceId))
    ?? null;

  const guestOption = nodes.find((n) => n.enabled && n.clickable && GUEST_LABEL.test(labelOf(n))) ?? null;

  return { present: loginish && editables.length > 0, fields, submit, guestOption };
}

export interface LoginAttempt {
  attempted: boolean;
  strategy: 'credentials' | 'guest' | 'none';
  filled: FieldRole[];
  submitted: boolean;
  note: string;
}

/**
 * Attempts to get past a login screen. Prefers real credentials when the run
 * supplies them; otherwise takes an explicit guest/skip affordance if the app
 * offers one. Never fabricates an account and never taps a purchase control.
 */
export async function attemptLogin(
  serial: string,
  creds: QaCredentials | null,
): Promise<LoginAttempt> {
  const xml = await dumpHierarchy(serial);
  if (!xml) return { attempted: false, strategy: 'none', filled: [], submitted: false, note: 'No hierarchy available.' };

  const { nodes } = parseHierarchy(xml);
  const form = inspectLoginForm(nodes);
  if (!form.present) {
    return { attempted: false, strategy: 'none', filled: [], submitted: false, note: 'No login form detected.' };
  }

  const hasAnyCred = !!(creds && (creds.email || creds.phone || creds.password || creds.otp));

  // Without credentials, a guest path is the only honest way forward.
  if (!hasAnyCred) {
    if (form.guestOption) {
      const p = centerOf(form.guestOption.bounds);
      await tap(serial, p.x, p.y);
      await waitForStableUi(serial, { timeoutMs: 5_000 });
      return {
        attempted: true,
        strategy: 'guest',
        filled: [],
        submitted: false,
        note: `Continued as guest via "${labelOf(form.guestOption)}".`,
      };
    }
    return {
      attempted: false,
      strategy: 'none',
      filled: [],
      submitted: false,
      note: 'Login required but no QA credentials are configured and the app offers no guest path.',
    };
  }

  // Fill each recognised field with the matching credential.
  const filled: FieldRole[] = [];
  for (const { node, role } of form.fields) {
    const value =
      role === 'password' ? creds?.password
      : role === 'otp' ? creds?.otp
      : role === 'phone' ? creds?.phone
      : role === 'email' ? creds?.email
      : (creds?.email ?? creds?.phone);
    if (!value) continue;

    const p = centerOf(node.bounds);
    await tap(serial, p.x, p.y);
    await inputText(serial, value);
    filled.push(role);
  }

  if (filled.length === 0) {
    return { attempted: false, strategy: 'credentials', filled, submitted: false, note: 'No field matched the configured credentials.' };
  }

  // Dismiss the IME so the submit control isn't occluded.
  await pressKey(serial, KEY.ESCAPE);

  let submitted = false;
  const fresh = parseHierarchy(await dumpHierarchy(serial)).nodes;
  const submit = inspectLoginForm(fresh).submit ?? form.submit;
  if (submit) {
    const p = centerOf(submit.bounds);
    await tap(serial, p.x, p.y);
    submitted = true;
  } else {
    await pressKey(serial, KEY.ENTER);
    submitted = true;
  }
  await waitForStableUi(serial, { timeoutMs: 8_000 });

  return {
    attempted: true,
    strategy: 'credentials',
    filled,
    submitted,
    note: `Filled ${filled.join(', ')} and submitted the form.`,
  };
}
