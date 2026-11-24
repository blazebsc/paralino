/**
 * Place routes (group + personal space).
 *
 * PLACE_CREATE (PUT /places): CreatePlacePayload
 *   { groupId (= owner userId for personal space), keyVersion, private,
 *     data, isInPersonalSpace, eventKeys: [enterKey, exitKey] }
 *   → creates places doc; returns { placeId }.
 *
 * PLACE_UPDATE (PATCH /places): UpdatePlacePayload
 *   { placeId, placeData, groupKeyVersion?, userKeyVersion?, eventKeys? }
 *   → updates resourceData (+ eventKeys if provided); returns the place doc.
 *
 * PLACE_DELETE (DELETE /places): body = placeId (raw string)
 *   → deletes the place doc + its settings docs; returns {}.
 *
 * ALERTS_PLACES_UPDATE (PATCH /alerts/place): PlaceNotificationsUpdatePayload
 *   { groupId, placeId, placeSettingsId?, deviceId?, alertData }
 *   → upserts a places_settings doc (per member+device); returns the
 *     GroupPlaceSettingRaw doc.
 *
 * All data fields are client-side ciphertext. Personal-space places use the
 * user key (userKeyVersion attr); group places use the group key
 * (groupKeyVersion attr) — the client encrypts and tracks versions itself.
 */

import { ok, fail, readBody } from "../lib/envelope.js";
import { newId, createDocument, updateDocument, deleteDocument, listDocuments, Query, ownerPermissions, toDocId } from "../lib/appwrite.js";
import { wakeGroupMembers } from "../lib/push.js";

const DB = "data_main";

function placePerms(ownerId, extraRead = []) {
  const perms = ownerPermissions(ownerId);
  for (const u of extraRead) {
    if (u !== ownerId) perms.push(`read("user:${u}")`);
  }
  return perms;
}

export async function placeCreate({ req, res, log, user }) {
  const body = readBody(req);
  const missing = ["keyVersion", "data", "eventKeys"].filter((k) => body[k] === undefined || body[k] === null);
  if (missing.length) {
    return fail(res, 400, "validation_error", `Missing fields: ${missing.join(", ")}`);
  }
  const isInPersonalSpace = body.isInPersonalSpace === true;
  const groupId = isInPersonalSpace ? user.id : body.groupId;
  if (!groupId) {
    return fail(res, 400, "validation_error", "Missing groupId");
  }

  // group places are readable by all group members; personal places only by owner
  let extraRead = [];
  if (!isInPersonalSpace) {
    const members = await listDocuments(DB, "group_members", [Query.equal("groupId", [groupId])]);
    extraRead = (members?.json?.documents ?? []).map((m) => m.ownerUserId);
  }

  const place = await createDocument(DB, "places", {
    documentId: newId(),
    data: {
      ownerUserId: user.id,
      groupId,
      groupKeyVersion: isInPersonalSpace ? 0 : Number(body.keyVersion),
      userKeyVersion: isInPersonalSpace ? Number(body.keyVersion) : null,
      private: body.private === true,
      isInPersonalSpace,
      resourceData: body.data,
      eventKeys: Array.isArray(body.eventKeys) ? body.eventKeys : [],
    },
    permissions: placePerms(user.id, extraRead),
  });
  if (!place.ok) {
    log(`place create failed: ${place.status} ${JSON.stringify(place.json)}`);
    return fail(res, 500, "general_error", "Failed to create place");
  }

  log(`place ${place.json.$id} created by ${user.id} (personal: ${isInPersonalSpace})`);
  if (!isInPersonalSpace) wakeGroupMembers(log, groupId, user.id);
  return ok(res, { placeId: place.json.$id });
}

export async function placeUpdate({ req, res, log, user }) {
  const body = readBody(req);
  if (typeof body?.placeId !== "string" || typeof body?.placeData !== "string") {
    return fail(res, 400, "validation_error", "Missing placeId or placeData");
  }

  const data = { resourceData: body.placeData };
  if (Array.isArray(body.eventKeys)) data.eventKeys = body.eventKeys;

  const upd = await updateDocument(DB, "places", body.placeId, data);
  if (!upd.ok) {
    log(`place update failed: ${upd.status}`);
    return fail(res, upd.status === 404 ? 404 : 500, "general_error", "Failed to update place");
  }
  return ok(res, upd.json);
}

export async function placeDelete({ req, res, log, user }) {
  const placeId = typeof readBody(req) === "string" ? readBody(req) : readBody(req)?.placeId;
  if (!placeId) return fail(res, 400, "validation_error", "Missing placeId");

  // delete settings docs tied to this place
  const settings = await listDocuments(DB, "places_settings", [Query.equal("placeId", [placeId])]);
  for (const d of settings?.json?.documents ?? []) {
    await deleteDocument(DB, "places_settings", d.$id);
  }

  const del = await deleteDocument(DB, "places", placeId);
  if (!del.ok && del.status !== 404) {
    return fail(res, 500, "general_error", "Failed to delete place");
  }
  log(`place ${placeId} deleted by ${user.id}`);
  return ok(res, {});
}

export async function alertsPlacesUpdate({ req, res, log, user }) {
  const body = readBody(req);
  if (typeof body?.placeId !== "string" || typeof body?.alertData !== "string") {
    return fail(res, 400, "validation_error", "Missing placeId or alertData");
  }

  // upsert: one settings doc per (place, member, device)
  const filters = [Query.equal("placeId", [body.placeId]), Query.equal("ownerUserId", [user.id])];
  if (body.deviceId) filters.push(Query.equal("deviceId", [body.deviceId]));

  const existing = await listDocuments(DB, "places_settings", filters);
  const doc = existing?.json?.documents?.[0];

  if (doc) {
    const upd = await updateDocument(DB, "places_settings", doc.$id, { alertData: body.alertData });
    if (!upd.ok) return fail(res, 500, "general_error", "Failed to update place settings");
    return ok(res, upd.json);
  }

  const created = await createDocument(DB, "places_settings", {
    documentId: newId(),
    data: {
      groupId: body.groupId ?? user.id,
      placeId: body.placeId,
      ownerUserId: user.id,
      deviceId: body.deviceId ?? null,
      alertData: body.alertData,
    },
    permissions: ownerPermissions(user.id),
  });
  if (!created.ok) {
    log(`place settings create failed: ${created.status}`);
    return fail(res, 500, "general_error", "Failed to create place settings");
  }
  return ok(res, created.json);
}
