/**
 * Event ping routes (places/battery) — client-detected events pushed to the group.
 * Recipients learn of these via UnifiedPush wake-ups fired by the client's other
 * routes (ping/members/places) or periodic polling; these routes just log.
 * Returns {} — the client only checks isSuccess.
 */

import { ok, readBody } from "../lib/envelope.js";


export async function eventsPlaces({ req, res, log, user }) {
  const body = readBody(req);
  log(`place event from ${user.id}: ${JSON.stringify(body)}`);
  return ok(res, {});
}

export async function eventsBatteryGroup({ req, res, log, user }) {
  const body = readBody(req);
  log(`battery event (group) from ${user.id}: ${JSON.stringify(body)}`);
  return ok(res, {});
}

export async function eventsBatterySpace({ req, res, log, user }) {
  const body = readBody(req);
  log(`battery event (space) from ${user.id}: ${JSON.stringify(body)}`);
  return ok(res, {});
}
