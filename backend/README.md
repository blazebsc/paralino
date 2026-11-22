# Paralino Self-Hosted Backend

A from-scratch, open backend for the Paralino clients. The client apps are AGPL
and were used as the wire-protocol spec — every endpoint, payload and response
shape here was derived from `core-domain` client code.

**Status: scaffold.** Nothing here is production-ready yet. See Roadmap.

## Architecture facts (derived from the client, verified)

| Concern | How the client talks to the backend |
|---|---|
| Auth | **Vanilla Appwrite Account service.** `account.create`, `createEmailPasswordSession`, recovery, email verification, session management (`androidApp/.../remote/appwrite/UserApi.kt`). Zero custom auth code needed. |
| Reads | **Direct** Appwrite Databases queries (`docApi.listAllDocuments/getDocument`). Authorization = Appwrite document-level `read` permissions. |
| Writes | **Always** through Appwrite Functions (`functions.createExecution`, sync). Functions validate + write docs with an API key, setting per-user read permissions. |
| Realtime | Appwrite native realtime on collections. |
| E2EE | Client-side only (`parasodium`). Server stores ciphertext blobs. No crypto work on the backend. |
| Email | Appwrite built-in SMTP. Skipped entirely by dev-mode builds (`isEmailEnabled = isDevMode || emailEnabled`). |

## Wire contracts

### Functions (single deployment, path-routed)

Upstream splits its backend into 4 Appwrite functions (`api`, `ping`,
`location-upload`, `history-upload`). Appwrite Cloud's free tier allows only 2
functions per project, and one deployment is simpler to self-host, so the fork
runs **one function** and routes by path prefix. `core-domain/.../repo/api/ServerFunction.kt`
carries the matching paths:

| Prefix | Purpose |
|---|---|
| *(none)* | ~50 api routes: groups, members, places, privacy zones, key exchange, personal codes, account mgmt |
| `/ping/...` | focus/refresh/event signaling (upstream `ping` function) |
| `/location-upload/...` | batch location ingest (upstream `location-upload` function) |
| `/history-upload/...` | history ingest (upstream `history-upload` function) |

Request: `createExecution(functionId="api", body=JSON-string, path, method, headers={"x-paralino-client": <os/version string>})`.
The client header is informational only.

Response envelope (parsed in `FunctionExecutionRaw`):

```jsonc
// success: HTTP 2xx
{ "data": { /* route-specific */ } }

// error: HTTP 4xx/5xx
{ "data": { "type": "general_error", "message": "...", "code": 400 } }
```

Non-SDK endpoints (`useSdk = false`) are plain HTTPS to the **public server**
(`publicServerUrl` in client config), same envelope, no Appwrite execution wrapper.

### Public server routes

| Route | Purpose |
|---|---|
| `GET /config` | Version gates + **plan definitions** (limits). Client enforces all limits locally from this. Static JSON — see `public-api/config.json`. |
| `POST /login` | Login details for the personal-code ("Paralino ID") flow. Response shape: `LoginDetailsRaw`. TODO. |
| `GET /billing-config` | Paywall copy. Skip — fork serves no billing. |

**Critical:** if `/config` serves no plans, clients fall back to a crippled
built-in FREE plan (1 group, 2 members, no history, no personal space). The
fork's `config.json` serves one unlimited plan instead. `historyDaysLimit < 0`
means unlimited; count limits just need a big number.

### Example route (implemented in `functions/api`): `POST /v2/user/config`

Request body: `{"satelliteMaps": bool, "premiumMapStyles": bool}`
Response: `{"data": {"billingCustomerId": null, "mapTilerStyleToken": null, "mapTilerSatelliteToken": null}}`
(billing + MapTiler tokens are optional; nulls are valid — `UserConfigModel.fromRemote`).

## Single-database mode

All collections live in **one database (`data_main`)** — the client's
`BackendDatabaseType` routes DATA/KEYS/PRODUCT to the same database ID, and
collection IDs keep everything distinguishable. This fits Appwrite Cloud's
free tier (1 database per project) and simplifies self-host provisioning; on
unlimited self-hosted installs nothing prevents splitting later.

## Layout

```
backend/
  public-api/          static JSON served by any web server (config, later /login)
  functions/api/       the backend: ONE function, path-routed (envelope, auth, routes)
  provision/provision.mjs  zero-dep script creating databases/collections via REST
```

## Provisioning rule

**Every implemented endpoint adds the collections it writes to
`provision.mjs`.** Schema is derived from the matching `*Raw` model in
`core-domain/.../models/raw/` — attribute names and optionality come from that
model, not guesses.

## Running (target flow, not yet complete)

1. Install Appwrite: https://appwrite.io/docs/installation
2. `APPWRITE_HOST=... APPWRITE_PROJECT_ID=... APPWRITE_API_KEY=... node backend/provision/provision.mjs`
3. Deploy `backend/functions/api` (Appwrite console or CLI), set API key env var
4. Serve `backend/public-api/` with any static server
5. Client: `user.properties` in repo root with
   `devServerUrl`, `devServerKey`, `devPublicServerUrl` → build `directDebug`
   or `directReleaseTest` (build types that read it; `releaseLocal` does **not** — fork TODO)

## Roadmap

- **Phase 1 — onboarding slice**: user/config (done in scaffold), user keys backup, device registration, server connection test passes end-to-end
- **Phase 2 — sharing core**: groups, members, group key exchange, live location ingest (`location-upload`), realtime read path, per-user document permissions
- **Phase 3 — features**: history (`history-upload`), places, privacy zones, place/battery alerts + push dispatch (FCM + UnifiedPush), personal space
- **Phase 4 — public API**: `POST /login` (personal-code flow), account delete/reset/email routes
- **Phase 5 — client fork**: server config from `user.properties` in all build types, rename app (applicationId + display name), app-update allow-list → own GitHub releases

## Open questions (verify during implementation)

- Exact `req.path` value Appwrite passes for SDK `createExecution` calls (router currently suffix-matches)
- `BlocklistRaw` and remaining document shapes — read the `*Raw` model when implementing each route
- Whether any `api` route responses include fields beyond the parsed `*Raw` models
- Push dispatch: which component consumes FCM/UnifiedPush registrations (client sends tokens via `api` routes)

## Schema sizing note (Appwrite Cloud)

Cloud enforces a 65535-byte per-document row limit, and utf8mb4 string
attributes cost ~4 bytes per declared char. Blob attributes are sized for the
real payloads (base64 sodium-sealed keys ~100-500B) with margin, not for
arbitrary 16KB values. If a client value ever exceeds a size, the write fails
loudly — adjust the attribute, don't guess bigger.
