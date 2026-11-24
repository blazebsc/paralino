/**
 * Privacy zone routes.
 *
 * PRIVACY_ZONE_CREATE (PUT /privacy-zones): CreatePrivacyZonePayload
 *   { groupId, userKeyVersion, data } → creates doc; returns the doc.
 * PRIVACY_ZONE_UPDATE (PATCH /privacy-zones): UpdatePrivacyZonePayload
 *   { privacyZoneId, zoneData, userKeyVersion? } → updates resourceData.
 * PRIVACY_ZONE_DELETE (DELETE /privacy-zones): body { privacyZoneId }
 *   (client sends PrivacyZoneDeletePayload-style body — accept raw id too).
 *
 * Zone data is client-side ciphertext.
 */

import { ok, fail, readBody } from "../lib/envelope.js";
import { newId, createDocument, updateDocument, deleteDocument, listDocuments, Query, ownerPermissions, toDocId } from "../lib/appwrite.js";

const DB = "data_main";

export async function privacyZoneCreate({ req, res, log, user }) {
  const body = readBody(req);
  const missing = ["userKeyVersion", "data"].filter((k) => body[k] === undefined || body[k] === null || body[k] === "");
  if (missing.length) {
    return fail(res, 400, "validation_error", `Missing fields: ${missing.join(", ")}`);
  }
  const groupId = body.groupId ?? user.id; // personal-space zones: groupId = userId

  let extraRead = [];
  if (body.groupId && body.groupId !== user.id) {
    const members = await listDocuments(DB, "group_members", [Query.equal("groupId", [body.groupId])]);
    extraRead = (members?.json?.documents ?? []).map((m) => m.ownerUserId);
  }

  const zone = await createDocument(DB, "privacy_zones", {
    documentId: newId(),
    data: {
      ownerUserId: user.id,
      groupId,
      userKeyVersion: Number(body.userKeyVersion),
      resourceData: body.data,
    },
    permissions: placePerms(user.id, extraRead),
  });
  if (!zone.ok) {
    log(`privacy zone create failed: ${zone.status}`);
    return fail(res, 500, "general_error", "Failed to create privacy zone");
  }
  return ok(res, zone.json);
}

export async function privacyZoneUpdate({ req, res, log, user }) {
  const body = readBody(req);
  const zoneId = body?.privacyZoneId;
  const zoneData = body?.zoneData ?? body?.data;
  if (typeof zoneId !== "string" || typeof zoneData !== "string") {
    return fail(res, 400, "validation_error", "Missing privacyZoneId or zoneData");
  }
  const data = { resourceData: zoneData };
  if (Number.isInteger(body.userKeyVersion)) data.userKeyVersion = body.userKeyVersion;

  const upd = await updateDocument(DB, "privacy_zones", zoneId, data);
  if (!upd.ok) {
    return fail(res, upd.status === 404 ? 404 : 500, "general_error", "Failed to update privacy zone");
  }
  return ok(res, upd.json);
}

export async function privacyZoneDelete({ req, res, log, user }) {
  const body = readBody(req);
  const zoneId = typeof body === "string" ? body : (body?.privacyZoneId ?? body?.id);
  if (!zoneId) return fail(res, 400, "validation_error", "Missing privacyZoneId");

  const del = await deleteDocument(DB, "privacy_zones", zoneId);
  if (!del.ok && del.status !== 404) {
    return fail(res, 500, "general_error", "Failed to delete privacy zone");
  }
  return ok(res, {});
}

function placePerms(ownerId, extraRead = []) {
  const perms = ownerPermissions(ownerId);
  for (const u of extraRead) {
    if (u !== ownerId) perms.push(`read("user:${u}")`);
  }
  return perms;
}
