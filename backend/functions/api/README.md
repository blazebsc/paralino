# api function

Appwrite Function (Node 18+, zero dependencies — plain `fetch` to the Appwrite
REST API with an API key from env).

## Deploy

1. Appwrite console → Functions → Create: runtime **Node 22**, entrypoint
   `src/main.js` (or use `appwrite push functions` with a matching appwrite.json)
2. Env vars:
   - `APPWRITE_ENDPOINT` — e.g. `http://appwrite/v1`
   - `APPWRITE_PROJECT_ID`
   - `APPWRITE_API_KEY` — key with `databases.*` scope (writes docs with per-user
     permissions; reads via user JWT are not used server-side)
3. Enabled methods: POST, GET, PUT, PATCH, DELETE (client uses all five)

## Routes

All routes from `core-domain/.../repo/api/ServerFunction.kt` with
`functionId = "api"` (default). Implemented routes live in `src/routes/`;
everything else returns a stub error so the client fails loudly, not silently.

Response envelope is the contract — `{"data": ...}` on success,
`{"data": {type, message, code}}` + 4xx/5xx on error (see backend/README.md).

## Adding a route

1. Read the client caller + `*Raw` models for that `ServerFunction` entry
2. Add the collections it touches to `backend/provision/provision.mjs`
3. Implement in `src/routes/`, register in `src/main.js`
