/**
 * Paralino self-hosted 'location-upload' function.
 * Wire contract: see ../../README.md. Same envelope + auth as the api function.
 * Routes from ServerFunction.kt with functionId = "location-upload".
 */

import { fail } from "./lib/envelope.js";
import { currentUser } from "./lib/auth.js";
import { apiTest } from "./routes/apiTest.js";

const ROUTES = {
  "POST /api-test": apiTest,
  // location-upload-specific routes are added here as they get implemented:
  // "PATCH /locations": null, // LOCATION_PATCH


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
