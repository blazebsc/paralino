/**
 * GET /config  (ServerFunction.CONFIG — public, no auth)
 *
 * Served by the backend function itself so self-hosters expose ONE url:
 * the function domain doubles as the "public server". The response carries
 * the Appwrite endpoint + project id so the app can be pointed at a server
 * by entering a single url during onboarding.
 *
 * Response envelope matches RemoteConfigRepository parsing: {"data": {...}}
 * with keys stored per RemoteConfigEntity. Also serves the unlimited plan.
 *
 * NO_AUTH route — this is the unauthenticated bootstrap endpoint.
 */

import { ok } from "../lib/envelope.js";

const PLANS = [
  {
    planType: "free",
    groupsLimit: 999999,
    membersLimit: 999999,
    devicesLimit: 999999,
    placesLimit: 999999,
    privacyZonesLimit: 999999,
    personalPlacesLimit: 999999,
    historyDaysLimit: -1,
    personalHistoryDaysLimit: -1,
    paralinoIdsLimit: 999999,
    personalDevicesLimit: 999999,
    hasLocationRequests: true,
    hasOngoingRealtime: true,
    hasBestLocationPerformance: true,
    hasPremiumMapStyles: true,
    hasPremiumSatelliteMaps: true,
    hasSharingAlerts: true,
    hasLowBatteryAlerts: true,
    hasPersonalSpace: true,
    isPaid: false,
    isPremium: false,
    isActive: true,
    productIds: ["free"],
    productPlanIds: ["free"],
    planName: "Self-Hosted",
    planOrder: 3000,
  },
];

export async function serverConfig({ res }) {
  // The client builds its endpoint as `${serverUrl}/v1`, so serverUrl must be
  // the bare origin — strip the /v1 the injected env var carries.
  const serverUrl = (process.env.APPWRITE_FUNCTION_API_ENDPOINT || "").replace(/\/v1\/?$/, "");

  // Optional self-update channel: when APP_LATEST_VERSION_CODE is set, older
  // clients get a soft "new version" prompt on launch that downloads
  // APP_DOWNLOAD_URL through the app's PackageInstaller flow. Update both
  // vars when you publish a new release. MAPTILER-style: unset = no prompts.
  const latestVersionCode = Number(process.env.APP_LATEST_VERSION_CODE || 0);
  const appDownloadUrl = process.env.APP_DOWNLOAD_URL || "";

  return ok(res, {
    // fork extension: lets the app self-configure from a single url
    serverUrl,
    projectId: process.env.APPWRITE_FUNCTION_PROJECT_ID || "",
    bulkLocationApiThreshold: 3,
    planGracePeriodFallbackSeconds: 43200,
    defaultPremiumPlan: "free",
    plans: PLANS,
    ...(latestVersionCode > 0 && appDownloadUrl
      ? {
          newVersionAndroid: latestVersionCode,
          newSoftVersionAndroid: latestVersionCode,
          androidAppUrl: appDownloadUrl,
        }
      : {}),
  });
}
