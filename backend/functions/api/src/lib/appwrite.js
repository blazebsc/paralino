/**
 * Minimal Appwrite REST client for server-side (API-key) document writes.
 * Zero deps — the Appwrite Node SDK would work too, this is ~60 lines.
 *
 * Reads happen client-side with the user's session; the function only writes.
 *
 * Auth: the ephemeral per-execution API key (from the function's `scopes`
 * config) arrives in the `x-appwrite-key` request header — see
 * https://appwrite.io/docs/products/functions/develop#ephemeral-api-key.
 * Self-hosted deployments can alternatively set APPWRITE_API_KEY env.
 * Endpoint/project come from Appwrite-injected env (or explicit env on self-host).
 */

let runtimeKey = null;

/** Call once per request, before any document operations. */
export function setRequestKey(req) {
  runtimeKey = req?.headers?.["x-appwrite-key"] || null;
}

export function config() {
  return {
    host: (process.env.APPWRITE_ENDPOINT || process.env.APPWRITE_FUNCTION_API_ENDPOINT || "").replace(/\/+$/, ""),
    project: process.env.APPWRITE_PROJECT_ID || process.env.APPWRITE_FUNCTION_PROJECT_ID,
    key: runtimeKey || process.env.APPWRITE_API_KEY || null,
  };
}

function assertConfig() {
  const { host, project, key } = config();
  if (!host || !project || !key) {
    throw new Error(
      "Missing Appwrite config — need x-appwrite-key request header (ephemeral key, requires function scopes) " +
      "or APPWRITE_API_KEY env, plus APPWRITE_FUNCTION_API_ENDPOINT/APPWRITE_FUNCTION_PROJECT_ID"
    );
  }
}

function headers(extra = {}) {
  const { project, key } = config();
  return {
    "X-Appwrite-Project": project,
    "X-Appwrite-Key": key,
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
  const { host } = config();
  const res = await fetch(`${host}${path}`, {
    method,
    headers: headers(),
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = { raw: text }; }
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

// Appwrite Query helpers — JSON-string format (Appwrite 2.x)
export const Query = {
  equal: (attr, values) => JSON.stringify({ method: "equal", attribute: attr, values }),
  orderDesc: (attr) => JSON.stringify({ method: "orderDesc", attribute: attr }),
  limit: (n) => JSON.stringify({ method: "limit", values: [n] }),
};

/** Sanitize a client-supplied string into a valid Appwrite document ID (<=36 chars). */
export function toDocId(raw) {
  const clean = String(raw).replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 36);
  return clean || "doc";
}
