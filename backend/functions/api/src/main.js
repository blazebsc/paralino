/**
 * Whereabouts self-hosted `api` function — SINGLE-FUNCTION MODE.
 *
 * The upstream app splits its backend into 4 Appwrite functions (api, ping,
 * location-upload, history-upload). Appwrite Cloud's free tier allows only 2
 * functions per project, and one deployment is simpler to self-host, so the
 * fork routes everything through this single deployment using path prefixes:
 *
 *   /<route>                  -> api routes (unprefixed, upstream-compatible)
 *   /ping/<route>             -> ping routes (focus/refresh/events)
 *   /location-upload/<route>  -> location ingest
 *   /history-upload/<route>   -> history ingest
 *
 * The client's ServerFunction.kt carries the matching paths/functionId.
 *
 * Wire contract (see ../../README.md):
 *   success -> 2xx, body {"data": <payload>}
 *   error   -> 4xx/5xx, body {"data": {"type": "...", "message": "...", "code": <http>}}
 */

import { fail } from "./lib/envelope.js";
import { currentUser } from "./lib/auth.js";
import { setRequestKey } from "./lib/appwrite.js";
import { userConfig } from "./routes/userConfig.js";
import { updateUserKeys } from "./routes/userKeys.js";
import { updateUserDevice } from "./routes/userDevices.js";
import { apiTest } from "./routes/apiTest.js";
import { login } from "./routes/login.js";
import { accountReset } from "./routes/accountReset.js";
import { groupCreate } from "./routes/groupCreate.js";
import { locationCreateGroup } from "./routes/locationCreateGroup.js";
import { locationCreatePersonal } from "./routes/locationCreatePersonal.js";
import { locationDeleteGroup, locationDeletePersonal } from "./routes/locationDelete.js";
import { locationPatch } from "./routes/locationUpload.js";
import { personalCodeCreate, personalCodeUpdate, personalCodeRestock, personalCodeRead, personalCodeDelete } from "./routes/personalCodes.js";
import { memberCreate, memberUpdate, memberDelete } from "./routes/members.js";
import { placeCreate, placeUpdate, placeDelete, alertsPlacesUpdate } from "./routes/places.js";
import { keysUpdateGroup, keysUpdateMember, keysUpdateLocation, keysUpdateSpace } from "./routes/keyRotation.js";
import { groupUpdate, groupDelete, groupBlock, memberBlock } from "./routes/groupLifecycle.js";
import { accountDelete, accountChangeEmail, userDeviceDelete } from "./routes/account.js";
import { alertsBatteryUpdateGroup, alertsBatteryUpdateSpace, pingEventsPlaces, pingEventsBatteryGroup, pingEventsBatterySpace } from "./routes/batteryAlerts.js";
import { focusMember, focusGroup, focusDevice, focusSpace, refreshMember, refreshDevice } from "./routes/ping.js";
import { eventsPlaces, eventsBatteryGroup, eventsBatterySpace } from "./routes/pingEvents.js";
import { placesSearch } from "./routes/placesSearch.js";
import { historyUpload, historyReadGroup, historyReadPersonal, historyUpdateGroup, historyUpdatePersonal, historyDeleteGroup, historyDeletePersonal } from "./routes/history.js";
import { privacyZoneCreate, privacyZoneUpdate, privacyZoneDelete } from "./routes/privacyZones.js";
import { serverConfig } from "./routes/serverConfig.js";

// Key = "<METHOD> <path>". Implemented: see src/routes/. Stubs stay registered
// so unknown-yet routes fail loudly (501), not with 404.
const ROUTES = {
  "POST /api-test": apiTest, // TEST_API / TEST_PING / TEST_LOCATION_UPLOAD / TEST_HISTORY_UPLOAD
  "POST /login": login, // public: KDF params by email (LoginDetailsRaw)
  "GET /config": serverConfig, // public bootstrap: serverUrl + projectId + unlimited plan

  // account / user
  "POST /v2/user/config": userConfig,
  "PUT /v2/user/devices": updateUserDevice,
  "POST /keys/user": updateUserKeys,
  "DELETE /user": accountDelete,
  "POST /user/reset": accountReset,
  "PATCH /user/email": accountChangeEmail,
  "DELETE /user/devices": userDeviceDelete,

  // groups
  "POST /groups": groupCreate,
  "DELETE /groups": groupDelete,
  "PATCH /groups": groupUpdate,
  "PUT /groups/block": groupBlock,

  // members
  "PUT /members": memberCreate,
  "DELETE /members": memberDelete,
  "PATCH /members": memberUpdate,
  "PUT /members/block": memberBlock,

  // live locations
  "POST /location/group": locationCreateGroup,
  "POST /location/personal": locationCreatePersonal,
  "PATCH /location-upload/locations": locationPatch, // LOCATION_PATCH (batch ingest)
  "DELETE /location/group": locationDeleteGroup,
  "DELETE /location/personal": locationDeletePersonal,

  // ping function (focus/refresh/event signaling)
  "POST /ping/focus/member": focusMember,
  "POST /ping/focus/group": focusGroup,
  "POST /ping/refresh/member": refreshMember,
  "POST /ping/focus/device": focusDevice,
  "POST /ping/focus/space": focusSpace,
  "POST /ping/refresh/device": refreshDevice,
  "POST /ping/events/places": eventsPlaces,
  "POST /ping/events/battery/group": eventsBatteryGroup,
  "POST /ping/events/battery/space": eventsBatterySpace,

  // history
  "POST /history-upload/history": historyUpload,
  "POST /history/group/read": historyReadGroup,
  "POST /history/personal/read": historyReadPersonal,
  "PATCH /history/group": historyUpdateGroup,
  "PATCH /history/personal": historyUpdatePersonal,
  "DELETE /history/group": historyDeleteGroup,
  "DELETE /history/personal": historyDeletePersonal,

  // places
  "PUT /places": placeCreate,
  "DELETE /places": placeDelete,
  "PATCH /places": placeUpdate,
  "POST /places/search": placesSearch,

  // privacy zones
  "PUT /privacy-zones": privacyZoneCreate,
  "DELETE /privacy-zones": privacyZoneDelete,
  "PATCH /privacy-zones": privacyZoneUpdate,

  // E2EE key exchange
  "POST /keys/group": keysUpdateGroup,
  "POST /keys/member": keysUpdateMember,
  "POST /keys/location": keysUpdateLocation,
  "POST /keys/personal_code": personalCodeRestock,
  "POST /keys/space": keysUpdateSpace,

  // personal codes ("Whereabouts codes")
  "POST /personal_code": personalCodeCreate,
  "POST /personal_code/read": personalCodeRead, // PERSONAL_CODE_READ_V2
  "PATCH /personal_code": personalCodeUpdate,
  "DELETE /personal_code": personalCodeDelete,

  // alerts
  "PATCH /alerts/place": alertsPlacesUpdate,
  "PATCH /alerts/battery/group": alertsBatteryUpdateGroup,
  "PATCH /alerts/battery/space": alertsBatteryUpdateSpace,

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
//
// Routes that don't need user context (liveness probes). Everything else
// requires the Appwrite-injected x-appwrite-user-id from the caller's session.
const NO_AUTH = new Set(["POST /api-test", "GET /config", "POST /login"]);

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
    setRequestKey(req); // ephemeral scoped key for server-side doc writes
    const user = currentUser(req);
    if (!user && !NO_AUTH.has(routeKey)) {
      return fail(res, 401, "unauthorized", "No user context on execution");
    }
    return await handler({ req, res, log, user });
  } catch (e) {
    log(`Handler error: ${e?.stack || e}`);
    return fail(res, 500, "general_error", e?.message || "Internal error");
  }
};
