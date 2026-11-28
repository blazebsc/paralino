/**
 * SOS — panic button / automatic crash escalation.
 *
 * POST /sos  { groupId?: string }
 *
 * Alerts every member of every group the user belongs to (or just groupId
 * when given) with a high-importance "sos" push doc, then wakes their
 * UnifiedPush endpoints. The client shows these with an alarm notification.
 */

import { ok, fail, readBody } from "../lib/envelope.js";
import { newId, createDocument, listDocuments, Query } from "../lib/appwrite.js";
import { wakeDevices } from "../lib/push.js";

const DB = "data_main";

export async function sosTrigger({ req, res, log, user }) {
  const body = readBody(req) || {};
  const wanted = typeof body.groupId === "string" && body.groupId ? [body.groupId] : null;

  const memberships = await listDocuments(DB, "group_members", [
    Query.equal("ownerUserId", [user.id]),
    Query.limit(100),
  ]).catch(() => null);
  const groupIds = (memberships?.json?.documents ?? [])
    .map((m) => m.data?.groupId ?? m.groupId)
    .filter((id) => id && (!wanted || wanted.includes(id)));

  if (!groupIds.length) {
    return fail(res, 400, "validation_error", "No groups to alert");
  }

  const targets = new Set();
  for (const groupId of groupIds) {
    const members = await listDocuments(DB, "group_members", [
      Query.equal("groupId", [groupId]),
      Query.limit(100),
    ]).catch(() => null);
    for (const m of members?.json?.documents ?? []) {
      const id = m.data?.ownerUserId ?? m.ownerUserId;
      if (id && id !== user.id) targets.add(id);
    }
  }

  const content = JSON.stringify({
    memberUserId: user.id,
    triggerAt: new Date().toISOString(),
  });

  for (const uid of targets) {
    await createDocument(DB, "push_notifications", {
      documentId: newId(),
      data: {
        type: "sos",
        importance: "high",
        content,
        deviceId: null,
        eventId: null,
        expiresAt: null,
      },
      permissions: [`read("user:${uid}")`, `delete("user:${uid}")`],
    }).catch((e) => log(`sos doc create failed for ${uid}: ${e?.message}`));
  }

  await wakeDevices(log, [...targets]);
  log(`sos triggered by ${user.id} — alerted ${targets.size} members`);
  return ok(res, { alerted: targets.size });
}
