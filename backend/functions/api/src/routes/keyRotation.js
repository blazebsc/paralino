/**
 * Key rotation routes — fire when group/member/device keys rotate (members
 * joining/leaving, integrity changes, periodic rotation).
 *
 * KEYS_UPDATE_GROUP (POST /keys/group): UpdateGroupKeysPayload
 *   { groupId, integrity, userKeyVersion, keyVersionsToKeep,
 *     encryptedGroupKeys: [{ userId, encryptedGroupKey, memberKeyVersion }],
 *     groupData, places: [{ placeId, placeData }] }
 *   → replaces the group's group_keys docs with the new versions, updates the
 *     group doc (resourceData + groupKeyVersion = latest key version),
 *     updates place resourceData. Caller must be the group owner.
 *
 * KEYS_UPDATE_MEMBERS (POST /keys/member): UpdateOwnMemberPublicKeyPayload
 *   { groupId, integrity, userKeyVersion, memberData, paralinoId?,
 *     signedPublicKey, encryptedMemberPersonalKeys, groupKeyVersion,
 *     memberKeyVersionsToKeep }
 *   → rotates the CALLING member's public key material: updates their
 *     group_member_keys doc (new memberKeyVersion), group_settings.memberIntegrity,
 *     member resourceData. Caller must be the member.
 *
 * KEYS_UPDATE_LOCATIONS (POST /keys/location): UpdateGroupMemberSenderKeysPayload
 *   { groupId, locationData: { locationId, deviceId, groupKeyVersion, deviceData,
 *     locationData, status, locationHistory, encryptedSenderKeys: [...] } }
 *   → updates the caller's location doc AND distributes new sender keys via
 *     group_device_keys docs (one per member entry), deviceKeyVersion bumped.
 *     Caller must own the location doc.
 *
 * All key material arrives pre-encrypted by the client; the server only
 * stores and distributes.
 */

import { ok, fail, readBody } from "../lib/envelope.js";
import { createDocument, updateDocument, deleteDocument, listDocuments, Query, ownerPermissions, toDocId } from "../lib/appwrite.js";

const DB = "data_main";

async function requireGroupOwner(groupId, user, fail, res) {
  const groups = await listDocuments(DB, "groups", [
    Query.equal("$id", [groupId]),
    Query.equal("ownerUserId", [user.id]),
    Query.limit(2),
  ]);
  const group = groups?.json?.documents?.[0];
  if (!group) {
    fail(res, 403, "forbidden", "Only the group owner can rotate group keys");
    return null;
  }
  return group;
}

async function groupMemberIds(groupId) {
  const members = await listDocuments(DB, "group_members", [Query.equal("groupId", [groupId])]);
  return (members?.json?.documents ?? []).map((m) => m.ownerUserId);
}

/** POST /keys/group */
export async function keysUpdateGroup({ req, res, log, user }) {
  const body = readBody(req);
  if (typeof body?.groupId !== "string" || !Array.isArray(body?.encryptedGroupKeys)) {
    return fail(res, 400, "validation_error", "Missing groupId or encryptedGroupKeys");
  }
  const group = await requireGroupOwner(body.groupId, user, fail, res);
  if (!group) return;

  const newVersion = Math.max(...body.encryptedGroupKeys.map((k) => Number(k.version ?? 0)), 0);

  // delete old group_keys docs not in keyVersionsToKeep
  const keep = new Set((body.keyVersionsToKeep ?? []).map(Number));
  const existing = await listDocuments(DB, "group_keys", [Query.equal("groupId", [body.groupId])]);
  for (const doc of existing?.json?.documents ?? []) {
    if (!keep.has(Number(doc.groupKeyVersion))) {
      await deleteDocument(DB, "group_keys", doc.$id);
    }
  }

  // create the new encrypted group keys per member
  const memberIds = await groupMemberIds(body.groupId);
  for (const k of body.encryptedGroupKeys) {
    if (!k?.userId || !k?.encryptedGroupKey) continue;
    const docId = toDocId(`k${body.groupId.slice(0, 10)}${k.userId.slice(0, 10)}v${k.version}`);
    const perms = [...ownerPermissions(k.userId), ...memberIds.filter((m) => m !== k.userId).map((m) => `read("user:${m}")`)];
    const created = await createDocument(DB, "group_keys", {
      documentId: docId,
      data: {
        groupId: body.groupId,
        memberUserId: k.userId,
        ownerUserId: user.id,
        groupKeyVersion: Number(k.version ?? newVersion),
        memberKeyVersion: Number(k.memberKeyVersion ?? 0),
        encryptedGroupKey: k.encryptedGroupKey,
      },
      permissions: perms,
    });
    if (!created.ok && created.status !== 409) log(`group key v${k.version} for ${k.userId} failed: ${created.status}`);
  }

  // update the group doc: new key version + group data
  const groupData = { groupKeyVersion: newVersion };
  if (typeof body.groupData === "string") groupData.resourceData = body.groupData;
  await updateDocument(DB, "groups", group.$id, groupData);

  // update place data if provided
  for (const p of body.places ?? []) {
    if (!p?.placeId || typeof p?.placeData !== "string") continue;
    await updateDocument(DB, "places", p.placeId, { resourceData: p.placeData }).catch(() => {});
  }

  log(`group keys rotated to v${newVersion} for ${body.groupId} (keep: ${[...keep].join(",") || "none"})`);
  return ok(res, {});
}

/** POST /keys/member */
export async function keysUpdateMember({ req, res, log, user }) {
  const body = readBody(req);
  const missing = ["groupId", "signedPublicKey", "encryptedMemberPersonalKeys"].filter((k) => typeof body?.[k] !== "string" || !body[k]);
  if (missing.length) {
    return fail(res, 400, "validation_error", `Missing fields: ${missing.join(", ")}`);
  }

  // caller rotates their OWN key material
  const memberKeyVersion = Number(body.userKeyVersion ?? 0);
  const existing = await listDocuments(DB, "group_member_keys", [
    Query.equal("groupId", [body.groupId]),
    Query.equal("ownerUserId", [user.id]),
  ]);
  const oldDocs = existing?.json?.documents ?? [];
  const oldDoc = oldDocs.sort((a, b) => Number(b.memberKeyVersion) - Number(a.memberKeyVersion))[0];

  // create new version doc
  const created = await createDocument(DB, "group_member_keys", {
    documentId: toDocId(`mk${body.groupId.slice(0, 10)}${user.id.slice(0, 10)}v${memberKeyVersion}`),
    data: {
      groupId: body.groupId,
      ownerUserId: user.id,
      memberKeyVersion,
      signedMembershipPublicKey: body.signedPublicKey,
      signedMemberKxPublicKey: body.signedPublicKey,
      ownerIdentityKey: oldDoc?.ownerIdentityKey ?? user.id,
    },
    permissions: [
      ...ownerPermissions(user.id),
      ...(await groupMemberIds(body.groupId)).filter((m) => m !== user.id).map((m) => `read("user:${m}")`),
    ],
  });
  if (!created.ok && created.status !== 409) {
    log(`member key rotation create failed: ${created.status}`);
    return fail(res, 500, "general_error", "Failed to rotate member keys");
  }

  // prune old versions not in memberKeyVersionsToKeep
  const keep = new Set((body.memberKeyVersionsToKeep ?? []).map(Number));
  for (const doc of oldDocs) {
    if (!keep.has(Number(doc.memberKeyVersion))) {
      await deleteDocument(DB, "group_member_keys", doc.$id);
    }
  }

  // update member resourceData if provided
  if (typeof body.memberData === "string") {
    const members = await listDocuments(DB, "group_members", [
      Query.equal("groupId", [body.groupId]),
      Query.equal("ownerUserId", [user.id]),
      Query.limit(2),
    ]);
    const memberDoc = members?.json?.documents?.[0];
    if (memberDoc) await updateDocument(DB, "group_members", memberDoc.$id, { resourceData: body.memberData, memberKeyVersion });
  }

  // update the member's settings integrity
  const settings = await listDocuments(DB, "group_settings", [
    Query.equal("groupId", [body.groupId]),
    Query.equal("ownerUserId", [user.id]),
  ]);
  const settingsDoc = settings?.json?.documents?.[0];
  if (settingsDoc && typeof body.integrity === "string") {
    await updateDocument(DB, "group_settings", settingsDoc.$id, {
      memberIntegrity: body.integrity,
      memberIntegrityUserKeyVersion: memberKeyVersion,
    });
  }

  log(`member keys rotated to v${memberKeyVersion} for ${user.id} in ${body.groupId}`);
  return ok(res, {});
}

/** POST /keys/location */
export async function keysUpdateLocation({ req, res, log, user }) {
  const body = readBody(req);
  const loc = body?.locationData;
  if (!loc?.locationId || !loc?.deviceId) {
    return fail(res, 400, "validation_error", "Missing locationData.locationId or deviceId");
  }

  // caller must own the location doc
  const locDocs = await listDocuments(DB, "locations", [Query.equal("$id", [loc.locationId])]);
  const locDoc = locDocs?.json?.documents?.[0];
  if (!locDoc) return fail(res, 404, "not_found", "Location doc not found");
  const perm = `read("user:${user.id}")`;
  if (!(locDoc.$permissions || []).some((p) => p.includes(`user:${user.id}`))) {
    return fail(res, 403, "forbidden", "Not your location doc");
  }

  // update the location doc with new encrypted data + bumped device key version
  const existingDeviceKeys = await listDocuments(DB, "group_device_keys", [
    Query.equal("groupId", [body.groupId]),
    Query.equal("memberUserId", [user.id]),
  ]);
  const deviceKeyVersion = Math.max(
    ...(existingDeviceKeys?.json?.documents ?? []).map((d) => Number(d.deviceKeyVersion ?? 0)),
    Number(locDoc.deviceKeyVersion ?? 0),
  ) + 1;

  await updateDocument(DB, "locations", loc.locationId, {
    deviceKeyVersion,
    deviceData: loc.deviceData ?? null,
    locationData: loc.locationData ?? null,
    status: loc.status ?? null,
    locationHistory: loc.locationHistory ?? null,
  });

  // distribute new sender keys
  for (const k of loc.encryptedSenderKeys ?? []) {
    if (!k?.userId || !k?.encryptedSenderKey) continue;
    const created = await createDocument(DB, "group_device_keys", {
      documentId: toDocId(`dk${body.groupId.slice(0, 10)}${k.userId.slice(0, 10)}${deviceKeyVersion}`),
      data: {
        groupId: body.groupId,
        memberUserId: k.userId,
        ownerUserId: user.id,
        locationId: loc.locationId,
        memberKeyVersion: Number(k.memberKeyVersion ?? 0),
        deviceKeyVersion,
        encryptedSenderKey: k.encryptedSenderKey,
      },
      permissions: [...ownerPermissions(k.userId), `read("user:${user.id}")`],
    });
    if (!created.ok && created.status !== 409) log(`sender key for ${k.userId} failed: ${created.status}`);
  }

  log(`location keys rotated to deviceKeyVersion ${deviceKeyVersion} for ${user.id} in ${body.groupId}`);
  return ok(res, {});
}

/** POST /keys/space — personal space sender key rotation (PersonalDeviceKeyUpdatePayload). */
export async function keysUpdateSpace({ req, res, log, user }) {
  const body = readBody(req);
  if (typeof body?.deviceId !== "string") {
    return fail(res, 400, "validation_error", "Missing deviceId");
  }

  // update the personal location doc with the new sender key + fresh data
  const locUpd = await updateDocument(DB, "personal_locations", toDocId(body.deviceId), {
    locationData: body.locationData ?? null,
    status: body.status ?? null,
    locationHistory: body.locationHistory ?? null,
  }).catch(() => null);

  // update the device doc sender key
  const devices = await listDocuments(DB, "devices", [
    Query.equal("ownerUserId", [user.id]),
    Query.equal("deviceId", [body.deviceId]),
    Query.limit(2),
  ]);
  const deviceDoc = devices?.json?.documents?.[0];
  if (deviceDoc) {
    await updateDocument(DB, "devices", deviceDoc.$id, {
      encryptedSenderKey: body.encryptedSenderKey ?? null,
      userKeyVersion: Number(body.userKeyVersion ?? 0),
      deviceData: body.deviceData ?? null,
    });
  } else {
    await createDocument(DB, "devices", {
      documentId: toDocId(body.deviceId),
      data: {
        ownerUserId: user.id,
        deviceId: body.deviceId,
        deviceType: "phone",
        pushProvider: "unknown",
        encryptedSenderKey: body.encryptedSenderKey ?? null,
        userKeyVersion: Number(body.userKeyVersion ?? 0),
        deviceData: body.deviceData ?? null,
      },
      permissions: ownerPermissions(user.id),
    });
  }

  log(`personal space keys rotated for device ${body.deviceId}`);
  return ok(res, {});
}
