/**
 * POST /groups  (ServerFunction.GROUP_CREATE)
 *
 * Client caller: core-domain/.../domain/group/GroupCreateUseCase.createGroupImpl
 *
 * Request body: CreateGroupPayload
 *   { encryptedGroupKey, signedPublicKey, ownerIdentityKey,
 *     groupMemberIntegrity, userKeyVersion, serverIntegrity, encryptedUserKeys,
 *     keyId, memberVerification, groupData, memberData, paralinoId? }
 * All *Data/*Key fields are client-side ciphertext (E2EE) — the server never
 * sees plaintext group names or member data.
 *
 * Response data: { groupId } — the client re-fetches everything directly.
 *
 * Server-side writes (single-database mode, all owner-readable):
 *   groups             the group document
 *   group_members      the creator as first member
 *   group_settings     per-member integrity settings (recovery path checks
 *                      settingsRaw.groupIntegrity == payload.groupMemberIntegrity)
 *   group_keys         the group key encrypted for the creator
 *   group_member_keys  the creator's signed public key material
 *   personal_group_keys  the creator's encrypted keypair (multi-device unlock)
 *
 * ponytail: no limit enforcement — plan limits are unlimited in the fork and
 * enforced client-side anyway. Group key version starts at 1; the client
 * aligns its local state from the server after creation.
 */

import { ok, fail, readBody } from "../lib/envelope.js";
import { createDocument, ownerPermissions, toDocId } from "../lib/appwrite.js";

const DB = "data_main";

const REQUIRED = [
  "encryptedGroupKey", "signedPublicKey", "ownerIdentityKey", "groupMemberIntegrity",
  "serverIntegrity", "encryptedUserKeys", "keyId", "memberVerification",
  "groupData", "memberData",
];

function newId() {
  return toDocId(crypto.randomUUID().replaceAll("-", "").slice(0, 32));
}

export async function groupCreate({ req, res, log, user }) {
  const body = readBody(req);

  const missing = REQUIRED.filter((k) => typeof body[k] !== "string" || !body[k]);
  if (missing.length) {
    log(`groups 400: missing=${JSON.stringify(missing)}`);
    return fail(res, 400, "validation_error", `Missing fields: ${missing.join(", ")}`);
  }
  const userKeyVersion = Number(body.userKeyVersion);
  if (!Number.isInteger(userKeyVersion) || userKeyVersion < 0) {
    return fail(res, 400, "validation_error", "userKeyVersion must be a non-negative integer");
  }

  const groupId = newId();
  const GROUP_KEY_VERSION = 1;
  const schemeVersion = "1.0"; // AppPrefs.supportedGroupEncryptionScheme

  const ownerPerms = ownerPermissions(user.id);

  // 1. the group
  const group = await createDocument(DB, "groups", {
    documentId: toDocId(`g${groupId}`),
    data: {
      ownerUserId: user.id,
      groupKeyVersion: GROUP_KEY_VERSION,
      resourceData: body.groupData,
      serverIntegrity: body.serverIntegrity,
      schemeVersion,
      planType: "free",
      fallbackPlanType: "free",
      provider: null,
      planExpiresAt: null,
      groupPlans: [],
    },
    permissions: ownerPerms,
  });
  if (!group.ok) {
    log(`group create failed: ${group.status} ${JSON.stringify(group.json)}`);
    return fail(res, 500, "general_error", "Failed to create group");
  }

  // 2. the creator as first member
  const member = await createDocument(DB, "group_members", {
    documentId: toDocId(`m${groupId}${user.id.slice(0, 12)}`),
    data: {
      ownerUserId: user.id,
      groupId: group.$id,
      groupKeyVersion: GROUP_KEY_VERSION,
      memberKeyVersion: userKeyVersion,
      verification: body.memberVerification,
      resourceData: body.memberData,
      paralinoId: body.paralinoId ?? null,
      locationIds: [],
    },
    permissions: ownerPerms,
  });
  if (!member.ok) log(`member create failed: ${member.status}`);

  // 3. per-member settings — groupIntegrity is checked on the recovery path
  const settings = await createDocument(DB, "group_settings", {
    documentId: toDocId(`s${groupId}${user.id.slice(0, 12)}`),
    data: {
      ownerUserId: user.id,
      groupId: group.$id,
      memberIntegrity: body.memberVerification,
      groupIntegrity: body.groupMemberIntegrity,
      memberIntegrityUserKeyVersion: userKeyVersion,
      groupIntegrityUserKeyVersion: userKeyVersion,
      batteryAlertSettings: null,
    },
    permissions: ownerPerms,
  });
  if (!settings.ok) log(`settings create failed: ${settings.status}`);

  // 4. the group key encrypted for the creator
  const groupKey = await createDocument(DB, "group_keys", {
    documentId: toDocId(`k${groupId}${user.id.slice(0, 12)}`),
    data: {
      groupId: group.$id,
      memberUserId: user.id,
      ownerUserId: user.id,
      groupKeyVersion: GROUP_KEY_VERSION,
      memberKeyVersion: userKeyVersion,
      encryptedGroupKey: body.encryptedGroupKey,
    },
    permissions: ownerPerms,
  });
  if (!groupKey.ok) log(`group key create failed: ${groupKey.status}`);

  // 5. the creator's signed public key material (membership + key exchange)
  const memberKey = await createDocument(DB, "group_member_keys", {
    documentId: toDocId(`mk${groupId}${user.id.slice(0, 12)}`),
    data: {
      groupId: group.$id,
      ownerUserId: user.id,
      memberKeyVersion: userKeyVersion,
      signedMembershipPublicKey: body.signedPublicKey,
      signedMemberKxPublicKey: body.signedPublicKey,
      ownerIdentityKey: body.ownerIdentityKey,
    },
    permissions: ownerPerms,
  });
  if (!memberKey.ok) log(`member key create failed: ${memberKey.status}`);

  // 6. the creator's encrypted keypair (unlock on other devices)
  const personalKey = await createDocument(DB, "personal_group_keys", {
    documentId: toDocId(`pk${groupId}${user.id.slice(0, 12)}`),
    data: {
      ownerUserId: user.id,
      encryptedUserKeys: body.encryptedUserKeys,
      groupId: group.$id,
      personalGroupKeyVersion: GROUP_KEY_VERSION,
      userKeyVersion,
      isArchived: false,
    },
    permissions: ownerPerms,
  });
  if (!personalKey.ok) log(`personal group key create failed: ${personalKey.status}`);

  log(`group ${group.$id} created for ${user.id} (key v1, userKey v${userKeyVersion})`);
  return ok(res, { groupId: group.$id });
}
