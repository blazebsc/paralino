/**
 * Personal code (Paralino ID) routes.
 *
 * A personal code is an 8-char user-facing string. From it the client derives
 * `keyId` (= loginPassword, the lookup key) and `backupPassword` (which
 * encrypts all code payloads). The server only ever sees ciphertext.
 *
 * personal_ids doc:        { keyId, ownerUserId, encryptedCode,
 *                            encryptedCodeUserData, userKeyVersion }
 * personal_id_keys docs:   pre-key bundles — { ownerUserId, encryptedUserKeys,
 *                            integrity, userKeyVersion, keyId,
 *                            encryptedCodeKeyData }
 * `encryptedCodeKeyData` is blanked when consumed (one-time pre-keys); the
 * client restocks via POST /keys/personal_code.
 */

import { ok, fail, readBody } from "../lib/envelope.js";
import { createDocument, updateDocument, deleteDocument, listDocuments, Query, ownerPermissions, toDocId } from "../lib/appwrite.js";

const DB = "data_main";

export async function personalCodeCreate({ req, res, log, user }) {
  const body = readBody(req);
  const missing = ["keyId", "encryptedCodeUserData", "encryptedCode"].filter((k) => typeof body[k] !== "string" || !body[k]);
  if (missing.length) {
    return fail(res, 400, "validation_error", `Missing fields: ${missing.join(", ")}`);
  }

  // revoke any previous code (one active code per user)
  await revokeFor(user.id, log);

  const code = await createDocument(DB, "personal_ids", {
    documentId: toDocId(`pc${body.keyId.slice(0, 30)}`),
    data: {
      keyId: body.keyId,
      ownerUserId: user.id,
      encryptedCode: body.encryptedCode,
      encryptedCodeUserData: body.encryptedCodeUserData,
      userKeyVersion: Number(body.userKeyVersion ?? 0),
    },
    permissions: ownerPermissions(user.id),
  });
  if (!code.ok) {
    log(`personal_ids create failed: ${code.status} ${JSON.stringify(code.json)}`);
    return fail(res, 500, "general_error", "Failed to create personal code");
  }

  await storePreKeys(user.id, body.keys, log);
  log(`personal code ${body.keyId.slice(0, 8)}… created for ${user.id}`);
  return ok(res, {});
}

export async function personalCodeUpdate({ req, res, log, user }) {
  const body = readBody(req);
  if (typeof body.keyId !== "string" || !body.keyId) {
    return fail(res, 400, "validation_error", "Missing keyId");
  }

  const docs = await listDocuments(DB, "personal_ids", [Query.equal("keyId", [body.keyId])]);
  const doc = docs?.json?.documents?.find((d) => d.ownerUserId === user.id);
  if (!doc) return fail(res, 404, "not_found", "Personal code not found");

  if (typeof body.encryptedCodeUserData === "string") {
    const upd = await updateDocument(DB, "personal_ids", doc.$id, {
      encryptedCodeUserData: body.encryptedCodeUserData,
    });
    if (!upd.ok) log(`personal_ids update failed: ${upd.status}`);
  }

  await storePreKeys(user.id, body.keys, log);
  return ok(res, {});
}

/** POST /keys/personal_code — pre-key restock (PersonalPreKeyUpdateData). */
export async function personalCodeRestock({ req, res, log, user }) {
  const body = readBody(req);
  await storePreKeys(user.id, body.keys, log);
  return ok(res, {});
}

/** DELETE /personal_code — revoke all codes + pre-keys for the caller. */
export async function personalCodeDelete({ req, res, log, user }) {
  const removed = await revokeFor(user.id, log);
  return ok(res, { removed });
}

/** POST /personal_code/read — resolve an invitee's code to their key material.
 * Consumes one pre-key (blanks encryptedCodeKeyData) — one-time use. */
export async function personalCodeRead({ req, res, log, user }) {
  const body = readBody(req);
  const keyId = typeof body === "object" && body?.keyId ? body.keyId : (typeof body === "string" ? body : null);
  if (!keyId) {
    return fail(res, 400, "validation_error", "Missing keyId");
  }

  const codes = await listDocuments(DB, "personal_ids", [Query.equal("keyId", [keyId])]);
  const codeDoc = codes?.json?.documents?.[0];
  if (!codeDoc) {
    return fail(res, 404, "not_found", "Personal code not found");
  }

  const preKeys = await listDocuments(DB, "personal_id_keys", [
    Query.equal("ownerUserId", [codeDoc.ownerUserId]),
  ]);
  // pick an unused pre-key (encryptedCodeKeyData not blanked)
  const unused = (preKeys?.json?.documents ?? []).find(
    (d) => d.encryptedCodeKeyData && String(d.encryptedCodeKeyData).length > 0,
  );
  if (!unused) {
    return fail(res, 404, "not_found", "No pre-keys available for this code");
  }

  // consume it
  await updateDocument(DB, "personal_id_keys", unused.$id, { encryptedCodeKeyData: null });

  log(`code ${keyId.slice(0, 8)}… read by ${user?.id ?? "?"} — consumed pre-key ${unused.$id.slice(0, 12)}`);
  return ok(res, {
    userId: codeDoc.ownerUserId,
    encryptedCodeUserData: codeDoc.encryptedCodeUserData,
    encryptedCodeKeyData: unused.encryptedCodeKeyData,
  });
}

async function storePreKeys(userId, keys, log) {
  if (!Array.isArray(keys)) return 0;
  let n = 0;
  for (const k of keys) {
    if (!k?.keyId || typeof k?.encryptedUserKeys !== "string") continue;
    const created = await createDocument(DB, "personal_id_keys", {
      documentId: toDocId(`pre${k.keyId.slice(0, 30)}`),
      data: {
        ownerUserId: userId,
        encryptedUserKeys: k.encryptedUserKeys,
        integrity: k.integrity ?? "",
        userKeyVersion: Number(k.userKeyVersion ?? 0),
        keyId: k.keyId,
        encryptedCodeKeyData: k.encryptedCodeKeyData ?? null,
      },
      permissions: ownerPermissions(userId),
    });
    if (created.ok) n++;
    else log(`pre-key create failed: ${created.status}`);
  }
  return n;
}

async function revokeFor(userId, log) {
  let removed = 0;
  const codes = await listDocuments(DB, "personal_ids", [Query.equal("ownerUserId", [userId])]);
  for (const d of codes?.json?.documents ?? []) {
    await deleteDocument(DB, "personal_ids", d.$id);
    removed++;
  }
  const preKeys = await listDocuments(DB, "personal_id_keys", [Query.equal("ownerUserId", [userId])]);
  for (const d of preKeys?.json?.documents ?? []) {
    await deleteDocument(DB, "personal_id_keys", d.$id);
    removed++;
  }
  if (removed) log(`revoked ${removed} code docs for ${userId}`);
  return removed;
}
