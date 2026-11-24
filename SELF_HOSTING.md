# Self-Hosting Paralino

Run the Paralino location sharing app entirely on your own infrastructure.
No Google, no third-party servers, no billing — everything unlimited, E2EE.

## Prerequisites

- A server (VPS, home server, Raspberry Pi) with Docker
- A domain name with DNS access
- Basic familiarity with the command line

## Architecture

```
┌──────────────┐     ┌─────────────────────────────────────────┐
│  Paralino    │────▶│  Your Server                             │
│  Android app │     │  ┌─────────────────────────────────┐    │
│  (de-googled)│     │  │  Appwrite                        │    │
│              │     │  │  ├── Auth (sessions, recovery)   │    │
│  Maps:       │     │  │  ├── Database (20 collections)   │    │
│  MapLibre    │     │  │  ├── Realtime (WebSocket)        │    │
│              │     │  │  └── Function: api (58 routes)   │    │
│  Push:       │     │  └─────────────────────────────────┘    │
│  UnifiedPush │     │  ┌─────────────────────────────────┐    │
│  (ntfy)      │     │  │  Static files (public-api)       │    │
│  or built-in │     │  │  /config → plan + server info    │    │
│  WebSocket   │     │  └─────────────────────────────────┘    │
└──────────────┘     └─────────────────────────────────────────┘
```

All location data is E2EE — the server stores ciphertext blobs and never
sees plaintext locations, names, or group data.

## Setup

### 1. Install Appwrite

Follow the [official guide](https://appwrite.io/docs/installation).
Self-hosted Appwrite has no resource limits (Cloud's free tier caps at
1 database, 2 functions, 5 functions soft limit — self-hosted has none).

### 2. Create a project

In the Appwrite console, create a project. Note the project ID and endpoint.

### 3. Register your app

In the Appwrite console → your project → Add Platform → Android.
Use the application ID: `app.paralino.android` (or your renamed ID).

### 4. Provision the schema

```sh
cd backend/provision
APPWRITE_HOST="https://your-server/v1" \
APPWRITE_PROJECT_ID="your-project-id" \
APPWRITE_API_KEY="your-api-key" \
node provision.mjs
```

This creates the database, collections, attributes, and indexes.

### 5. Deploy the function

Package and deploy `backend/functions/api` as an Appwrite Function:
- Runtime: Node 22
- Entrypoint: `src/main.js`
- Execute: `users` (logged-in users only)
- Scopes: `databases.read`, `databases.write`, `documents.read`,
  `documents.write`, `documentsdb.read`, `documentsdb.write`, `users.read`

The function reads its Appwrite connection from injected env vars —
no manual API key needed. The ephemeral key arrives in `x-appwrite-key`.

### 6. Create an API key for the function

The function needs `databases.read/write` and `users.read` scopes.
Appwrite auto-injects a scoped ephemeral key per execution via the
function's `scopes` config.

### 7. Serve the config endpoint

Copy `backend/public-api/config.json` to any static file server.
It serves the unlimited plan definition and server connection info.

### 8. Set up push notifications (optional)

Install a [UnifiedPush distributor](https://unifiedpush.org/players/distributors/)
on your device — [ntfy](https://ntfy.sh) is the most popular. The app
detects it automatically and offers it in Settings → App settings →
Push Notification Service.

Without a distributor, the app falls back to a built-in WebSocket
connection that runs as a foreground service.

## App setup

1. Install the APK (build `directDebug` or `directReleaseLocal`)
2. Enter your server URL (the function's domain, e.g. `https://abc123.appwrite.global`)
3. The app fetches `/config` and self-configures
4. Sign up, skip email verification (or configure SMTP in Appwrite)
5. Create a group, start sharing

## What's unlimited

Everything. The self-hosted plan config sets all limits to 999999
(or -1 for unlimited history). Groups, members, devices, places,
privacy zones, history days — all unlimited.

## What's NOT Google

- **Maps**: MapLibre + your own MapTiler token (optional) or free style
- **Push**: UnifiedPush (ntfy, Sunup, NextPush) or built-in WebSocket
- **Location**: native AOSP LocationManager
- **Crypto**: parasodium (libsodium wrapper)
- **Backend**: Appwrite (self-hosted, open source)

The only `com.google` artifacts in the build are code libraries
(Tink crypto, Accompanist permissions) — no Google services.

## Wire protocol

All routes use the envelope:
```json
{"data": <payload>}          // success (2xx)
{"data": {"type": "...", "message": "...", "code": 400}}  // error (4xx/5xx)
```

See `backend/README.md` for the full wire protocol documentation.
