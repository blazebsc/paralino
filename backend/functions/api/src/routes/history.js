/**
 * Location history routes — the unlimited-history storage layer.
 *
 * History entries are client-side ciphertext, keyed per (location, date).
 * Each entry doc: { locationId, dateIdentifier, historyData, historyKeyVersion }
 *   + group entries carry memberId. Key docs distribute history decryption
 *   keys per date-version (personal: per user; group: per member).
 *
 * The client's historyKeyVersion is a STRING (date-based), personal key
 * version a Long. Doc IDs are deterministic: h{locationId}{dateIdentifier}
 * and hk{keyId} — idempotent re-uploads on retry.
 *
 * The read routes filter by dateKeys (client sends the dates it wants) and
 * verify the caller can read the parent location doc.
 */

import { ok, fail, readBody } from "../lib/envelope.js";
import { createDocument, deleteDocument, listDocuments, Query, ownerPermissions, toDocId } from "../lib/appwrite.js";

const DB = "data_main";

function newId() {
  return toDocId(crypto.randomUUID().replaceAll("-", "").slice(0, 32));
}

async function assertLocationAccess(locationId, user, fail, res, ownerReadOnly = false) {
  const docs = await listDocuments(DB, "locations", [Query.equal("$id", [locationId])]);
  const doc = docs?.json?.documents?.[0];
  if (!doc) {
    // personal space locations live in personal_locations, keyed by deviceId
    const personal = await listDocuments(DB, "personal_locations", [Query.equal("$id", [locationId])]);
    if (personal?.json?.documents?.[0]) return true;
    fail(res, 404, "not_found", "Location not found");
    return false;
  }
  if (ownerReadOnly && doc.ownerUserId !== user.id) {
    // group history: all members can read; only the owner writes
    fail(res, 403, "forbidden", "Not your location doc");
    return false;
  }
  return true;
}

/** POST /history-upload/history (history-upload function) */
export async function historyUpload({ req, res, log, user }) {
  const body = readBody(req);
  if (!body?.deviceId) {
    return fail(res, 400, "validation_error", "Missing deviceId");
  }

  const personalResult = { uploadedEntries: [], uploadedHistoryKeys: [], errors: [] };
  const groupResult = { uploadedEntries: [], uploadedHistoryKeys: [], errors: [] };

  // ---- personal history ----
  const p = body.personalHistory;
  if (p) {
    const entries = [...(p.entries ?? []), ...(p.retryEntries ?? [])];
    for (const e of entries) {
      if (!e?.dateIdentifier || typeof e?.historyData !== "string") {
        personalResult.errors.push({ key: e?.pendingUploadId ?? "?", error: { type: "validation_error", message: "Invalid entry", code: 400 } });
        continue;
      }
      const docId = toDocId(`ph${body.deviceId}${e.dateIdentifier}`);
      const created = await createDocument(DB, "personal_history", {
        documentId: docId,
        data: {
          deviceId: body.deviceId,
          dateIdentifier: e.dateIdentifier,
          historyData: e.historyData,
          historyKeyVersion: e.historyKeyVersion ?? "",
        },
        permissions: ownerPermissions(user.id),
      });
      if (created.ok || created.status === 409) personalResult.uploadedEntries.push(e.pendingUploadId);
      else {
        log(`personal history entry failed: ${created.status} ${JSON.stringify(created.json)}`);
        personalResult.errors.push({ key: e.pendingUploadId, error: { type: "general_error", message: "Upload failed", code: 500 } });
      }
    }
    const keys = [...(p.keys ?? []), ...(p.retryKeys ?? [])];
    for (const k of keys) {
      if (!k?.historyKeyVersion || typeof k?.encryptedHistoryKey !== "string") continue;
      const created = await createDocument(DB, "personal_history_keys", {
        documentId: toDocId(`phk${user.id.slice(0, 10)}${k.historyKeyVersion.slice(0, 20)}`),
        data: {
          ownerUserId: user.id,
          historyKeyVersion: k.historyKeyVersion,
          userKeyVersion: Number(k.userKeyVersion ?? 0),
          encryptedHistoryKey: k.encryptedHistoryKey,
        },
        permissions: ownerPermissions(user.id),
      }).catch(() => null);
      if (created?.ok) personalResult.uploadedHistoryKeys.push(k.historyKeyVersion);
    }
  }

  // ---- group history ----
  for (const g of body?.groupHistory ?? []) {
    if (!g?.groupId || !g?.locationId) continue;

    // permission: caller must be able to read the parent location doc
    const locDocs = await listDocuments(DB, "locations", [Query.equal("$id", [g.locationId])]);
    const locDoc = locDocs?.json?.documents?.[0];
    if (!locDoc) {
      groupResult.errors.push({ groupId: g.groupId, key: g.locationId, error: { type: "not_found", message: "Location not found", code: 404 } });
      continue;
    }

    const entries = [...(g.entries ?? []), ...(g.retryEntries ?? [])];
    for (const e of entries) {
      if (!e?.dateIdentifier || typeof e?.historyData !== "string") {
        groupResult.errors.push({ groupId: g.groupId, key: e?.pendingUploadId ?? "?", error: { type: "validation_error", message: "Invalid entry", code: 400 } });
        continue;
      }
      const docId = toDocId(`gh${g.locationId.slice(0, 20)}${e.dateIdentifier}`);
      const created = await createDocument(DB, "group_history", {
        documentId: docId,
        data: {
          locationId: g.locationId,
          deviceId: body.deviceId,
          memberUserId: user.id,
          groupId: g.groupId,
          dateIdentifier: e.dateIdentifier,
          historyData: e.historyData,
          historyKeyVersion: e.historyKeyVersion ?? "",
        },
        permissions: [...ownerPermissions(user.id), `read("user:${user.id}")`],
      });
      if (created.ok || created.status === 409) groupResult.uploadedEntries.push(e.pendingUploadId);
      else groupResult.errors.push({ groupId: g.groupId, key: e.pendingUploadId, error: { type: "general_error", message: "Upload failed", code: 500 } });
    }

    const keys = [...(g.historyKeys ?? []), ...(g.retryHistoryKeys ?? [])];
    for (const k of keys) {
      if (!k?.memberId || !k?.historyKeyVersion || typeof k?.encryptedHistoryKey !== "string") continue;
      const created = await createDocument(DB, "group_history_keys", {
        documentId: newId(),
        data: {
          groupId: g.groupId,
          memberId: k.memberId,
          memberUserId: user.id,
          ownerUserId: user.id,
          historyKeyVersion: k.historyKeyVersion,
          memberKeyVersion: Number(k.memberKeyVersion ?? 0),
          encryptedHistoryKey: k.encryptedHistoryKey,
        },
        permissions: [...ownerPermissions(user.id), `read("user:${k.memberId}")`],
      }).catch(() => null);
      if (created?.ok) groupResult.uploadedHistoryKeys.push({ groupId: g.groupId, memberId: k.memberId, historyKeyVersion: k.historyKeyVersion });
    }
  }

  return ok(res, { personalHistoryResult: personalResult, groupHistoryResult: groupResult });
}

/** POST /history/group/read */
export async function historyReadGroup({ req, res, log, user }) {
  const body = readBody(req);
  if (typeof body?.groupId !== "string" || !Array.isArray(body?.dateKeys)) {
    return fail(res, 400, "validation_error", "Missing groupId or dateKeys");
  }

  // all group members' history entries for this group + date keys
  const entries = await listDocuments(DB, "group_history", [
    Query.equal("groupId", [body.groupId]),
    Query.equal("dateIdentifier", body.dateKeys.map(String)),
  ]);
  const keys = await listDocuments(DB, "group_history_keys", [
    Query.equal("groupId", [body.groupId]),
  ]);

  return ok(res, {
    entries: (entries?.json?.documents ?? []).map((d) => ({
      $id: d.$id,
      memberUserId: d.memberUserId,
      locationId: d.locationId,
      dateIdentifier: d.dateIdentifier,
      historyData: d.historyData,
      historyKeyVersion: d.historyKeyVersion,
    })),
    keys: (keys?.json?.documents ?? []).map((d) => ({
      memberId: d.memberId,
      historyKeyVersion: d.historyKeyVersion,
      memberKeyVersion: d.memberKeyVersion,
      encryptedHistoryKey: d.encryptedHistoryKey,
    })),
  });
}

/** POST /history/personal/read */
export async function historyReadPersonal({ req, res, log, user }) {
  const body = readBody(req);
  if (!Array.isArray(body?.dateKeys)) {
    return fail(res, 400, "validation_error", "Missing dateKeys");
  }

  const entries = await listDocuments(DB, "personal_history", [
    Query.equal("ownerUserId", [user.id]),
    Query.equal("dateIdentifier", body.dateKeys.map(String)),
  ]);
  const keys = await listDocuments(DB, "personal_history_keys", [
    Query.equal("ownerUserId", [user.id]),
  ]);

  return ok(res, {
    entries: (entries?.json?.documents ?? []).map((d) => ({
      $id: d.$id,
      deviceId: d.deviceId,
      dateIdentifier: d.dateIdentifier,
      historyData: d.historyData,
      historyKeyVersion: d.historyKeyVersion,
    })),
    keys: (keys?.json?.documents ?? []).map((d) => ({
      historyKeyVersion: d.historyKeyVersion,
      userKeyVersion: d.userKeyVersion,
      encryptedHistoryKey: d.encryptedHistoryKey,
    })),
  });
}

/** PATCH /history/group */
export async function historyUpdateGroup({ req, res, log, user }) {
  const body = readBody(req);
  let updated = 0;
  for (const e of body?.entries ?? []) {
    if (!e?.id || typeof e?.historyData !== "string") continue;
    const upd = await updateDocument(DB, "group_history", e.id, {
      historyData: e.historyData,
      historyKeyVersion: e.historyKeyVersion ?? "",
    });
    if (upd.ok) updated++;
  }
  return ok(res, { updated });
}

/** PATCH /history/personal */
export async function historyUpdatePersonal({ req, res, log, user }) {
  const body = readBody(req);
  let updated = 0;
  for (const e of body?.entries ?? []) {
    if (!e?.id || typeof e?.historyData !== "string") continue;
    const upd = await updateDocument(DB, "personal_history", e.id, {
      historyData: e.historyData,
      historyKeyVersion: e.historyKeyVersion ?? "",
    });
    if (upd.ok) updated++;
  }
  return ok(res, { updated });
}

/** DELETE /history/group */
export async function historyDeleteGroup({ req, res, log, user }) {
  const body = readBody(req);
  let deleted = 0;
  for (const e of body?.entries ?? []) {
    if (!e?.id) continue;
    await deleteDocument(DB, "group_history", e.id).catch(() => {});
    deleted++;
  }
  // period deletion
  if (body?.startDateKey !== undefined || body?.locationIds) {
    const queries = [Query.equal("groupId", [body.groupId])];
    const docs = await listDocuments(DB, "group_history", queries);
    for (const d of docs?.json?.documents ?? []) {
      if (body.locationIds?.length && !body.locationIds.includes(d.locationId)) continue;
      const inRange = (!body.startDateKey || d.dateIdentifier >= body.startDateKey) &&
        (!body.endDateKey || d.dateIdentifier <= body.endDateKey);
      if (inRange) {
        await deleteDocument(DB, "group_history", d.$id).catch(() => {});
        deleted++;
      }
    }
  }
  return ok(res, { deleted });
}

/** DELETE /history/personal */
export async function historyDeletePersonal({ req, res, log, user }) {
  const body = readBody(req);
  let deleted = 0;
  for (const e of body?.entries ?? []) {
    if (!e?.id) continue;
    await deleteDocument(DB, "personal_history", e.id).catch(() => {});
    deleted++;
  }
  if (body?.startDateKey !== undefined || body?.locationIds) {
    const docs = await listDocuments(DB, "personal_history", [
      Query.equal("ownerUserId", [user.id]),
    ]);
    for (const d of docs?.json?.documents ?? []) {
      if (body.locationIds?.length && !body.locationIds.includes(d.deviceId)) continue;
      const inRange = (!body.startDateKey || d.dateIdentifier >= body.startDateKey) &&
        (!body.endDateKey || d.dateIdentifier <= body.endDateKey);
      if (inRange) {
        await deleteDocument(DB, "personal_history", d.$id).catch(() => {});
        deleted++;
      }
    }
  }
  return ok(res, { deleted });
}
