/**
 * POST /login  (ServerFunction.LOGIN — public, no auth)
 *
 * Client callers: LoginUseCase / RecoverAccountUseCase / ResetPasswordUseCase —
 * they need the user's KDF parameters BEFORE authenticating (the auth key is
 * derived from email+password using the stored alg; V2 schemes use the email
 * as salt, so loginSalt is only consumed by legacy V1 flows).
 *
 * Request body: JSON-encoded email string (the client serializes the raw
 * string with its JSON formatter, so the body arrives quoted).
 *
 * Resolution: email -> Appwrite user (users.read scope) -> latest user_keys
 * doc. Users without key docs (fresh/broken accounts) get the client's
 * default alg, which is what the app would use anyway.
 *
 * Response data: LoginDetailsRaw { loginSalt: string, loginAlg: KDFAlg }
 * KDFAlg = { encoding, kdf, memoryMb, rounds, keyBytes }
 */

import { ok, fail, readBody } from "../lib/envelope.js";
import { listDocuments, Query } from "../lib/appwrite.js";

const DEFAULT_ALG = {
  encoding: "b64u",
  kdf: "a2",
  memoryMb: 64,
  rounds: 3,
  keyBytes: 32,
};

function parseEmail(body) {
  if (typeof body === "string") {
    const t = body.trim();
    if (t.startsWith("\"") && t.endsWith("\"")) return t.slice(1, -1);
    return t;
  }
  if (body && typeof body === "object" && typeof body.email === "string") return body.email;
  return "";
}

export async function login({ req, res, log }) {
  const email = parseEmail(readBody(req));
  if (!email || !email.includes("@")) {
    return fail(res, 400, "validation_error", "Body must be the account email");
  }

  // email -> user id via the Appwrite users API (console-injected key has users.read)
  const { host, project, key } = (await import("../lib/appwrite.js")).config();
  let userId = null;
  try {
    const res2 = await fetch(`${host}/users?queries[]=${encodeURIComponent(JSON.stringify({ method: "equal", attribute: "email", values: [email] }))}`, {
      headers: { "X-Appwrite-Project": project, "X-Appwrite-Key": key },
    });
    if (res2.ok) {
      const json = await res2.json();
      userId = json?.users?.[0]?.$id ?? null;
    } else {
      log(`users lookup failed: ${res2.status}`);
    }
  } catch (e) {
    log(`users lookup error: ${e?.message}`);
  }

  let loginAlg = DEFAULT_ALG;
  let loginSalt = "";

  if (userId) {
    const keys = await listDocuments("data_main", "user_keys", [
      Query.equal("ownerUserId", [userId]),
      Query.orderDesc("userKeyVersion"),
      Query.limit(1),
    ]);
    const doc = keys?.json?.documents?.[0];
    if (doc) {
      loginSalt = doc.loginSalt ?? "";
      try {
        loginAlg = typeof doc.loginAlg === "string" && doc.loginAlg
          ? JSON.parse(doc.loginAlg)
          : (doc.loginAlg ?? DEFAULT_ALG);
      } catch {
        loginAlg = DEFAULT_ALG;
      }
    }
  } else {
    log(`no user for ${email} — serving default alg`);
  }

  return ok(res, { loginSalt, loginAlg });
}
