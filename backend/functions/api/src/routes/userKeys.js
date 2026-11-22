/**
 * POST /keys/user  (ServerFunction.KEYS_UPDATE_USER)
 *
 * Client caller: core-domain/.../domain/crypto/user/CryptoUserKeysRemoteSource.kt
 * Request body:  UpdateUserKeysFunctionData
 *   { encryptedPublicKey, encryptedSymmetricKey, encryptedPrivateKey, publicKey,
 *     oldMasterKeys?, loginSalt, loginAlg, dataAlg, dataSalt?, schemeVersion?,
 *     matchingKeyVersion: Long, removeOldKeys: bool }
 * Response data: full UserCryptoKeyRaw document (client re-parses it from the map,
 *   including $id, ownerUserId, userKeyVersion — server-assigned).
 *
 * Semantics (inferred from client behavior — see UserCryptoKeyRaw.checkKeysAreValid:
 * "not checking userKeyVersion since that is set on backend"):
 *   - no keys yet              -> create with version = matchingKeyVersion
 *   - latest == matching       -> idempotent re-upload, update in place
 *   - latest != matching       -> 409 conflict (client must refresh first)
 *   - removeOldKeys            -> delete all other versions after success
 *
 * All values are client-side ciphertext (E2EE) — the server never sees plaintext.
 */

import { ok, fail, readBody } from "../lib/envelope.js";
import { createDocument, updateDocument, deleteDocument, listDocuments, Query, ownerPermissions, toDocId } from "../lib/appwrite.js";

const DB = "data_keys";
const COL = "user_keys";

const REQUIRED = ["encryptedPublicKey", "encryptedSymmetricKey", "encryptedPrivateKey", "publicKey", "loginSalt", "loginAlg", "dataAlg"];

export async function updateUserKeys({ req, res, log, user }) {
  const body = readBody(req);

  const missing = REQUIRED.filter((k) => typeof body[k] !== "string" || !body[k]);
  if (missing.length) {
    return fail(res, 400, "validation_error", `Missing fields: ${missing.join(", ")}`);
  }
  const version = Number(body.matchingKeyVersion);
  if (!Number.isInteger(version) || version < 1) {
    return fail(res, 400, "validation_error", "matchingKeyVersion must be a positive integer");
  }

  const existing = await listDocuments(DB, COL, [
    Query.equal("ownerUserId", [user.id]),
    Query.orderDesc("userKeyVersion"),
    Query.limit(100),
  ]);
  if (!existing.ok) {
    log(`listDocuments failed: ${existing.status}`);
    return fail(res, 500, "general_error", "Failed to read existing keys");
  }
  const docs = existing.json.documents;
  const latest = docs[0];

  const data = {
    ownerUserId: user.id,
    encryptedSymmetricKey: body.encryptedSymmetricKey,
    encryptedPrivateKey: body.encryptedPrivateKey,
    encryptedPublicKey: body.encryptedPublicKey,
    publicKey: body.publicKey,
    oldMasterKeys: body.oldMasterKeys ?? null,
    loginSalt: body.loginSalt,
    dataSalt: body.dataSalt ?? null,
    loginAlg: body.loginAlg,
    dataAlg: body.dataAlg,
    schemeVersion: body.schemeVersion ?? null,
    userKeyVersion: version,
  };

  let doc;
  if (!latest || latest.userKeyVersion === version - 1) {
    // first key, or legitimate rotation to next version
    const created = await createDocument(DB, COL, {
      documentId: toDocId(`k${user.id}${version}`),
      data,
      permissions: ownerPermissions(user.id),
    });
    if (!created.ok) {
      log(`create failed: ${created.status}`);
      return fail(res, 500, "general_error", "Failed to store user keys");
    }
    doc = created.json;
  } else if (latest.userKeyVersion === version) {
    // idempotent re-upload of the current version
    const updated = await updateDocument(DB, COL, latest.$id, data);
    if (!updated.ok) {
      log(`update failed: ${updated.status}`);
      return fail(res, 500, "general_error", "Failed to update user keys");
    }
    doc = updated.json;
  } else {
    log(`conflict: latest=${latest.userKeyVersion} matching=${version}`);
    return fail(res, 409, "key_version_conflict", "Key version mismatch — refresh keys and retry");
  }

  if (body.removeOldKeys) {
    for (const other of docs) {
      if (other.$id !== doc.$id) {
        await deleteDocument(DB, COL, other.$id);
      }
    }
  }

  return ok(res, doc);
}
