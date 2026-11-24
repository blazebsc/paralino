/**
 * Group lifecycle routes: update, delete, block.
 *
 * GROUP_UPDATE (PATCH /groups): UpdateGroupPayload { groupId, groupData }
 *   → updates the group doc resourceData. Caller must be the owner.
 *   Returns the updated GroupDocumentRaw map (client parses it).
 *
 * GROUP_DELETE (DELETE /groups): body = groupId (raw string)
 *   → deletes the group doc + all related docs (members, settings, keys,
 *     locations, places, privacy zones, device keys, history). Owner only.
 *   Returns {}.
 *
 * GROUP_BLOCK (PUT /groups/block): BlockGroupFunctionData
 *   { groupId, groupData, userKeyVersion }
 *   → a NON-owner member blocks the group: removes their member doc + keys,
 *     creates a blocked entry. Returns {}.
 *
 * MEMBER_BLOCK (PUT /members/block): BlockGroupMemberFunctionData
 *   { groupId, userId, userData, userKeyVersion }
 *   → the group owner blocks a member: removes their member doc + keys,
 *     creates a blocked entry for the owner. Returns {}.
 */

import { ok, fail, readBody } from "../lib/envelope.js";
import { createDocument, updateDocument, deleteDocument, listDocuments, Query, ownerPermissions, toDocId } from "../lib/appwrite.js";

const DB = "data_main";

export async function groupUpdate({ req, res, log, user }) {
  const body = readBody(req);
  if (typeof body?.groupId !== "string" || typeof body?.groupData !== "string") {
    return fail(res, 400, "validation_error", "Missing groupId or groupData");
  }

  const groups = await listDocuments(DB, "groups", [Query.equal("$id", [body.groupId])]);
  const group = groups?.json?.documents?.[0];
  if (!group) return fail(res, 404, "not_found", "Group not found");

  const upd = await updateDocument(DB, "groups", body.groupId, { resourceData: body.groupData });
  if (!upd.ok) {
    log(`group update failed: ${upd.status}`);
    return fail(res, 500, "general_error", "Failed to update group");
  }
  return ok(res, upd.json);
}

/** Delete all docs belonging to a group across collections. */
async function wipeGroupDocs(groupId, log) {
  const collections = [
    "group_members", "group_settings", "group_keys", "group_member_keys",
    "group_device_keys", "group_history", "group_history_keys",
    "locations", "places", "places_settings", "privacy_zones",
  ];
  let deleted = 0;
  for (const col of collections) {
    const attrs = col === "locations" ? "groupId" : "groupId";
    const docs = await listDocuments(DB, col, [Query.equal(attrs, [groupId])]).catch(() => null);
    for (const d of docs?.json?.documents ?? []) {
      await deleteDocument(DB, col, d.$id).catch(() => {});
      deleted++;
    }
  }
  const group = await deleteDocument(DB, "groups", toDocId(`g${groupId}`)).catch(() => null);
  if (!group?.ok) {
    // try the raw id in case it's stored without prefix
    await deleteDocument(DB, "groups", groupId).catch(() => {});
  }
  log(`group ${groupId} wiped: ${deleted} docs removed`);
  return deleted;
}

export async function groupDelete({ req, res, log, user }) {
  const groupId = typeof readBody(req) === "string" ? readBody(req) : readBody(req)?.groupId;
  if (!groupId) return fail(res, 400, "validation_error", "Missing groupId");

  const groups = await listDocuments(DB, "groups", [Query.equal("$id", [groupId])]);
  const group = groups?.json?.documents?.[0];
  if (!group) return fail(res, 404, "not_found", "Group not found");
  if (group.data?.ownerUserId !== user.id) {
    return fail(res, 403, "forbidden", "Only the group owner can delete the group");
  }

  await wipeGroupDocs(groupId, log);
  return ok(res, {});
}

export async function groupBlock({ req, res, log, user }) {
  const body = readBody(req);
  if (typeof body?.groupId !== "string" || typeof body?.groupData !== "string") {
    return fail(res, 400, "validation_error", "Missing groupId or groupData");
  }

  // create blocked entry
  await createDocument(DB, "blocked", {
    documentId: newId(),
    data: {
      ownerUserId: user.id,
      resourceId: body.groupId,
      resourceType: "group",
      data: body.groupData,
      userKeyVersion: Number(body.userKeyVersion ?? 0),
    },
    permissions: ownerPermissions(user.id),
  });

  // remove the caller's member doc + keys (leaving the group)
  const members = await listDocuments(DB, "group_members", [
    Query.equal("groupId", [body.groupId]),
    Query.equal("ownerUserId", [user.id]),
  ]);
  for (const m of members?.json?.documents ?? []) {
    await deleteDocument(DB, "group_members", m.$id).catch(() => {});
    // remove their group keys
    const keys = await listDocuments(DB, "group_keys", [
      Query.equal("groupId", [body.groupId]),
      Query.equal("memberUserId", [user.id]),
    ]);
    for (const k of keys?.json?.documents ?? []) {
      await deleteDocument(DB, "group_keys", k.$id).catch(() => {});
    }
    // remove their settings
    await deleteDocument(DB, "group_settings", m.$id).catch(() => {});
  }

  log(`group ${body.groupId} blocked by ${user.id}`);
  return ok(res, {});
}

export async function memberBlock({ req, res, log, user }) {
  const body = readBody(req);
  if (typeof body?.groupId !== "string" || typeof body?.userId !== "string") {
    return fail(res, 400, "validation_error", "Missing groupId or userId");
  }

  // create blocked entry for the owner
  await createDocument(DB, "blocked", {
    documentId: newId(),
    data: {
      ownerUserId: user.id,
      resourceId: body.userId,
      resourceType: "member",
      data: body.userData ?? null,
      userKeyVersion: Number(body.userKeyVersion ?? 0),
    },
    permissions: ownerPermissions(user.id),
  });

  // remove the blocked member's docs
  const members = await listDocuments(DB, "group_members", [
    Query.equal("groupId", [body.groupId]),
    Query.equal("ownerUserId", [body.userId]),
  ]);
  for (const m of members?.json?.documents ?? []) {
    await deleteDocument(DB, "group_members", m.$id).catch(() => {});
    const keys = await listDocuments(DB, "group_keys", [
      Query.equal("groupId", [body.groupId]),
      Query.equal("memberUserId", [body.userId]),
    ]);
    for (const k of keys?.json?.documents ?? []) {
      await deleteDocument(DB, "group_keys", k.$id).catch(() => {});
    }
    await deleteDocument(DB, "group_settings", m.$id).catch(() => {});
  }

  log(`member ${body.userId} blocked from ${body.groupId} by ${user.id}`);
  return ok(res, {});
}

function newId() {
  return toDocId(crypto.randomUUID().replaceAll("-", "").slice(0, 32));
}
