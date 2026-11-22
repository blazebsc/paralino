/**
 * POST /v2/user/config  (ServerFunction.USER_CONFIG)
 *
 * Client caller: core-domain/.../repo/user/UserConfigRepository.kt
 * Request body:  UserConfigPayload {"satelliteMaps": bool, "premiumMapStyles": bool}
 * Response data: {"billingCustomerId"?: string|null,
 *                 "mapTilerStyleToken"?: string|null,
 *                 "mapTilerSatelliteToken"?: string|null}
 *
 * Fork behavior: billingCustomerId stays null (no billing). MapTiler tokens
 * null -> client uses free map style (its own user-entered token flow, if any,
 * still works client-side). The serverConnectionTest treats a non-null config
 * as "server OK", so a 2xx with empty data passes the check.
 *
 * Also grants the unlimited plan document (plans collection) on first call —
 * the client's UserPlans reads granted plans from there. Idempotent.
 */

import { ok, readBody } from "../lib/envelope.js";
import { createDocument, ownerPermissions, toDocId } from "../lib/appwrite.js";

const PLANS_DB = "data_main";
const PLANS_COL = "plans";

async function grantUnlimitedPlan(user, log) {
  try {
    const created = await createDocument(PLANS_DB, PLANS_COL, {
      documentId: toDocId(`p${user.id}`),
      data: {
        planType: "free",
        billingPeriod: "onetime",
        ownerUserId: user.id,
        provider: "paralino",
      },
      permissions: ownerPermissions(user.id),
    });
    // 409 = already granted — fine
    if (!created.ok && created.status !== 409) {
      log(`plan grant failed: ${created.status} ${JSON.stringify(created.json)}`);
    }
  } catch (e) {
    // non-fatal: config must still succeed; the client's fallback plan is unlimited anyway
    log(`plan grant error: ${e?.message}`);
  }
}

export async function userConfig({ req, res, log, user }) {
  const body = readBody(req);
  log(`user/config for ${user.id} satellite=${body?.satelliteMaps} premium=${body?.premiumMapStyles}`);

  await grantUnlimitedPlan(user, log);

  return ok(res, {
    billingCustomerId: null,
    mapTilerStyleToken: null,
    mapTilerSatelliteToken: null,
  });
}
