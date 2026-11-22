/**
 * POST /user/reset  (ServerFunction.ACCOUNT_RESET)
 *
 * Client caller: RecoverAccountUseCase -> LogoutUseCase.resetAccount ->
 * UserRemoteSource.resetAccount. Runs after the user's local E2EE keys were
 * lost ("No encryption keys found" recovery). Upstream wipes all server-side
 * user data and re-persists fresh key material.
 *
 * Request body: AccountResetCryptoKeyPayload | null
 *   { encryptedSymmetricKey, encryptedPrivateKey, encryptedPublicKey,
 *     publicKey, loginSalt, loginAlg, dataAlg, dataSalt?, schemeVersion? }
 *
 * Fork v1: replaces the user's user_keys docs with the new key material
 * (userKeyVersion = latest + 1). ponytail: wiping group/member/location
 * collections is deferred until those collections carry real data — a
 * self-host user in recovery has nothing else on the server yet.
 *
 * Response data: {} (client checks isSuccess only)
 */

import { ok, readBody } from "../lib/envelope.js";
import { createDocument, deleteDocument, listDocuments, Query, ownerPermissions, toDocId } from "../lib/appwrite.js";

const DB = "data_main";
const COL = "user_keys";

export async function accountReset({ req, res, log, user }) {
  const body = readBody(req);

  const existing = await listDocuments(DB, COL, [
    Query.equal("ownerUserId", [user.id]),
    Query.orderDesc("userKeyVersion"),
    Query.limit(100),
  ]);
  const docs = existing?.json?.documents ?? [];
  const nextVersion = (docs[0]?.userKeyVersion ?? 0) + 1;

  if (body && typeof body.encryptedSymmetricKey === "string" && body.encryptedSymmetricKey) {
    const data = {
      ownerUserId: user.id,
      encryptedSymmetricKey: body.encryptedSymmetricKey,
      encryptedPrivateKey: body.encryptedPrivateKey,
      encryptedPublicKey: body.encryptedPublicKey,
      publicKey: body.publicKey,
      oldMasterKeys: null,
      loginSalt: body.loginSalt ?? "",
      dataSalt: body.dataSalt ?? null,
      loginAlg: typeof body.loginAlg === "string" ? body.loginAlg : JSON.stringify(body.loginAlg ?? {}),
      dataAlg: body.dataAlg ?? "",
      schemeVersion: body.schemeVersion ?? "2.0",
      userKeyVersion: nextVersion,
    };
    const created = await createDocument(DB, COL, {
      documentId: toDocId(`k${user.id}${nextVersion}`),
      data,
      permissions: ownerPermissions(user.id),
    });
    if (!created.ok && created.status !== 409) {
      log(`reset key create failed: ${created.status} ${JSON.stringify(created.json)}`);
      return ok(res, {}); // non-fatal: recovery continues client-side
    }
  }

  for (const doc of docs) {
    await deleteDocument(DB, COL, doc.$id);
  }

  log(`account reset for ${user.id}: v${nextVersion} persisted, ${docs.length} old removed`);
  return ok(res, {});
}
