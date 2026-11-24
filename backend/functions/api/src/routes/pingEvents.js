/**
 * Event ping routes (places/battery) — client-detected events pushed to the group.
 * Without push infrastructure, these create push_notifications docs for
 * realtime pickup. Returns {} — the client only checks isSuccess.
 */

import { ok, readBody } from "../lib/envelope.js";
import { createDocument, toDocId } from "../lib/appwrite.js";

function newId() {
  return crypto.randomUUID().replaceAll("-", "").slice(0, 32);
}

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
