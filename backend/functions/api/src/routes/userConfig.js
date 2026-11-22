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
 */

import { ok, readBody } from "../lib/envelope.js";

export async function userConfig({ req, res, log, user }) {
  const body = readBody(req);
  log(`user/config for ${user.id} satellite=${body?.satelliteMaps} premium=${body?.premiumMapStyles}`);

  return ok(res, {
    billingCustomerId: null,
    mapTilerStyleToken: null,
    mapTilerSatelliteToken: null,
  });
}
