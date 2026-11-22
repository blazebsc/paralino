/**
 * Paralino self-hosted 'ping' function.
 * Wire contract: see ../../README.md. Same envelope + auth as the api function.
 * Routes from ServerFunction.kt with functionId = "ping".
 */

import { fail } from "./lib/envelope.js";
import { currentUser } from "./lib/auth.js";
import { apiTest } from "./routes/apiTest.js";

const ROUTES = {
  "POST /api-test": apiTest,
  // ping-specific routes are added here as they get implemented:


  // "POST /focus/member": null, // LOCATION_FOCUS_MEMBER
  // "POST /focus/group": null, // LOCATION_FOCUS_GROUP
  // "POST /refresh/member": null, // LOCATION_REQUEST_MEMBER
  // "POST /focus/device": null, // LOCATION_FOCUS_DEVICE
  // "POST /focus/space": null, // LOCATION_FOCUS_SPACE
  // "POST /refresh/device": null, // LOCATION_REQUEST_DEVICE
  // "POST /events/places": null, // EVENT_PLACES
  // "POST /events/battery/group": null, // EVENT_BATTERY_GROUP
  // "POST /events/battery/space": null, // EVENT_BATTERY_SPACE
};

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
