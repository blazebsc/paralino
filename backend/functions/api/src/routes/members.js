/**
 * Group member routes.
 *
 * MEMBER_CREATE (PUT /members) — the group owner adds a member using the
 * invitee's personal-code key material. All key blobs arrive pre-encrypted
 * for the invitee (the owner encrypted the group key with the invitee's
 * kx public key from their pre-key bundle).
 *
 * MEMBER_UPDATE (PATCH /members) — member data / key version updates
 * (UpdateMemberFunctionPayload { data: [{ memberId, groupKeyVersion, memberData }] }).
 *
 * MEMBER_DELETE (DELETE /members) — removes the member and their key docs.
 *
 * Settings doc id == member doc id (client convention).
 */

import { ok, fail, readBody } from "../lib/envelope.js";
import { Query, createDocument, deleteDocument, listDocuments, newId, ownerPermissions, toDocId, updateDocument } from "../lib/appwrite.js";
import { wakeDevices } from "../lib/push.js";

const DB = "data_main";


export async function memberCreate({ req, res, log, user }) {
  const body = readBody(req);
  const missing = ["groupId", "memberVerification", "memberSignedPublicKey", "memberIdentityKey", "memberData", "serverIntegrity"]
    .filter((k) => typeof body[k] !== "string" || !body[k]);
  if (missing.length) {
    log(`members 400: missing=${JSON.stringify(missing)}`);
    return fail(res, 400, "validation_error", `Missing fields: ${missing.join(", ")}`);
  }
  const userToAddId = body.userToAddId;
  if (typeof userToAddId !== "string" || !userToAddId) {
    return fail(res, 400, "validation_error", "Missing userToAddId");
  }

  // caller must own the group
  const groups = await listDocuments(DB, "groups", [
    Query.equal("$id", [body.groupId]),
    Query.equal("ownerUserId", [user.id]),
    Query.limit(2),
  ]);
  const group = groups?.json?.documents?.[0];
  if (!group) {
    return fail(res, 403, "forbidden", "Only the group owner can add members");
  }

  const groupKeyVersion = Number(body.groupKeyVersion ?? group.data?.groupKeyVersion ?? 1);
  const memberKeyVersion = Number(body.userKeyVersion ?? 0);

  // 1. the member doc — readable by the invitee AND the owner
  const memberPerms = [
    ...ownerPermissions(userToAddId),
    `read("user:${user.id}")`,
    `update("user:${user.id}")`,
    `delete("user:${user.id}")`,
  ];
  const member = await createDocument(DB, "group_members", {
    documentId: newId(),
    data: {
      ownerUserId: userToAddId,
      groupId: body.groupId,
      groupKeyVersion,
      memberKeyVersion,
      verification: body.memberVerification,
      resourceData: body.memberData,
      paralinoId: body.paralinoId ?? null,
      locationIds: [],
    },
    permissions: memberPerms,
  });
  if (!member.ok) {
    log(`member doc create failed: ${member.status} ${JSON.stringify(member.json)}`);
    return fail(res, 500, "general_error", "Failed to create member doc");
  }

  // 2. group key re-encrypted for the invitee — readable by invitee + owner
  const groupKeys = Array.isArray(body.groupKeys) ? body.groupKeys : [];
  for (const k of groupKeys) {
    if (!k?.encryptedGroupKey) continue;
    const created = await createDocument(DB, "group_keys", {
      documentId: toDocId(`k${body.groupId.slice(0, 10)}${userToAddId.slice(0, 10)}v${k.version}`),
      data: {
        groupId: body.groupId,
        memberUserId: userToAddId,
        ownerUserId: user.id,
        groupKeyVersion: Number(k.version ?? 1),
        memberKeyVersion,
        encryptedGroupKey: k.encryptedGroupKey,
      },
      permissions: [
        ...ownerPermissions(userToAddId),
        `read("user:${user.id}")`,
      ],
    });
    if (!created.ok) log(`group key v${k.version} for invitee failed: ${created.status}`);
  }

  // 3. the invitee's public key material — readable by all group members
  const memberKeys = await createDocument(DB, "group_member_keys", {
    documentId: toDocId(`mk${body.groupId.slice(0, 10)}${userToAddId.slice(0, 10)}v${memberKeyVersion}`),
    data: {
      groupId: body.groupId,
      ownerUserId: userToAddId,
      memberKeyVersion,
      signedMembershipPublicKey: body.memberSignedPublicKey,
      signedMemberKxPublicKey: body.memberSignedPublicKey,
      ownerIdentityKey: body.memberIdentityKey,
    },
    permissions: [...memberPerms],
  });
  if (!memberKeys.ok) log(`member keys create failed: ${memberKeys.status}`);

  // 4. settings doc — id == member doc id (client convention)
  const settings = await createDocument(DB, "group_settings", {
    documentId: member.json.$id,
    data: {
      ownerUserId: userToAddId,
      groupId: body.groupId,
      memberIntegrity: body.groupOwnerIntegrity,
      groupIntegrity: body.groupOwnerIntegrity,
      memberIntegrityUserKeyVersion: memberKeyVersion,
      groupIntegrityUserKeyVersion: memberKeyVersion,
      batteryAlertSettings: null,
    },
    permissions: memberPerms,
  });
  if (!settings.ok) log(`settings create failed: ${settings.status}`);

  // 5. the invitee must be able to read the group doc
  const groupPerms = [...(group.$permissions ?? [])];
  const readPerm = `read("user:${userToAddId}")`;
  if (!groupPerms.includes(readPerm)) {
    const upd = await updateDocument(DB, "groups", group.$id, {}, [
      ...groupPerms,
      readPerm,
      `update("user:${user.id}")`,
      `delete("user:${user.id}")`,
    ]);
    if (!upd.ok) log(`group perms update failed: ${upd.status}`);
  }

  // 6. membership metadata is group-readable. Clients read each other's
  // key material / member data / integrity blobs directly from the database
  // to verify signatures and decrypt group keys — every member needs read
  // on every member's docs. Secrets (encrypted group keys, personal keys)
  // stay per-user.
  const membersList = await listDocuments(DB, "group_members", [
    Query.equal("groupId", [body.groupId]),
    Query.limit(100),
  ]);
  const memberUserIds = [...new Set([
    ...(membersList?.json?.documents ?? []).map((m) => m.data?.ownerUserId ?? m.ownerUserId),
    user.id,
  ])];
  for (const col of ["group_member_keys", "group_members", "group_settings"]) {
    const docs = await listDocuments(DB, col, [
      Query.equal("groupId", [body.groupId]),
      Query.limit(100),
    ]);
    for (const d of docs?.json?.documents ?? []) {
      const perms = [...(d.$permissions ?? [])];
      let changed = false;
      for (const uid of memberUserIds) {
        const readPerm = `read("user:${uid}")`;
        if (!perms.includes(readPerm)) {
          perms.push(readPerm);
          changed = true;
        }
      }
      if (changed) {
        const upd = await updateDocument(DB, col, d.$id, {}, perms);
        if (!upd.ok) log(`perm update failed: ${col} ${d.$id.slice(0, 8)} ${upd.status}`);
      }
    }
  }

  log(`member ${userToAddId} added to ${body.groupId} by ${user.id} (memberKeyVersion ${memberKeyVersion})`);
  wakeDevices(log, [userToAddId]);
  return ok(res, {});
}

export async function memberUpdate({ req, res, log, user }) {
  const body = readBody(req);
  const updates = Array.isArray(body?.data) ? body.data : [];
  let updated = 0;
  for (const u of updates) {
    if (!u?.memberId) continue;
    const data = {};
    if (typeof u.memberData === "string") data.resourceData = u.memberData;
    if (Number.isInteger(u.groupKeyVersion)) data.groupKeyVersion = u.groupKeyVersion;
    if (!Object.keys(data).length) continue;
    const upd = await updateDocument(DB, "group_members", u.memberId, data);
    if (upd.ok) updated++;
    else log(`member ${u.memberId} update failed: ${upd.status}`);
  }
  return ok(res, { updated });
}

export async function memberDelete({ req, res, log, user }) {
  const body = readBody(req);
  const groupId = typeof body === "object" ? body?.groupId : null;
  const userId = typeof body === "object" ? body?.userId : null;
  if (!groupId || !userId) {
    return fail(res, 400, "validation_error", "Missing groupId or userId");
  }

  // find the member doc
  const members = await listDocuments(DB, "group_members", [
    Query.equal("groupId", [groupId]),
    Query.equal("ownerUserId", [userId]),
    Query.limit(2),
  ]);
  const memberDoc = members?.json?.documents?.[0];
  if (!memberDoc) return fail(res, 404, "not_found", "Member not found");

  // remove their group keys
  const keys = await listDocuments(DB, "group_keys", [
    Query.equal("groupId", [groupId]),
    Query.equal("memberUserId", [userId]),
  ]);
  for (const k of keys?.json?.documents ?? []) {
    await deleteDocument(DB, "group_keys", k.$id);
  }

  // remove their public key material + settings
  const memberKeys = await listDocuments(DB, "group_member_keys", [
    Query.equal("groupId", [groupId]),
    Query.equal("ownerUserId", [userId]),
  ]);
  for (const k of memberKeys?.json?.documents ?? []) {
    await deleteDocument(DB, "group_member_keys", k.$id);
  }
  await deleteDocument(DB, "group_settings", memberDoc.$id).catch(() => {});

  // remove the member doc
  await deleteDocument(DB, "group_members", memberDoc.$id);

  log(`member ${userId} removed from ${groupId} by ${user.id}`);
  return ok(res, {});
}
