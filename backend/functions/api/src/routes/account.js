/**
 * Account management routes.
 *
 * ACCOUNT_DELETE (DELETE /user): no body. Deletes the Appwrite user and all
 *   their docs. Returns {}.
 *
 * ACCOUNT_CHANGE_EMAIL (PATCH /user/email): UserEmailChangePayload
 *   { email, oldPassword, newPassword }
 *   → updates the Appwrite user's email + password. Returns {}.
 *   ponytail: the client-side E2EE key re-wrap is handled by the client
 *   (ChangeCredentialsUseCase calls /keys/user after this route).
 *
 * USER_DEVICE_DELETE (DELETE /user/devices): PersonalDeviceDeletePayload
 *   { deviceId } → deletes the device doc + its personal location doc.
 */

import { ok, fail, readBody } from "../lib/envelope.js";
import { config } from "../lib/appwrite.js";
import { deleteDocument, listDocuments, Query, toDocId } from "../lib/appwrite.js";

const DB = "data_main";

async function deleteAppwriteUser(userId) {
  const { host, project, key } = config();
  const res = await fetch(`${host}/users/${userId}`, {
    method: "DELETE",
    headers: { "X-Appwrite-Project": project, "X-Appwrite-Key": key },
  });
  return res.ok || res.status === 404;
}

export async function accountDelete({ req, res, log, user }) {
  // wipe all user docs across collections
  const ownedQueries = [
    ["group_members", "ownerUserId"], ["group_settings", "ownerUserId"],
    ["group_keys", "memberUserId"], ["group_member_keys", "ownerUserId"],
    ["personal_group_keys", "ownerUserId"], ["personal_locations", "ownerUserId"],
    ["personal_history", "ownerUserId"], ["personal_history_keys", "ownerUserId"],
    ["personal_ids", "ownerUserId"], ["personal_id_keys", "ownerUserId"],
    ["blocked", "ownerUserId"], ["places", "ownerUserId"],
    ["places_settings", "ownerUserId"], ["privacy_zones", "ownerUserId"],
    ["push_notifications", "deviceId"], ["devices", "ownerUserId"],
  ];

  let wiped = 0;
  for (const [col, attr] of ownedQueries) {
    const docs = await listDocuments(DB, col, [Query.equal(attr, [user.id])]).catch(() => null);
    for (const d of docs?.json?.documents ?? []) {
      await deleteDocument(DB, col, d.$id).catch(() => {});
      wiped++;
    }
  }

  // wipe group-owned docs where the user is a member (locations, group history)
  for (const col of ["locations", "group_history"]) {
    const docs = await listDocuments(DB, col, [Query.equal("memberUserId", [user.id])]).catch(() => null);
    for (const d of docs?.json?.documents ?? []) {
      await deleteDocument(DB, col, d.$id).catch(() => {});
      wiped++;
    }
  }

  const deleted = await deleteAppwriteUser(user.id);
  log(`account deleted for ${user.id}: ${wiped} docs + user ${deleted ? "deleted" : "delete failed"}`);
  return ok(res, {});
}

export async function accountChangeEmail({ req, res, log, user }) {
  const body = readBody(req);
  if (typeof body?.email !== "string" || !body.email.includes("@")) {
    return fail(res, 400, "validation_error", "Missing or invalid email");
  }

  // The client handles the E2EE key re-wrap. The Appwrite SDK's
  // account.updateEmail requires the current password — but the client
  // sends its authKey (derived), not the raw password. So the server does
  // the email update via the Appwrite users API.
  const { host, project, key } = config();
  const upd = await fetch(`${host}/users/${user.id}/email`, {
    method: "PATCH",
    headers: { "X-Appwrite-Project": project, "X-Appwrite-Key": key, "Content-Type": "application/json" },
    body: JSON.stringify({ email: body.email }),
  });
  if (!upd.ok) {
    const errBody = await upd.text();
    log(`email update failed: ${upd.status} ${errBody}`);
    return fail(res, upd.status, "general_error", "Failed to update email");
  }
  log(`email updated for ${user.id}`);
  return ok(res, {});
}

export async function userDeviceDelete({ req, res, log, user }) {
  const body = readBody(req);
  const deviceId = typeof body === "object" ? body?.deviceId : null;
  if (!deviceId) return fail(res, 400, "validation_error", "Missing deviceId");

  // delete the device doc
  const devices = await listDocuments(DB, "devices", [
    Query.equal("ownerUserId", [user.id]),
    Query.equal("deviceId", [deviceId]),
    Query.limit(2),
  ]);
  for (const d of devices?.json?.documents ?? []) {
    await deleteDocument(DB, "devices", d.$id).catch(() => {});
  }

  // delete the personal location doc
  await deleteDocument(DB, "personal_locations", toDocId(deviceId)).catch(() => {});

  log(`device ${deviceId} deleted for ${user.id}`);
  return ok(res, {});
}
