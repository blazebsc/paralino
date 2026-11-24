/**
 * Ping routes (focus/refresh) — realtime nudges between members.
 *
 * The client sends these when it wants another member's device to:
 * - focus: immediately upload its current location
 * - refresh: re-fetch shared data
 *
 * Delivery: UnifiedPush wake-up to the target's registered endpoints
 * (see lib/push.js) — that's what makes "locate on demand" work while
 * the target's app is backgrounded. Foreground clients also pick these
 * up via Appwrite realtime subscriptions.
 *
 * All ping routes return {} or { wasHighPriorityRequest: false } — the
 * client only checks isSuccess.
 */

import { ok, readBody } from "../lib/envelope.js";
import { wakeDevices, wakeGroupMembers } from "../lib/push.js";


function makeFocus(target) {
  return async ({ req, res, log, user }) => {
    const body = readBody(req);
    log(`focus ${target} from ${user.id}: ${JSON.stringify(body)}`);
    if (target === "group" && typeof body?.groupId === "string") {
      wakeGroupMembers(log, body.groupId, user.id);
    } else if (typeof body?.userId === "string" && body.userId) {
      wakeDevices(log, [body.userId]);
    } else if (typeof body?.groupId === "string" && body.groupId) {
      wakeGroupMembers(log, body.groupId, user.id);
    }
    return ok(res, { wasHighPriorityRequest: false });
  };
}

export const focusMember = makeFocus("member");
export const focusGroup = makeFocus("group");
export const focusDevice = makeFocus("device");
export const focusSpace = makeFocus("space");

export const refreshMember = async ({ req, res, log, user }) => {
  const body = readBody(req);
  log(`refresh request from ${user.id}: ${JSON.stringify(body)}`);
  if (typeof body?.userId === "string" && body.userId) {
    wakeDevices(log, [body.userId]);
  }
  return ok(res, {});
};

export const refreshDevice = refreshMember;
