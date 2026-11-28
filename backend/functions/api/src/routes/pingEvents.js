/**
 * Event ping routes (places/battery) — client-detected events pushed to the group.
 *
 * The detecting client uploads the event here; we fan it out as
 * push_notifications docs (so recipients process a real notification with the
 * member/place context) and wake their UnifiedPush endpoints so they sync
 * immediately. Docs carry read+DELETE for the recipient — the old read-only
 * docs caused 401s on every cleanup delete.
 */

import { ok, fail, readBody } from "../lib/envelope.js";
import { newId, createDocument, listDocuments, Query } from "../lib/appwrite.js";
import { wakeDevices } from "../lib/push.js";

const DB = "data_main";

async function groupMembersExcept(groupId, exceptUserId) {
  const members = await listDocuments(DB, "group_members", [
    Query.equal("groupId", [groupId]),
    Query.limit(100),
  ]).catch(() => null);
  return (members?.json?.documents ?? [])
    .map((m) => m.data?.ownerUserId ?? m.ownerUserId)
    .filter((id) => id && id !== exceptUserId);
}

/** Fan an event out to the given users as push_notification docs, then wake. */
async function fanOut(log, userIds, type, importance, content, eventId = null) {
  const unique = [...new Set(userIds.filter(Boolean))];
  if (!unique.length) return;
  for (const uid of unique) {
    await createDocument(DB, "push_notifications", {
      documentId: newId(),
      data: {
        type,
        importance,
        content,
        deviceId: null,
        eventId,
        expiresAt: null,
      },
      permissions: [`read("user:${uid}")`, `delete("user:${uid}")`],
    }).catch((e) => log(`push doc create failed for ${uid}: ${e?.message}`));
  }
  await wakeDevices(log, unique);
}

/** POST /ping/events/places — "member entered/exited place" */
export async function eventsPlaces({ req, res, log, user }) {
  const body = readBody(req);
  // PlaceEventPayload { placeId, locationId?, event?, timeDifferenceMillis }
  if (typeof body?.placeId !== "string" || !body.placeId) {
    return fail(res, 400, "validation_error", "Missing placeId");
  }

  const places = await listDocuments(DB, "places", [
    Query.equal("$id", [body.placeId]),
  ]).catch(() => null);
  const place = places?.json?.documents?.[0];
  if (!place) {
    // place was deleted meanwhile — nothing to announce
    return ok(res, {});
  }
  const groupId = place.data?.groupId ?? place.groupId;
  if (!groupId) return ok(res, {});

  const others = await groupMembersExcept(groupId, user.id);

  const content = JSON.stringify({
    memberUserId: user.id,
    locationId: body.locationId ?? null,
    placeId: body.placeId,
    event: typeof body.event === "string" ? body.event : null,
    triggerAt: new Date().toISOString(),
  });

  await fanOut(log, others, "place_activity", "normal", content);
  return ok(res, {});
}

/** POST /ping/events/battery/group — "my phone battery is low" (group space) */
export async function eventsBatteryGroup({ req, res, log, user }) {
  const body = readBody(req);
  // GroupBatteryAlertPayload { groupId, memberId, locationId }
  if (typeof body?.groupId !== "string" || !body.groupId) {
    return fail(res, 400, "validation_error", "Missing groupId");
  }

  const others = await groupMembersExcept(body.groupId, user.id);

  const content = JSON.stringify({
    memberUserId: user.id,
    locationId: body.locationId ?? null,
    groupId: body.groupId,
  });

  await fanOut(log, others, "low_battery_alert", "normal", content);
  return ok(res, {});
}

/** POST /ping/events/battery/space — personal space device low battery */
export async function eventsBatterySpace({ req, res, log, user }) {
  const body = readBody(req);
  // PersonalBatteryAlertPayload { deviceId }
  if (typeof body?.deviceId !== "string" || !body.deviceId) {
    return fail(res, 400, "validation_error", "Missing deviceId");
  }

  const content = JSON.stringify({ deviceId: body.deviceId });

  // personal space: notify the user's own devices
  await fanOut(log, [user.id], "personal_low_battery_alert", "normal", content);
  return ok(res, {});
}
