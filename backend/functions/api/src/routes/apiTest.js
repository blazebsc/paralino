/**
 * POST /api-test  (ServerFunction.TEST_API / TEST_PING / TEST_LOCATION_UPLOAD / TEST_HISTORY_UPLOAD)
 *
 * Connection-test probe — the client only checks isSuccess (2xx + {"data": ...}).
 * Lives in every function deployment so the connection test can verify all four.
 * Client caller: core-domain/.../domain/user/ServerConnectionTestUseCase.kt
 */

import { ok } from "../lib/envelope.js";

export async function apiTest({ res, log }) {
  // Env var NAMES only (never values) — helps diagnose injected variables.
  log(`env keys: ${Object.keys(process.env).filter((k) => k.startsWith("APPWRITE")).join(",") || "none"}`);
  return ok(res, {});
}
