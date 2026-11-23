/**
 * POST /location/group  (ServerFunction.LOCATION_CREATE_GROUP)
 *
 * Client caller: core-domain/.../domain/location/RegisterDeviceForSharingUseCase
 * .registerDeviceForGroupSharing — "Start sharing" for a group.
 *
 * Request body: LocationCreateGroupPayload
 *   { groupId, deviceId, deviceData, locationData (null at registration),
 *     status, groupKeyVersion, notify, realtimeUpdatesPrefs,
 *     keys: [{ userId, memberKeyVersion, encryptedSenderKey }] }
 * All data/status fields are client-side ciphertext (E2EE).
 *
 * Server-side writes:
 *   locations          the member's location doc (unique id), permissions:
 *                      read+update for the caller — the client PATCHes this
 *                      doc DIRECTLY on every location ping (location-upload
 *                      route also exists, but direct updates are the norm)
 *   group_members      append the locations doc id to member.locationIds
 *   group_device_keys  one doc per member the sender key was encrypted for,
 *                      deviceKeyVersion = per-member increment
 *
 * Response data: {} (client only checks isSuccess; it learns the state from
 * the refresh that follows)
 */

import { ok, fail, readBody } from "../lib/envelope.js";
import { createDocument, updateDocument, listDocuments, Query, ownerPermissions, toDocId } from "../lib/appwrite.js";

const DB = "data_main";

const REQUIRED = ["groupId", "deviceId", "groupKeyVersion", "status"];

export async function locationCreateGroup({ req, res, log, user }) {
  const body = readBody(req);

  const missing = REQUIRED.filter((k) => body[k] === undefined || body[k] === null || body[k] === "");
  if (missing.length) {
    log(`location/group 400: missing=${JSON.stringify(missing)}`);
    return fail(res, 400, "validation_error", `Missing fields: ${missing.join(", ")}`);
  }

  // find the caller's member doc in this group
  const members = await listDocuments(DB, "group_members", [
    Query.equal("groupId", [body.groupId]),
    Query.equal("ownerUserId", [user.id]),
    Query.limit(2),
  ]);
  const memberDoc = members?.json?.documents?.[0];
  if (!memberDoc) {
    return fail(res, 404, "not_found", "Caller is not a member of this group");
  }
  if (members.json.documents.length > 1) {
    log(`location/group: multiple member docs for ${user.id} in ${body.groupId}`);
  }

  // per-member device key version: latest existing + 1
  const existingDeviceKeys = await listDocuments(DB, "group_device_keys", [
    Query.equal("groupId", [body.groupId]),
    Query.equal("memberUserId", [user.id]),
    Query.limit(100),
  ]);
  const latestDeviceVersion = (existingDeviceKeys?.json?.documents ?? [])
    .reduce((max, d) => Math.max(max, Number(d.deviceKeyVersion ?? 0)), 0);
  const deviceKeyVersion = latestDeviceVersion + 1;

  const locationPerms = [
    `read("user:${user.id}")`,
    `update("user:${user.id}")`,
    `delete("user:${user.id}")`,
  ];

  // 1. the location doc — client updates it directly on every ping
  const location = await createDocument(DB, "locations", {
    documentId: toDocId(`loc${body.deviceId}${deviceKeyVersion}`),
    data: {
      deviceId: body.deviceId,
      groupId: body.groupId,
      groupKeyVersion: Number(body.groupKeyVersion),
      deviceKeyVersion,
      deviceData: body.deviceData ?? null,
      locationData: body.locationData ?? null,
      locationHistory: null,
      status: body.status ?? null,
    },
    permissions: locationPerms,
  });
  if (!location.ok) {
    log(`locations create failed: ${location.status} ${JSON.stringify(location.json)}`);
    return fail(res, 500, "general_error", "Failed to create location doc");
  }
  const locationId = location.json.$id;

  // 2. register it on the member doc
  const locationIds = [...(memberDoc.locationIds ?? []), locationId];
  const upd = await updateDocument(DB, "group_members", memberDoc.$id, { locationIds });
  if (!upd.ok) log(`member locationIds update failed: ${upd.status}`);

  // 3. sender keys encrypted per member
  const keys = Array.isArray(body.keys) ? body.keys : [];
  for (const k of keys) {
    if (!k?.userId || !k?.encryptedSenderKey) continue;
    const created = await createDocument(DB, "group_device_keys", {
      documentId: toDocId(`dk${body.groupId.slice(0, 10)}${k.userId.slice(0, 10)}${deviceKeyVersion}`),
      data: {
        groupId: body.groupId,
        memberUserId: k.userId,
        ownerUserId: user.id,
        locationId,
        memberKeyVersion: Number(k.memberKeyVersion ?? 0),
        deviceKeyVersion,
        encryptedSenderKey: k.encryptedSenderKey,
      },
      permissions: [...ownerPerms, `read("user:${k.userId}")`],
    });
    if (!created.ok) log(`device key for ${k.userId} failed: ${created.status}`);
  }

  log(`location ${locationId} created for ${user.id} in ${body.groupId} (deviceKeyVersion ${deviceKeyVersion}, ${keys.length} member keys)`);
  return ok(res, {});
}
