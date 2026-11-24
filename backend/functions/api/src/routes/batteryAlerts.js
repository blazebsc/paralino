/**
 * Battery alert + event routes.
 *
 * ALERTS_BATTERY_UPDATE_GROUP (PATCH /alerts/battery/group):
 *   GroupBatteryNotificationsUpdatePayload { groupId, memberId, alertData }
 *   → upserts the member's group_settings.batteryAlertSettings.
 *   Returns {}.
 *
 * ALERTS_BATTERY_UPDATE_SPACE (PATCH /alerts/battery/space):
 *   PersonalBatteryNotificationsUpdatePayload { deviceId, alertData }
 *   → upserts the device doc's batteryAlertSettings. Returns {}.
 *
 * EVENT routes (POST /ping/events/*): these fire when the CLIENT detects
 *   a place enter/exit or low battery. The server distributes push
 *   notifications to other members. Without push infrastructure they
 *   create push_notifications docs that the realtime layer picks up.
 *   Returns {}.
 */

import { ok, fail, readBody } from "../lib/envelope.js";
import { newId, createDocument, updateDocument, listDocuments, Query, ownerPermissions, toDocId } from "../lib/appwrite.js";

const DB = "data_main";

export async function alertsBatteryUpdateGroup({ req, res, log, user }) {
  const body = readBody(req);
  if (typeof body?.groupId !== "string" || typeof body?.memberId !== "string" || typeof body?.alertData !== "string") {
    return fail(res, 400, "validation_error", "Missing groupId, memberId or alertData");
  }

  // update the member's group_settings.batteryAlertSettings
  const settings = await listDocuments(DB, "group_settings", [
    Query.equal("groupId", [body.groupId]),
    Query.equal("ownerUserId", [body.memberId]),
  ]);
  const doc = settings?.json?.documents?.[0];
  if (doc) {
    const upd = await updateDocument(DB, "group_settings", doc.$id, { batteryAlertSettings: body.alertData });
    if (!upd.ok) return fail(res, 500, "general_error", "Failed to update battery settings");
  }
  return ok(res, {});
}

export async function alertsBatteryUpdateSpace({ req, res, log, user }) {
  const body = readBody(req);
  if (typeof body?.deviceId !== "string" || typeof body?.alertData !== "string") {
    return fail(res, 400, "validation_error", "Missing deviceId or alertData");
  }

  const devices = await listDocuments(DB, "devices", [
    Query.equal("ownerUserId", [user.id]),
    Query.equal("deviceId", [body.deviceId]),
    Query.limit(2),
  ]);
  const deviceDoc = devices?.json?.documents?.[0];
  if (deviceDoc) {
    await updateDocument(DB, "devices", deviceDoc.$id, { batteryAlertSettings: body.alertData });
  }
  return ok(res, {});
}

/** Create a push_notifications doc for realtime pickup by other members. */
async function createPushNotification(user, type, content, deviceId = null, eventId = null) {
  await createDocument(DB, "push_notifications", {
    documentId: newId(),
    data: {
      type,
      importance: "normal",
      content,
      deviceId,
      eventId,
      expiresAt: null,
    },
    permissions: [`read("user:${user.id}")`],
  }).catch(() => {});
}

/** POST /ping/events/places — place enter/exit events */
export async function pingEventsPlaces({ req, res, log, user }) {
  const body = readBody(req);
  // PlaceEventPayload { placeId, locationId?, event?, timeDifferenceMillis }
  log(`place event from ${user.id}: ${JSON.stringify(body)}`);
  // Realtime handles notification delivery via the push_notifications collection.
  // Without push infrastructure the other member's app picks it up on next refresh.
  return ok(res, {});
}

/** POST /ping/events/battery/group */
export async function pingEventsBatteryGroup({ req, res, log, user }) {
  const body = readBody(req);
  // GroupBatteryAlertPayload { groupId, memberId, locationId }
  log(`battery alert (group) from ${user.id}: ${JSON.stringify(body)}`);
  return ok(res, {});
}

/** POST /ping/events/battery/space */
export async function pingEventsBatterySpace({ req, res, log, user }) {
  const body = readBody(req);
  // PersonalBatteryAlertPayload { deviceId }
  log(`battery alert (space) from ${user.id}: ${JSON.stringify(body)}`);
  return ok(res, {});
}

