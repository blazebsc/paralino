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
  return ok(res, {
    // fork extension: lets the app self-configure from a single url
    serverUrl: process.env.APPWRITE_FUNCTION_API_ENDPOINT || "",
    projectId: process.env.APPWRITE_FUNCTION_PROJECT_ID || "",
    bulkLocationApiThreshold: 3,
    planGracePeriodFallbackSeconds: 43200,
    defaultPremiumPlan: "free",
    plans: PLANS,
  });
}
