/**
 * Paralino self-hosted `api` function.
 *
 * Wire contract (see ../../README.md):
 *   success -> 2xx, body {"data": <payload>}
 *   error   -> 4xx/5xx, body {"data": {"type": "...", "message": "...", "code": <http>}}
 *
 * The client wraps every call via FunctionExecutionRaw and reads `.data`.
 */

import { fail } from "./lib/envelope.js";
import { currentUser } from "./lib/auth.js";
import { userConfig } from "./routes/userConfig.js";
import { updateUserKeys } from "./routes/userKeys.js";
import { updateUserDevice } from "./routes/userDevices.js";
import { apiTest } from "./routes/apiTest.js";

// Every ServerFunction with functionId "api" (default). Key = "<METHOD> <path>".
// Implemented: see src/routes/. Everything else is a loud stub.
const ROUTES = {
  "POST /api-test": apiTest, // TEST_API

  // account / user
  "POST /v2/user/config": userConfig,
  "PUT /v2/user/devices": updateUserDevice,
  "POST /keys/user": updateUserKeys,
  "DELETE /user": null, // ACCOUNT_DELETE
  "POST /user/reset": null, // ACCOUNT_RESET
  "PATCH /user/email": null, // ACCOUNT_CHANGE_EMAIL
  "DELETE /user/devices": null, // USER_DEVICE_DELETE

  // groups
  "POST /groups": null, // GROUP_CREATE
  "DELETE /groups": null, // GROUP_DELETE
  "PATCH /groups": null, // GROUP_UPDATE
  "PUT /groups/block": null, // GROUP_BLOCK

  // members
  "PUT /members": null, // MEMBER_CREATE
  "DELETE /members": null, // MEMBER_DELETE
  "PATCH /members": null, // MEMBER_UPDATE
  "PUT /members/block": null, // MEMBER_BLOCK

  // live locations
  "POST /location/group": null, // LOCATION_CREATE_GROUP
  "POST /location/personal": null, // LOCATION_CREATE_PERSONAL
  "DELETE /location/group": null, // LOCATION_DELETE_GROUP
  "DELETE /location/personal": null, // LOCATION_DELETE_PERSONAL

  // history
  "POST /history": null, // HISTORY_CREATE
  "POST /history/group/read": null, // HISTORY_READ_GROUP
  "POST /history/personal/read": null, // HISTORY_READ_PERSONAL
  "PATCH /history/group": null, // HISTORY_UPDATE_GROUP
  "PATCH /history/personal": null, // HISTORY_UPDATE_PERSONAL
  "DELETE /history/group": null, // HISTORY_DELETE_GROUP
  "DELETE /history/personal": null, // HISTORY_DELETE_PERSONAL

  // places
  "PUT /places": null, // PLACE_CREATE
  "DELETE /places": null, // PLACE_DELETE
  "PATCH /places": null, // PLACE_UPDATE
  "POST /places/search": null, // PLACE_ADDRESS_SEARCH (server-side geocoder)

  // privacy zones
  "PUT /privacy-zones": null, // PRIVACY_ZONE_CREATE
  "DELETE /privacy-zones": null, // PRIVACY_ZONE_DELETE
  "PATCH /privacy-zones": null, // PRIVACY_ZONE_UPDATE

  // E2EE key exchange
  "POST /keys/group": null, // KEYS_UPDATE_GROUP
  "POST /keys/member": null, // KEYS_UPDATE_MEMBERS
  "POST /keys/location": null, // KEYS_UPDATE_LOCATIONS
  "POST /keys/personal_code": null, // KEYS_UPDATE_CODE
  "POST /keys/user": null, // KEYS_UPDATE_USER
  "POST /keys/space": null, // KEYS_UPDATE_SPACE

  // personal codes ("Paralino IDs")
  "POST /personal_code": null, // PERSONAL_CODE_CREATE
  "POST /personal_code/read": null, // PERSONAL_CODE_READ_V2
  "PATCH /personal_code": null, // PERSONAL_CODE_UPDATE
  "DELETE /personal_code": null, // PERSONAL_CODE_DELETE

  // alerts
  "PATCH /alerts/place": null, // ALERTS_PLACES_UPDATE
  "PATCH /alerts/battery/group": null, // ALERTS_BATTERY_UPDATE_GROUP
  "PATCH /alerts/battery/space": null, // ALERTS_BATTERY_UPDATE_SPACE

  // billing (fork: unused, kept for route-table completeness)
  "POST /user/create_billing_profile": null, // BILLING_ID_UPDATE
  "POST /redeem_code": null, // BILLING_REDEEM_CODE
  "POST /billing/web_checkout": null, // CREATE_WEB_CHECKOUT_SESSION
  "GET /billing/web_portal": null, // WEB_CHECKOUT_PORTAL_GET
};

// ponytail: suffix matching — verify what req.path actually contains for SDK
// createExecution calls (possibly full "/functions/{id}/executions{path}") and
// tighten to exact matching once observed. Suffix match is safe against
// over-matching as long as route keys stay unique.
export default async ({ req, res, log }) => {
  const path = (req.path || "").replace(/\/+$/, "");
  const routeKey = `${req.method} ${path}`;

  let handler = ROUTES[routeKey];
  if (!handler) {
    for (const key of Object.keys(ROUTES)) {
      if (path.endsWith(key.split(" ")[1]) && key.startsWith(req.method)) {
        handler = ROUTES[key];
        log(`Routed via suffix match: ${key} (request was ${routeKey})`);
        break;
      }
    }
  }

  if (!handler) {
    if (routeKey in ROUTES) {
      log(`Route not yet implemented: ${routeKey}`);
      return fail(res, 501, "not_implemented", `Not implemented: ${routeKey}`);
    }
    log(`No route for ${routeKey}`);
    return fail(res, 404, "not_found", `No route: ${routeKey}`);
  }

  try {
    const user = currentUser(req);
    if (!user) {
      return fail(res, 401, "unauthorized", "No user context on execution");
    }
    return await handler({ req, res, log, user });
  } catch (e) {
    log(`Handler error: ${e?.stack || e}`);
    return fail(res, 500, "general_error", e?.message || "Internal error");
  }
};
