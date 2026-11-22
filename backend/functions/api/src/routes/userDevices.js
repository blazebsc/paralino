/**
 * PUT /v2/user/devices  (ServerFunction.USER_DEVICE_UPDATE)
 *
 * Client caller: core-domain/.../repo/user/UserDevicesRemoteSource.kt
 * Request body:  UpdateUserDeviceFunctionData
 *   { sessionId, deviceId, deviceType, pushProvider, pushToken?,
 *     locationPushToken?, pushProviderConfig?: PushProviderEndpointPayload|null,
 *     updatePushProviderConfig: bool }
 * Response data: full UserDeviceRaw document (client parses UserDeviceRaw.from(map)).
 *
 * Upsert keyed by deviceId (client-generated, stable across logins).
 * pushProviderConfig is stored as the client-encoded JSON string it arrives as
 * (UserDeviceRaw.pushProviderConfig is a String). It is only stored when
 * updatePushProviderConfig is true; otherwise the stored value is preserved.
 * FCM pushTargetId is out of scope for the fork (direct flavor: null until
 * push dispatch phase).
 */

import { ok, fail, readBody } from "../lib/envelope.js";
import { createDocument, updateDocument, listDocuments, Query, ownerPermissions, toDocId } from "../lib/appwrite.js";

const DB = "data_main";
const COL = "devices";

const REQUIRED = ["sessionId", "deviceId", "deviceType", "pushProvider"];

export async function updateUserDevice({ req, res, log, user }) {
  const body = readBody(req);

  const missing = REQUIRED.filter((k) => typeof body[k] !== "string" || !body[k]);
  if (missing.length) {
    return fail(res, 400, "validation_error", `Missing fields: ${missing.join(", ")}`);
  }

  const existing = await listDocuments(DB, COL, [
    Query.equal("ownerUserId", [user.id]),
    Query.equal("deviceId", [body.deviceId]),
    Query.limit(2),
  ]);
  if (!existing.ok) {
    log(`listDocuments failed: ${existing.status}`);
    return fail(res, 500, "general_error", "Failed to read existing devices");
  }
  if (existing.json.documents.length > 1) {
    log(`duplicate device docs for deviceId=${body.deviceId}`);
    return fail(res, 409, "duplicate_device", "Multiple device documents for deviceId");
  }

  const current = existing.json.documents[0];
  const pushProviderConfig = body.updatePushProviderConfig
    ? (body.pushProviderConfig ? JSON.stringify(body.pushProviderConfig) : null)
    : (current?.pushProviderConfig ?? null);

  const data = {
    ownerUserId: user.id,
    sessionId: body.sessionId,
    deviceId: body.deviceId,
    deviceType: body.deviceType,
    pushProvider: body.pushProvider,
    pushToken: body.pushToken ?? null,
    locationPushToken: body.locationPushToken ?? null,
    pushProviderConfig,
    // fields UserDeviceRaw expects but this route does not manage:
    deviceData: current?.deviceData ?? null,
    encryptedSenderKey: current?.encryptedSenderKey ?? null,
    userKeyVersion: current?.userKeyVersion ?? null,
    batteryAlertSettings: current?.batteryAlertSettings ?? null,
    pushTargetId: current?.pushTargetId ?? null,
  };

  let doc;
  if (current) {
    const updated = await updateDocument(DB, COL, current.$id, data);
    if (!updated.ok) {
      log(`update failed: ${updated.status}`);
      return fail(res, 500, "general_error", "Failed to update device");
    }
    doc = updated.json;
  } else {
    const created = await createDocument(DB, COL, {
      documentId: toDocId(body.deviceId),
      data,
      permissions: ownerPermissions(user.id),
    });
    if (!created.ok) {
      log(`create failed: ${created.status}`);
      return fail(res, 500, "general_error", "Failed to register device");
    }
    doc = created.json;
  }

  return ok(res, doc);
}
