/**
 * Location deletion routes ("Stop sharing" / device deactivation).
 *
 * DELETE /location/group: GroupLocationDeletePayload { memberId, locationId }
 *   → deletes the locations doc + the member's group_device_keys for it,
 *     and removes the id from member.locationIds.
 *
 * DELETE /location/personal: PersonalLocationDeletePayload { deviceId }
 *   → deletes the personal_locations doc (id = deviceId) and clears the
 *     device doc's encryptedSenderKey.
 *
 * Both are called when a device stops sharing. Response data: {}.
 */

import { ok, fail, readBody } from "../lib/envelope.js";
import { deleteDocument, updateDocument, listDocuments, Query, toDocId } from "../lib/appwrite.js";

const DB = "data_main";

export async function locationDeleteGroup({ req, res, log, user }) {
  const body = readBody(req);
  const memberId = typeof body === "object" ? body?.memberId : null;
  const locationId = typeof body === "object" ? body?.locationId : null;
  if (!memberId || !locationId) {
    return fail(res, 400, "validation_error", "Missing memberId or locationId");
  }

  // permission: the member themselves or the group owner
  // (the member doc's ownerUserId == memberId; caller is user.id)
  const members = await listDocuments(DB, "group_members", [
    Query.equal("$id", [memberId]),
    Query.limit(2),
  ]);
  const memberDoc = members?.json?.documents?.[0];
  if (!memberDoc) return fail(res, 404, "not_found", "Member not found");
  if (memberDoc.ownerUserId !== user.id) {
    // only the member or the group owner may delete
    const groups = await listDocuments(DB, "groups", [
      Query.equal("$id", [memberDoc.groupId]),
      Query.equal("ownerUserId", [user.id]),
      Query.limit(1),
    ]);
    if (!groups?.json?.documents?.[0]) {
      return fail(res, 403, "forbidden", "Not allowed to delete this location");
    }
  }

  await deleteDocument(DB, "locations", locationId).catch(() => {});

  // drop sender keys tied to that location
  const deviceKeys = await listDocuments(DB, "group_device_keys", [
    Query.equal("locationId", [locationId]),
  ]);
  for (const k of deviceKeys?.json?.documents ?? []) {
    await deleteDocument(DB, "group_device_keys", k.$id);
  }

  // remove from member.locationIds
  const locationIds = (memberDoc.locationIds ?? []).filter((id) => id !== locationId);
  await updateDocument(DB, "group_members", memberDoc.$id, { locationIds });

  log(`group location ${locationId} deleted (member ${memberId})`);
  return ok(res, {});
}

export async function locationDeletePersonal({ req, res, log, user }) {
  const body = readBody(req);
  const deviceId = typeof body === "object" ? body?.deviceId : null;
  if (!deviceId) return fail(res, 400, "validation_error", "Missing deviceId");

  await deleteDocument(DB, "personal_locations", toDocId(deviceId)).catch(() => {});

  // clear the sender key on the device doc
  const devices = await listDocuments(DB, "devices", [
    Query.equal("ownerUserId", [user.id]),
    Query.equal("deviceId", [deviceId]),
    Query.limit(2),
  ]);
  const deviceDoc = devices?.json?.documents?.[0];
  if (deviceDoc) {
    await updateDocument(DB, "devices", deviceDoc.$id, { encryptedSenderKey: null });
  }

  log(`personal location for device ${deviceId} deleted`);
  return ok(res, {});
}
