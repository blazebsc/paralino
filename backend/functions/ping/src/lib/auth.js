/**
 * User context for SDK executions.
 *
 * When the client calls functions.createExecution with an active session,
 * Appwrite injects `x-appwrite-user-id` (and `x-appwrite-user-jwt`) into the
 * request the function receives. Clients cannot spoof these — Appwrite sets
 * them itself.
 *
 * ponytail: no JWT re-validation — we trust Appwrite-injected headers. If a
 * route ever needs to call the Appwrite API *as the user*, switch to JWT
 * (x-appwrite-user-jwt). API-key writes (env APPWRITE_API_KEY) cover doc
 * writes with explicit per-user permissions.
 */

export function currentUser(req) {
  const id = req.headers?.["x-appwrite-user-id"] || "";
  if (!id) return null;
  return { id };
}
