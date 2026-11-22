/**
 * Minimal Appwrite REST client for server-side (API-key) document writes.
 * Zero deps — the Appwrite Node SDK would work too, this is ~60 lines.
 *
 * Reads happen client-side with the user's session; the function only writes.
 * Env: APPWRITE_ENDPOINT, APPWRITE_PROJECT_ID, APPWRITE_API_KEY (databases.* scope).
 */

const HOST = (process.env.APPWRITE_ENDPOINT || "").replace(/\/+$/, "");
const PROJECT = process.env.APPWRITE_PROJECT_ID;
const KEY = process.env.APPWRITE_API_KEY;

function assertConfig() {
  if (!HOST || !PROJECT || !KEY) {
    throw new Error("Missing APPWRITE_ENDPOINT / APPWRITE_PROJECT_ID / APPWRITE_API_KEY env vars");
  }
}

function headers(extra = {}) {
  return {
    "X-Appwrite-Project": PROJECT,
    "X-Appwrite-Key": KEY,
    "Content-Type": "application/json",
    ...extra,
  };
}

/**
 * owner-only permissions: the user can read (and manage) their own docs.
 * Client-side reads go through Appwrite auth; writes all happen here.
 */
export function ownerPermissions(userId) {
  const p = `user:${userId}`;
  return [`read("${p}")`, `update("${p}")`, `delete("${p}")`];
}

async function request(method, path, body) {
  assertConfig();
  const res = await fetch(`${HOST}${path}`, {
    method,
    headers: headers(),
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = res.ok ? await res.json() : null;
  return { status: res.status, ok: res.ok, json };
}

export async function createDocument(db, col, { documentId, data, permissions }) {
  return request("POST", `/databases/${db}/collections/${col}/documents`, {
    documentId,
    data,
    permissions,
  });
}

export async function updateDocument(db, col, docId, data) {
  return request("PATCH", `/databases/${db}/collections/${col}/documents/${docId}`, { data });
}

export async function deleteDocument(db, col, docId) {
  return request("DELETE", `/databases/${db}/collections/${col}/documents/${docId}`);
}

export async function listDocuments(db, col, queries = []) {
  const qs = queries.map((q) => `queries[]=${encodeURIComponent(q)}`).join("&");
  return request("GET", `/databases/${db}/collections/${col}/documents${qs ? `?${qs}` : ""}`);
}

// Appwrite Query helpers (string form the REST API expects)
export const Query = {
  equal: (attr, values) => `equal("${attr}",[${values.map((v) => JSON.stringify(v)).join(",")}])`,
  orderDesc: (attr) => `orderDesc("${attr}")`,
  limit: (n) => `limit(${n})`,
};

/** Sanitize a client-supplied string into a valid Appwrite document ID (<=36 chars). */
export function toDocId(raw) {
  const clean = String(raw).replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 36);
  return clean || "doc";
}
