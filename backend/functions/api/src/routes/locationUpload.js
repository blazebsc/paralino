/**
 * PATCH /location-upload/locations  (ServerFunction.LOCATION_PATCH)
 *
 * Bulk location updates — used when the number of actively sharing devices
 * exceeds bulkLocationApiThreshold (config; 3 in our setup). Below the
 * threshold the client updates its location doc directly.
 *
 * Request body: LocationPatchPayload
 *   { personalLocations: [{ locationId, locationData?, status?, locationHistory? }],
 *     groupLocations: [{ locationId, locationData?, status?, locationHistory?, deviceKeyVersion? }] }
 *
 * Each entry updates the caller's own location doc. Response:
 * LocationPatchResponse { personalResult?, groupResult?, refreshConfig }
 *   per-entry errors use { locationId, key, fallbackToTable, error } —
 *   `fallbackToTable: true` makes the client retry via direct doc updates.
 */

import { ok, readBody } from "../lib/envelope.js";
import { updateDocument, listDocuments, Query } from "../lib/appwrite.js";

const DB = "data_main";

export async function locationPatch({ req, res, log, user }) {
  const body = readBody(req);

  const patchEntry = async (col, entry, extra = {}) => {
    const data = {};
    if (typeof entry.locationData === "string") data.locationData = entry.locationData;
    if (typeof entry.status === "string") data.status = entry.status;
    if (typeof entry.locationHistory === "string") data.locationHistory = entry.locationHistory;
    if (Number.isInteger(entry.deviceKeyVersion)) data.deviceKeyVersion = entry.deviceKeyVersion;
    Object.assign(data, extra);

    // ownership check: the doc must carry a read permission for the caller
    const docs = await listDocuments(DB, col, [Query.equal("$id", [entry.locationId])]);
    const doc = docs?.json?.documents?.[0];
    if (!doc) return { locationId: entry.locationId, key: "not_found", fallbackToTable: true };
    const perm = `read("user:${user.id}")`;
    if (!(doc.$permissions || []).some((p) => p.includes(`user:${user.id}`))) {
      return { locationId: entry.locationId, key: "forbidden", fallbackToTable: true };
    }

    const upd = await updateDocument(DB, col, entry.locationId, data);
    if (!upd.ok) {
      return { locationId: entry.locationId, key: "update_failed", fallbackToTable: true };
    }
    return null; // success
  };

  const personalErrors = [];
  const personalUpdated = [];
  for (const entry of body?.personalLocations ?? []) {
    if (!entry?.locationId) continue;
    const err = await patchEntry("personal_locations", entry);
    if (err) personalErrors.push(err);
    else personalUpdated.push(entry.locationId);
  }

  const groupErrors = [];
  const groupUpdated = [];
  for (const entry of body?.groupLocations ?? []) {
    if (!entry?.locationId) continue;
    const err = await patchEntry("locations", entry);
    if (err) groupErrors.push(err);
    else groupUpdated.push(entry.locationId);
  }

  log(`location patch: ${personalUpdated.length} personal, ${groupUpdated.length} group updated, ${personalErrors.length + groupErrors.length} errors`);
  return ok(res, {
    personalResult: { updatedIds: personalUpdated, errors: personalErrors },
    groupResult: { updatedIds: groupUpdated, errors: groupErrors },
    refreshConfig: false,
  });
}
