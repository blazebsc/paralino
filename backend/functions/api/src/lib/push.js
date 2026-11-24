/**
 * UnifiedPush wake-up sender.
 *
 * Clients register a push endpoint per device (devices.pushProviderConfig,
 * a JSON string: { distributor, url, pubkey?, auth? }). When something
 * happens another member's app should know about (focus ping, member
 * joined, place changed), we POST a "wake up and sync" message to their
 * endpoint. The body is opaque — the client reacts to ANY message by
 * syncing, so we send a tiny fixed payload.
 *
 * Endpoints with pubkey+auth are UnifiedPush v2 (RFC 8291 WebPush
 * encryption, aes128gcm content coding) — ntfy and Sunup both register
 * with keys. Endpoints without keys get a plain POST (older distributors).
 *
 * Fire-and-forget: push failures must never fail the triggering request.
 */

import crypto from "node:crypto";
import { listDocuments, Query } from "./appwrite.js";

const DB = "data_main";
const BUILT_IN_DISTRIBUTOR = "app.paralino.android";
const WAKE_PAYLOAD = "1";
const TTL_SECONDS = "300";

function b64uToBuf(s) {
  return Buffer.from(s, "base64url");
}

/** RFC 8291 aes128gcm encryption (ECDH P-256 + AES-128-GCM). */
export function encryptWebPush(clientPubB64u, authB64u, payload) {
  const clientPub = b64uToBuf(clientPubB64u);
  const authSecret = b64uToBuf(authB64u);
  if (clientPub.length !== 65) {
    throw new Error(`bad client pubkey length ${clientPub.length}`);
  }

  const ecdh = crypto.createECDH("prime256v1");
  const asPub = Buffer.from(ecdh.generateKeys()); // 65-byte uncompressed point
  const ecdhSecret = ecdh.computeSecret(clientPub);

  // PRK_key = HKDF(salt=auth_secret, ikm=ecdh_secret, "WebPush: info" 0x00 uaPub asPub)  [RFC 8291 §3.3]
  const prkKey = crypto.hkdfSync(
    "sha256",
    ecdhSecret,
    authSecret,
    Buffer.concat([Buffer.from("WebPush: info", "ascii"), Buffer.from([0]), clientPub, asPub]),
    32
  );
  const salt = crypto.randomBytes(16);
  // CEK/NONCE = HKDF(salt=record salt, ikm=PRK_key, ...)  [RFC 8291 §3.4]
  const cek = crypto.hkdfSync("sha256", Buffer.from(prkKey), salt, Buffer.from("Content-Encoding: aes128gcm", "ascii"), 16);
  const nonce = crypto.hkdfSync("sha256", Buffer.from(prkKey), salt, Buffer.from("Content-Encoding: nonce", "ascii"), 12);

  const cipher = crypto.createCipheriv("aes-128-gcm", Buffer.from(cek), Buffer.from(nonce));
  const ciphertext = Buffer.concat([
    cipher.update(Buffer.concat([Buffer.from(payload, "ascii"), Buffer.from([0x02])])),
    cipher.final(),
    cipher.getAuthTag(), // aes128gcm carries the 16-byte tag at the end of the record
  ]);

  // aes128gcm record header: salt(16) | rs(4 BE) | idlen(1) | as_pub(65)
  const header = Buffer.alloc(21);
  salt.copy(header, 0);
  header.writeUInt32BE(4096, 16);
  header.writeUInt8(asPub.length, 20);
  return Buffer.concat([header, asPub, ciphertext]);
}

/** POST one wake-up to an endpoint. Never throws. */
async function postWake(log, url, cfg) {
  try {
    const headers = { TTL: TTL_SECONDS };
    let body = WAKE_PAYLOAD;
    if (cfg.pubkey && cfg.auth) {
      body = encryptWebPush(cfg.pubkey, cfg.auth, WAKE_PAYLOAD);
      headers["Content-Encoding"] = "aes128gcm";
    }
    const r = await fetch(url, { method: "POST", body, headers });
    if (!r.ok) {
      log(`push wake ${r.status} for ${url.slice(0, 60)}`);
    }
  } catch (e) {
    log(`push wake failed: ${e?.message}`);
  }
}

/**
 * Wake all UnifiedPush-registered devices of the given users.
 * Skips the built-in distributor (no server-side socket in this fork).
 */
export async function wakeDevices(log, userIds) {
  const ids = [...new Set(userIds.filter(Boolean))];
  if (!ids.length) return;
  const chunks = [];
  for (let i = 0; i < ids.length; i += 30) chunks.push(ids.slice(i, i + 30));
  for (const chunk of chunks) {
    const devices = await listDocuments(DB, "devices", [
      Query.equal("ownerUserId", chunk),
      Query.limit(100),
    ]).catch(() => null);
    for (const d of devices?.json?.documents ?? []) {
      if (!d.pushProviderConfig) continue;
      let cfg;
      try {
        cfg = JSON.parse(d.pushProviderConfig);
      } catch {
        continue;
      }
      if (!cfg?.url || !/^https?:\/\//.test(cfg.url)) continue;
      if (cfg.distributor === BUILT_IN_DISTRIBUTOR) continue;
      await postWake(log, cfg.url, cfg);
    }
  }
}

/** Wake every member of a group (optionally excluding the acting user). */
export async function wakeGroupMembers(log, groupId, exceptUserId = null) {
  const members = await listDocuments(DB, "group_members", [
    Query.equal("groupId", [groupId]),
    Query.limit(100),
  ]).catch(() => null);
  const userIds = (members?.json?.documents ?? []).map((m) => m.ownerUserId).filter((id) => id !== exceptUserId);
  await wakeDevices(log, userIds);
}
