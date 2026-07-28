import type { UiNode } from './types';
import { centerOf, labelOf, parseHierarchy } from './ui-parser';
import { dumpHierarchy, tap, pressKey, KEY } from './device';
import { waitForStableUi } from './smart-wait';
import { isPermissionDialog } from './screen-classifier';

/**
 * Runtime permission dialog handling.
 *
 * The dialog is rendered by the platform's PermissionController, so its
 * controls are located through the live hierarchy (resource ids in the
 * `com.android.permissioncontroller` namespace, or the platform's own button
 * vocabulary) rather than any app-specific knowledge. The engine grants
 * permissions by default so exploration can continue past gated features,
 * and records which permissions were requested as run evidence.
 */

/** Platform button ids, stable across Android 6→15. */
const ALLOW_ID = /permission_allow_(button|foreground_only_button|one_time_button|all_button)|allow_button/i;
const DENY_ID = /permission_deny(_button|_and_dont_ask_again_button)?|deny_button/i;

/** Platform button labels — these come from the OS, not from the app. */
const ALLOW_LABEL = /^(allow|allow all the time|while using the app|only this time|allow only while using the app|ok|continue|turn on)$/i;
const DENY_LABEL = /^(deny|don't allow|do not allow|cancel|no thanks)$/i;

const PERMISSION_MESSAGE_ID = /permission_message|grant_dialog_message|permission_description/i;

export interface PermissionEvent {
  message: string;
  action: 'granted' | 'denied' | 'unhandled';
  control: string;
}

function pickButton(nodes: UiNode[], idRe: RegExp, labelRe: RegExp): UiNode | null {
  const byId = nodes.find((n) => n.enabled && idRe.test(n.resourceId));
  if (byId) return byId;
  const byLabel = nodes.find((n) => n.enabled && n.clickable && labelRe.test(labelOf(n)));
  if (byLabel) return byLabel;
  // Some OEM dialogs mark only the parent clickable; accept a labelled child.
  const labelled = nodes.find((n) => n.enabled && labelRe.test(labelOf(n)));
  return labelled ?? null;
}

/** Text of the permission being requested, used as evidence in the report. */
function permissionMessage(nodes: UiNode[]): string {
  const byId = nodes.find((n) => PERMISSION_MESSAGE_ID.test(n.resourceId) && labelOf(n));
  if (byId) return labelOf(byId);
  const longest = nodes
    .map(labelOf)
    .filter((t) => t.length > 15)
    .sort((a, b) => b.length - a.length)[0];
  return (longest ?? 'Permission requested').slice(0, 200);
}

/**
 * Handles a permission dialog if one is present.
 * @param grant when false the dialog is denied — used by the security module
 *              to verify the app degrades gracefully without a permission.
 */
export async function handlePermissionDialog(
  serial: string,
  grant = true,
): Promise<PermissionEvent | null> {
  const xml = await dumpHierarchy(serial);
  if (!xml) return null;
  const { nodes } = parseHierarchy(xml);
  const pkg = nodes[0]?.packageName ?? '';
  if (!isPermissionDialog(nodes, pkg)) return null;

  const message = permissionMessage(nodes);
  const button = grant
    ? pickButton(nodes, ALLOW_ID, ALLOW_LABEL)
    : pickButton(nodes, DENY_ID, DENY_LABEL);

  if (!button) {
    // Unknown dialog shape — back out so exploration is never stuck.
    await pressKey(serial, KEY.BACK);
    await waitForStableUi(serial, { timeoutMs: 3_000 });
    return { message, action: 'unhandled', control: 'BACK' };
  }

  const p = centerOf(button.bounds);
  await tap(serial, p.x, p.y);
  await waitForStableUi(serial, { timeoutMs: 4_000 });

  return {
    message,
    action: grant ? 'granted' : 'denied',
    control: labelOf(button) || button.resourceId || button.className,
  };
}

/**
 * Drains a chain of permission dialogs (apps often request several in a row).
 * Bounded so a misbehaving dialog loop can't stall the run.
 */
export async function handleAllPermissions(serial: string, grant = true, max = 8): Promise<PermissionEvent[]> {
  const events: PermissionEvent[] = [];
  for (let i = 0; i < max; i++) {
    const ev = await handlePermissionDialog(serial, grant);
    if (!ev) break;
    events.push(ev);
  }
  return events;
}
