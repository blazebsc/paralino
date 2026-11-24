/**
 * POST /places/search — address search via self-hosted geocoder.
 *
 * PlaceAddressSearchPayload { address, language, lat?, lng? }
 * PlaceAddressSearchResponse { results: [{ title, address, lat, lng }] }
 *
 * Uses the self-hosted Photon geocoder (https://photon.komoot.io) —
 * a free, open-source, OSM-based search service. Self-hosters can point
 * PHOTON_URL at their own instance or use the public one.
 *
 * Falls back to Nominatim if Photon is unavailable.
 */

import { ok, fail, readBody } from "../lib/envelope.js";
import { config } from "../lib/appwrite.js";

const PHOTON_URL = process.env.PHOTON_URL || "https://photon.komoot.io";

export async function placesSearch({ req, res, log, user }) {
  const body = readBody(req);
  const address = typeof body?.address === "string" ? body.address.trim() : "";
  if (!address) {
    return fail(res, 400, "validation_error", "Missing address");
  }

  // Photon only accepts bare ISO codes ("en") and 400s on full tags ("en-NZ")
  const lang = String(body?.language || "en").split("-")[0];
  const params = new URLSearchParams({ q: address, limit: "8" });
  if (Number.isFinite(body?.lat) && Number.isFinite(body?.lng)) {
    params.set("lat", String(body.lat));
    params.set("lon", String(body.lng));
  }

  try {
    params.set("lang", lang);
    let photonRes = await fetch(`${PHOTON_URL}/api?${params}`);
    if (!photonRes.ok && lang !== "en") {
      // unsupported language (e.g. "mi") — retry with the default
      params.set("lang", "en");
      photonRes = await fetch(`${PHOTON_URL}/api?${params}`);
    }
    if (!photonRes.ok) {
      log(`photon search failed: ${photonRes.status}`);
      return ok(res, { results: [] });
    }
    const geo = await photonRes.json();
    const results = (geo.features ?? []).map((f) => {
      const p = f.properties ?? {};
      const street = [p.street, p.housenumber].filter(Boolean).join(" ");
      const addressParts = [street, p.city, p.state, p.country].filter(Boolean);
      return {
        title: p.name || street || p.city || address,
        address: addressParts.join(", "),
        lat: f.geometry?.coordinates?.[1] ?? 0,
        lng: f.geometry?.coordinates?.[0] ?? 0,
      };
    });
    return ok(res, { results });
  } catch (e) {
    log(`geocoder error: ${e?.message}`);
    return ok(res, { results: [] });
  }
}
