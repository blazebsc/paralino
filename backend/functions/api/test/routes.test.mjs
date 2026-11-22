// Route tests for /keys/user and /v2/user/devices with a fake Appwrite backend.
// Run: node backend/functions/api/test/routes.test.mjs
process.env.APPWRITE_ENDPOINT = "http://fake/v1";
process.env.APPWRITE_PROJECT_ID = "test-project";
process.env.APPWRITE_API_KEY = "test-key";

import assert from "node:assert/strict";
import handler from "../src/main.js";

// ---- fake Appwrite: in-memory document store keyed by db/col/docId ----
const STORE = { "data_keys/user_keys": new Map(), "data_main/devices": new Map() };

const origFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  const u = new URL(url);
  const m = u.pathname.match(/^\/v1\/databases\/([^/]+)\/collections\/([^/]+)\/documents(?:\/([^/]+))?$/);
  assert(m, `unexpected path ${u.pathname}`);
  const [, db, col, docId] = m;
  const key = `${db}/${col}`;
  const store = STORE[key];
  assert(store, `no fake store for ${key}`);
  const body = init?.body ? JSON.parse(init.body) : null;

  if (init.method === "POST") {
    if (store.has(body.documentId)) {
      return jsonRes(409, { message: "exists" });
    }
    const doc = { $id: body.documentId, $createdAt: "t", $updatedAt: "t", ...body.data };
    store.set(body.documentId, doc);
    return jsonRes(201, doc);
  }
  if (init.method === "PATCH" && docId) {
    if (!store.has(docId)) return jsonRes(404, { message: "missing" });
    const doc = { ...store.get(docId), ...body.data };
    store.set(docId, doc);
    return jsonRes(200, doc);
  }
  if (init.method === "DELETE" && docId) {
    store.delete(docId);
    return jsonRes(204, {});
  }
  if (init.method === "GET") {
    const queries = u.searchParams.getAll("queries[]");
    let docs = [...store.values()];
    for (const q of queries) {
      const eq = q.match(/^equal\("([^"]+)",\[(.*)\]\)$/);
      if (eq) {
        const vals = JSON.parse(eq[2].replaceAll('"', '"'));
        docs = docs.filter((d) => vals.includes(d[eq[1]]));
      }
      const desc = q.match(/^orderDesc\("([^"]+)"\)$/);
      if (desc) docs.sort((a, b) => (b[desc[1]] ?? 0) - (a[desc[1]] ?? 0));
      const lim = q.match(/^limit\((\d+)\)$/);
      if (lim) docs = docs.slice(0, Number(lim[1]));
    }
    return jsonRes(200, { documents: docs, total: docs.length });
  }
  return jsonRes(405, { message: "unsupported" });
};

function jsonRes(status, body) {
  return { ok: status < 400, status, json: async () => body };
}

// ---- harness ----
function fakeRes() {
  return { statusCode: 0, body: null, json(b, s = 200) { this.body = b; this.statusCode = s; return this; } };
}
async function call(method, path, body, userId = "user1234567890abcd") {
  const res = fakeRes();
  await handler({
    req: { method, path, headers: { "x-appwrite-user-id": userId }, body: body ? JSON.stringify(body) : "", bodyJson: undefined },
    res,
    log: () => {},
  });
  return res;
}
const KEY_PAYLOAD = {
  encryptedPublicKey: "epk", encryptedSymmetricKey: "esk", encryptedPrivateKey: "eprk",
  publicKey: "pk", loginSalt: "s", loginAlg: "a", dataAlg: "b",
  matchingKeyVersion: 1, removeOldKeys: false,
};

// ---- /keys/user ----
{
  const res = await call("POST", "/keys/user", KEY_PAYLOAD);
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(res.body.data.userKeyVersion, 1);
  assert.equal(res.body.data.ownerUserId, "user1234567890abcd");
  assert.equal(res.body.data.encryptedSymmetricKey, "esk");
  console.log("ok: keys/user creates v1");
}
{
  // idempotent re-upload of same version -> update, not conflict
  const res = await call("POST", "/keys/user", { ...KEY_PAYLOAD, publicKey: "pk2" });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.data.publicKey, "pk2");
  const store = STORE["data_keys/user_keys"];
  assert.equal(store.size, 1);
  console.log("ok: keys/user idempotent on same version");
}
{
  // stale version -> 409 (same user, latest is v1, client claims v3)
  const res = await call("POST", "/keys/user", { ...KEY_PAYLOAD, matchingKeyVersion: 3 });
  assert.equal(res.statusCode, 409);
  console.log("ok: keys/user 409 on version jump");
}
{
  // rotation: v2 then removeOldKeys clears v1
  const res = await call("POST", "/keys/user", { ...KEY_PAYLOAD, matchingKeyVersion: 2, removeOldKeys: true });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.data.userKeyVersion, 2);
  assert.equal(STORE["data_keys/user_keys"].size, 1);
  console.log("ok: keys/user rotation + removeOldKeys");
}
{
  // missing required field -> 400
  const res = await call("POST", "/keys/user", { ...KEY_PAYLOAD, loginSalt: undefined, matchingKeyVersion: 1 });
  assert.equal(res.statusCode, 400);
  assert.match(res.body.data.message, /loginSalt/);
  console.log("ok: keys/user 400 on missing field");
}

// ---- /v2/user/devices ----
{
  const res = await call("PUT", "/v2/user/devices", {
    sessionId: "sess1", deviceId: "dev-1", deviceType: "phone",
    pushProvider: "unified_push", updatePushProviderConfig: true,
    pushProviderConfig: { distributor: "ntfy", url: "https://ntfy.sh/x" },
  });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(res.body.data.deviceId, "dev-1");
  assert.deepEqual(JSON.parse(res.body.data.pushProviderConfig), { distributor: "ntfy", url: "https://ntfy.sh/x" });
  console.log("ok: devices upsert creates");
}
{
  // second call without updatePushProviderConfig keeps stored config
  const res = await call("PUT", "/v2/user/devices", {
    sessionId: "sess2", deviceId: "dev-1", deviceType: "phone",
    pushProvider: "unified_push", updatePushProviderConfig: false,
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.data.sessionId, "sess2");
  assert.deepEqual(JSON.parse(res.body.data.pushProviderConfig), { distributor: "ntfy", url: "https://ntfy.sh/x" });
  console.log("ok: devices preserves config when update=false");
}
{
  const res = await call("PUT", "/v2/user/devices", { sessionId: "s", deviceId: "d" });
  assert.equal(res.statusCode, 400);
  console.log("ok: devices 400 on missing fields");
}

globalThis.fetch = origFetch;
console.log("all route tests passed");
