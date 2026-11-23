/**
 * POST /location/personal  (ServerFunction.LOCATION_CREATE_PERSONAL)
 *
 * Client caller: RegisterDeviceForSharingUseCase.registerDeviceForPersonalSpace
 * — "Start sharing" for the personal space.
 *
 * Request body: LocationCreatePersonalPayload
 *   { deviceId, sessionId, deviceType, deviceData, locationData (null),
 *     status, notify, userKeyVersion, encryptedSenderKey }
 *
 * Server-side writes:
 *   personal_locations  doc with $id = deviceId (the client matches
 *                       locations to devices by id), permissions read+update
 *                       for the caller (client PATCHes directly)
 *   devices             update the device doc: sessionId, encryptedSenderKey
 *
 * Response data: {}
 */

import { ok, fail, readBody } from "../lib/envelope.js";
import { createDocument, updateDocument, ownerPermissions, toDocId } from "../lib/appwrite.js";

const DB = "data_main";

const REQUIRED = ["deviceId", "sessionId", "status", "encryptedSenderKey"];

export async function locationCreatePersonal({ req, res, log, user }) {
  const body = readBody(req);

  const missing = REQUIRED.filter((k) => body[k] === undefined || body[k] === null || body[k] === "");
  if (missing.length) {
    log(`location/personal 400: missing=${JSON.stringify(missing)}`);
    return fail(res, 400, "validation_error", `Missing fields: ${missing.join(", ")}`);
  }

  const perms = ownerPermissions(user.id);

  // 1. personal location doc, id = deviceId (client matches by id)
  const location = await createDocument(DB, "personal_locations", {
    documentId: toDocId(body.deviceId),
    data: {
      locationData: body.locationData ?? null,
      status: body.status ?? null,
      locationHistory: null,
    },
    permissions: perms,
  });
  if (!location.ok && location.status !== 409) {
    log(`personal_locations create failed: ${location.status} ${JSON.stringify(location.json)}`);
    return fail(res, 500, "general_error", "Failed to create personal location doc");
  }

  // 2. bind the sender key + session onto the device doc
  const deviceDocs = body.deviceId
    ? await (async () => {
        const { listDocuments, Query } = await import("../lib/appwrite.js");
        return listDocuments(DB, "devices", [
          Query.equal("ownerUserId", [user.id]),
          Query.equal("deviceId", [body.deviceId]),
          Query.limit(2),
        ]);
      })()
    : null;
  const deviceDoc = deviceDocs?.json?.documents?.[0];
  if (deviceDoc) {
    const upd = await updateDocument(DB, "devices", deviceDoc.$id, {
      sessionId: body.sessionId,
      encryptedSenderKey: body.encryptedSenderKey,
      deviceData: body.deviceData ?? deviceDoc.deviceData ?? null,
    });
    if (!upd.ok) log(`device doc update failed: ${upd.status}`);
  } else {
    log(`no device doc for deviceId=${body.deviceId} — creating`);
    const created = await createDocument(DB, "devices", {
      documentId: toDocId(body.deviceId),
      data: {
        ownerUserId: user.id,
        deviceId: body.deviceId,
        sessionId: body.sessionId,
        deviceType: body.deviceType ?? "phone",
        pushProvider: "unknown",
        encryptedSenderKey: body.encryptedSenderKey,
        deviceData: body.deviceData ?? null,
      },
      permissions: perms,
    });
    if (!created.ok) log(`device doc create failed: ${created.status}`);
  }

  log(`personal location ${location.json?.$id ?? toDocId(body.deviceId)} registered for ${user.id}`);
  return ok(res, {});
}
