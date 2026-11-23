#!/usr/bin/env node
/**
 * Creates the Appwrite databases/collections this backend needs.
 * Zero dependencies (node 18+), idempotent: existing resources are skipped.
 *
 * Env:
 *   APPWRITE_HOST        e.g. http://localhost:8080/v1   (or http://appwrite/v1 from inside docker)
 *   APPWRITE_PROJECT_ID
 *   APPWRITE_API_KEY     scopes: databases.*
 *
 * Rule: every implemented backend endpoint adds its collections here.
 * Attribute names/optionality come from the client's *Raw models in
 * core-domain/.../models/raw/ — the client is the spec.
 */

const HOST = (process.env.APPWRITE_HOST || "http://localhost:8080/v1").replace(/\/+$/, "");
const PROJECT = process.env.APPWRITE_PROJECT_ID;
const KEY = process.env.APPWRITE_API_KEY;

if (!PROJECT || !KEY) {
  console.error("Set APPWRITE_PROJECT_ID and APPWRITE_API_KEY");
  process.exit(1);
}

async function api(method, path, body) {
  const res = await fetch(`${HOST}${path}`, {
    method,
    headers: {
      "X-Appwrite-Project": PROJECT,
      "X-Appwrite-Key": KEY,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.ok) return res.json();
  const text = await res.text();
  if (res.status === 409) {
    console.log(`  = exists: ${method} ${path}`);
    return null;
  }
  throw new Error(`${method} ${path} -> ${res.status}: ${text}`);
}

// Single-database mode: all collections live in data_main. Collection IDs are
// unique within a database, and this fits Appwrite Cloud's free tier (1
// database/project) while staying correct on self-hosted Appwrite.
const DATABASES = {
  data_main: "data_main",
};

// documentSecurity: true -> authorization is per-document (the api function
// sets read permissions when writing). Collections start with no permissions.
const COLLECTIONS = [
  {
    db: "data_main",
    id: "user_keys",
    name: "user_keys",
    // from UserCryptoKeyRaw.kt — user's E2EE master key material.
    // Blob sizes: base64 of sodium-sealed Ed25519/X25519 keys is ~100-500B;
    // oldMasterKeys accumulates across rotations. Total doc < 65535 (Cloud limit).
    attributes: [
      { type: "string", key: "ownerUserId", size: 64, required: true },
      { type: "string", key: "encryptedSymmetricKey", size: 1000, required: true },
      { type: "string", key: "encryptedPrivateKey", size: 1000, required: true },
      { type: "string", key: "encryptedPublicKey", size: 1000, required: true },
      { type: "string", key: "publicKey", size: 200, required: true },
      { type: "string", key: "oldMasterKeys", size: 4000, required: false },
      { type: "string", key: "loginSalt", size: 256, required: true },
      { type: "string", key: "dataSalt", size: 256, required: false },
      { type: "string", key: "loginAlg", size: 200, required: true },
      { type: "string", key: "dataAlg", size: 200, required: true },
      { type: "string", key: "schemeVersion", size: 16, required: false },
      { type: "integer", key: "userKeyVersion", required: true },
    ],
  },
  {
    db: "data_main",
    id: "plans",
    name: "plans",
    // from UserPlanRaw.kt — per-user plan grants. Fork: the api function
    // writes one unlimited plan per user (see public-api/config.json).
    attributes: [
      { type: "string", key: "planType", size: 64, required: true },
      { type: "string", key: "billingPeriod", size: 32, required: true },
      { type: "string", key: "groupId", size: 64, required: false },
      { type: "string", key: "ownerUserId", size: 64, required: false },
      { type: "datetime", key: "expiresAt", required: false },
      { type: "datetime", key: "cancelledAt", required: false },
      { type: "integer", key: "groupsLimitOverride", required: false },
      { type: "string", key: "provider", size: 32, required: false },
    ],
  },
  {
    db: "data_main",
    id: "devices",
    name: "devices",
    // from UserDeviceRaw.kt — one doc per client device (doc id = deviceId).
    // Tokens/configs/blobs are client-encrypted payloads or serialized JSON;
    // sized for the 65535 doc limit with margin.
    attributes: [
      { type: "string", key: "ownerUserId", size: 64, required: true },
      { type: "string", key: "deviceId", size: 64, required: true },
      { type: "string", key: "sessionId", size: 64, required: true },
      { type: "string", key: "deviceType", size: 32, required: true },
      { type: "string", key: "pushProvider", size: 64, required: true },
      { type: "string", key: "pushToken", size: 1000, required: false },
      { type: "string", key: "locationPushToken", size: 1000, required: false },
      { type: "string", key: "pushProviderConfig", size: 1000, required: false },
      { type: "string", key: "pushTargetId", size: 64, required: false },
      { type: "string", key: "deviceData", size: 2000, required: false },
      { type: "string", key: "encryptedSenderKey", size: 1000, required: false },
      { type: "integer", key: "userKeyVersion", required: false },
      { type: "string", key: "batteryAlertSettings", size: 1000, required: false },
    ],
  },
  {
    db: "data_main",
    id: "groups",
    name: "groups",
    // from GroupDocumentRaw.from — `data` attr maps to model field `data`
    attributes: [
      { type: "string", key: "ownerUserId", size: 64, required: true },
      { type: "integer", key: "groupKeyVersion", required: true },
      { type: "string", key: "resourceData", size: 4000, required: true },
      { type: "string", key: "serverIntegrity", size: 2000, required: true },
      { type: "string", key: "schemeVersion", size: 16, required: true },
      { type: "string", key: "planType", size: 32, required: true },
      { type: "string", key: "fallbackPlanType", size: 32, required: true },
      { type: "datetime", key: "planExpiresAt", required: false },
      { type: "string", key: "provider", size: 32, required: false },
      { type: "string", key: "groupPlans", size: 64, required: false, array: true },
    ],
  },
  {
    db: "data_main",
    id: "group_members",
    name: "group_members",
    // from MemberDocumentRaw.from — `data` attr maps to model field `data`
    attributes: [
      { type: "string", key: "ownerUserId", size: 64, required: true },
      { type: "string", key: "groupId", size: 64, required: true },
      { type: "integer", key: "groupKeyVersion", required: true },
      { type: "integer", key: "memberKeyVersion", required: true },
      { type: "string", key: "verification", size: 2000, required: true },
      { type: "string", key: "resourceData", size: 4000, required: true },
      { type: "string", key: "paralinoId", size: 64, required: false },
      { type: "string", key: "locationIds", size: 64, required: false, array: true },
    ],
  },
  {
    db: "data_main",
    id: "group_settings",
    name: "group_settings",
    // from GroupSettingsRaw
    attributes: [
      { type: "string", key: "ownerUserId", size: 64, required: true },
      { type: "string", key: "groupId", size: 64, required: true },
      { type: "string", key: "memberIntegrity", size: 2000, required: true },
      { type: "string", key: "groupIntegrity", size: 2000, required: false },
      { type: "integer", key: "memberIntegrityUserKeyVersion", required: true },
      { type: "integer", key: "groupIntegrityUserKeyVersion", required: false },
      { type: "string", key: "batteryAlertSettings", size: 2000, required: false },
    ],
  },
  {
    db: "data_main",
    id: "locations",
    name: "locations",
    // from MemberLocationRaw — group member live locations
    attributes: [
      { type: "string", key: "deviceId", size: 64, required: true },
      { type: "integer", key: "groupKeyVersion", required: true },
      { type: "integer", key: "deviceKeyVersion", required: true },
      { type: "string", key: "deviceData", size: 4000, required: false },
      { type: "string", key: "locationData", size: 4000, required: false },
      { type: "string", key: "locationHistory", size: 4000, required: false },
      { type: "string", key: "status", size: 1000, required: false },
    ],
  },
  {
    db: "data_main",
    id: "personal_locations",
    name: "personal_locations",
    // from UserDeviceLocationRaw — keyed by deviceId as $id
    attributes: [
      { type: "string", key: "locationData", size: 4000, required: false },
      { type: "string", key: "status", size: 1000, required: false },
      { type: "string", key: "locationHistory", size: 4000, required: false },
    ],
  },
  {
    db: "data_main",
    id: "personal_ids",
    name: "personal_ids",
    // from PersonalCodeRaw — Paralino ID personal codes
    attributes: [
      { type: "string", key: "keyId", size: 64, required: true },
      { type: "string", key: "ownerUserId", size: 64, required: true },
      { type: "string", key: "encryptedCode", size: 2000, required: true },
      { type: "string", key: "encryptedCodeUserData", size: 4000, required: false },
      { type: "integer", key: "userKeyVersion", required: false },
    ],
  },
  {
    db: "data_main",
    id: "personal_id_keys",
    name: "personal_id_keys",
    // from PersonalPreKeyRaw — pre-key bundles for ID exchange
    attributes: [
      { type: "string", key: "ownerUserId", size: 64, required: true },
      { type: "string", key: "encryptedUserKeys", size: 4000, required: true },
      { type: "string", key: "integrity", size: 2000, required: true },
      { type: "integer", key: "userKeyVersion", required: false },
      { type: "string", key: "encryptedCodeKeyData", size: 4000, required: false },
    ],
  },
  {
    db: "data_main",
    id: "blocked",
    name: "blocked",
    // from BlocklistRaw
    attributes: [
      { type: "string", key: "ownerUserId", size: 64, required: true },
      { type: "string", key: "resourceId", size: 64, required: true },
      { type: "string", key: "resourceType", size: 64, required: true },
      { type: "string", key: "data", size: 4000, required: false },
      { type: "integer", key: "userKeyVersion", required: false },
    ],
  },
  {
    db: "data_main",
    id: "push_notifications",
    name: "push_notifications",
    // from PushNotificationRaw — createdAt is the system $createdAt
    attributes: [
      { type: "datetime", key: "expiresAt", required: false },
      { type: "string", key: "deviceId", size: 64, required: false },
      { type: "string", key: "eventId", size: 64, required: false },
      { type: "string", key: "type", size: 64, required: true },
      { type: "string", key: "importance", size: 32, required: true },
      { type: "string", key: "content", size: 4000, required: false },
    ],
  },
  {
    db: "data_main",
    id: "location_focus",
    name: "location_focus",
    // from LocationFocusRaw — map focus signaling
    attributes: [
      { type: "string", key: "ownerUserId", size: 64, required: true },
      { type: "string", key: "groupId", size: 64, required: true },
    ],
  },
  {
    db: "data_main",
    id: "group_device_keys",
    name: "group_device_keys",
    // from GroupDeviceCryptoKeyRaw — per-device sender keys
    attributes: [
      { type: "string", key: "groupId", size: 64, required: true },
      { type: "string", key: "memberUserId", size: 64, required: true },
      { type: "string", key: "ownerUserId", size: 64, required: true },
      { type: "string", key: "locationId", size: 64, required: true },
      { type: "integer", key: "memberKeyVersion", required: true },
      { type: "integer", key: "deviceKeyVersion", required: true },
      { type: "string", key: "encryptedSenderKey", size: 4000, required: true },
    ],
  },
  {
    db: "data_main",
    id: "privacy_zones",
    name: "privacy_zones",
    // from CreatePrivacyZonePayload — resourceData holds the encrypted zone
    attributes: [
      { type: "string", key: "ownerUserId", size: 64, required: true },
      { type: "string", key: "groupId", size: 64, required: true },
      { type: "integer", key: "userKeyVersion", required: true },
      { type: "string", key: "resourceData", size: 4000, required: true },
    ],
  },
  {
    db: "data_main",
    id: "places",
    name: "places",
    // from GroupPlaceRaw (CreatePlacePayload) — `data` attr = resourceData
    attributes: [
      { type: "string", key: "ownerUserId", size: 64, required: true },
      { type: "string", key: "groupId", size: 64, required: true },
      { type: "integer", key: "keyVersion", required: true },
      { type: "string", key: "resourceData", size: 4000, required: true },
      { type: "boolean", key: "isInPersonalSpace", required: true },
      { type: "string", key: "eventKeys", size: 64, required: false, array: true },
    ],
  },
  {
    db: "data_main",
    id: "places_settings",
    name: "places_settings",
    // from GroupPlaceSettingRaw — per-device place alert settings
    attributes: [
      { type: "string", key: "groupId", size: 64, required: true },
      { type: "string", key: "placeId", size: 64, required: true },
      { type: "string", key: "ownerUserId", size: 64, required: true },
      { type: "string", key: "deviceId", size: 64, required: false },
      { type: "string", key: "alertData", size: 4000, required: true },
    ],
  },
];

async function main() {
  for (const [id, name] of Object.entries(DATABASES)) {
    console.log(`database: ${id}`);
    await api("POST", "/databases", { databaseId: id, name });
  }

  for (const col of COLLECTIONS) {
    console.log(`collection: ${col.db}/${col.id}`);
    await api("POST", `/databases/${col.db}/collections`, {
      collectionId: col.id,
      name: col.name,
      documentSecurity: true,
      permissions: [],
    });

    for (const attr of col.attributes) {
      const base = `/databases/${col.db}/collections/${col.id}/attributes`;
      const payload = { key: attr.key, required: attr.required ?? false };
      let path;
      if (attr.type === "string") {
        path = `${base}/string`;
        payload.size = attr.size;
      } else if (attr.type === "integer") {
        path = `${base}/integer`;
      } else if (attr.type === "datetime") {
        path = `${base}/datetime`;
      } else {
        throw new Error(`unknown attr type ${attr.type}`);
      }
      await api("POST", path, payload);
    }
  }

  console.log("done.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
