// Smoke test for the api function router/envelope. No Appwrite needed.
// Run: node backend/functions/api/test/main.test.mjs
import assert from "node:assert/strict";
import handler from "../src/main.js";

function fakeRes() {
  return {
    statusCode: 0,
    body: null,
    json(body, status = 200) {
      this.body = body;
      this.statusCode = status;
      return this;
    },
  };
}

function fakeReq(method, path, headers = {}, body = "") {
  return { method, path, headers, body, bodyJson: undefined };
}

async function call(req) {
  const res = fakeRes();
  const logs = [];
  await handler({ req, res, log: (m) => logs.push(m) });
  return { res, logs };
}

// 1. implemented route with user context -> 200 envelope
{
  const { res } = await call(
    fakeReq("POST", "/v2/user/config", { "x-appwrite-user-id": "u1" }, '{"satelliteMaps":false}')
  );
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.data, {
    billingCustomerId: null,
    mapTilerStyleToken: null,
    mapTilerSatelliteToken: null,
  });
  console.log("ok: user/config 200 envelope");
}

// 2. no user context -> 401
{
  const { res } = await call(fakeReq("POST", "/v2/user/config"));
  assert.equal(res.statusCode, 401);
  assert.equal(res.body.data.type, "unauthorized");
  console.log("ok: 401 without user header");
}

// 3. registered-but-stub route -> 501 not_implemented
{
  const { res } = await call(fakeReq("POST", "/groups", { "x-appwrite-user-id": "u1" }, "{}"));
  assert.equal(res.statusCode, 501);
  assert.equal(res.body.data.type, "not_implemented");
  console.log("ok: 501 for stub route");
}

// 4. unknown route -> 404
{
  const { res } = await call(fakeReq("GET", "/nope", { "x-appwrite-user-id": "u1" }));
  assert.equal(res.statusCode, 404);
  assert.equal(res.body.data.type, "not_found");
  console.log("ok: 404 for unknown route");
}

// 5. error shape matches FunctionErrorBody {type, message, code}
{
  const { res } = await call(fakeReq("POST", "/groups", { "x-appwrite-user-id": "u1" }, "{}"));
  assert.deepEqual(Object.keys(res.body.data).sort(), ["code", "message", "type"]);
  console.log("ok: error body shape");
}

console.log("all router tests passed");
