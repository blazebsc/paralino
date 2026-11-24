/**
 * Ping routes (focus/refresh) — realtime nudges between members.
 *
 * The client sends these when it wants another member's device to:
 * - focus: immediately upload its current location
 * - refresh: re-fetch shared data
 *
 * Without push infrastructure, these are best-effort: the server creates a
 * push_notifications doc that the target member's app picks up via
 * Appwrite realtime. If the target's app is in the foreground, the
 * realtime subscription triggers the action immediately.
 *
 * All ping routes return {} or { wasHighPriorityRequest: false } — the
 * client only checks isSuccess.
 */

import { ok, readBody } from "../lib/envelope.js";
import { newId, createDocument, toDocId } from "../lib/appwrite.js";


function makeFocus(target) {
  return async ({ req, res, log, user }) => {
    const body = readBody(req);
    log(`focus ${target} from ${user.id}: ${JSON.stringify(body)}`);
    await createDocument("data_main", "push_notifications", {
      documentId: newId(),
      data: { type: "focus", importance: "high", content: JSON.stringify(body), deviceId: null, eventId: null, expiresAt: null },
      permissions: [`read("user:${user.id}")`],
    }).catch(() => {});
    return ok(res, { wasHighPriorityRequest: false });
  };
}

export const focusMember = makeFocus("member");
export const focusGroup = makeFocus("group");
export const focusDevice = makeFocus("device");
export const focusSpace = makeFocus("space");

export const refreshMember = async ({ req, res, log, user }) => {
  log(`refresh request from ${user.id}`);
  return ok(res, {});
};

export const refreshDevice = refreshMember;
