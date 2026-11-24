/**
 * Event ping routes (places/battery) — client-detected events pushed to the group.
 * Without push infrastructure, these create push_notifications docs for
 * realtime pickup. Returns {} — the client only checks isSuccess.
 */

import { ok, readBody } from "../lib/envelope.js";
import { newId, createDocument, toDocId } from "../lib/appwrite.js";


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
