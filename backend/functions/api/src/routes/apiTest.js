/**
 * POST /api-test  (ServerFunction.TEST_API / TEST_PING / TEST_LOCATION_UPLOAD / TEST_HISTORY_UPLOAD)
 *
 * Connection-test probe — the client only checks isSuccess (2xx + {"data": ...}).
 * Lives in every function deployment so the connection test can verify all four.
 * Client caller: core-domain/.../domain/user/ServerConnectionTestUseCase.kt
 */

import { ok } from "../lib/envelope.js";

export async function apiTest({ res }) {
  return ok(res, {});
}
