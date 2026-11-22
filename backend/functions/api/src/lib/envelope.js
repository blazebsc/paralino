/**
 * Wire envelope — mirrors FunctionResponse<T> / FunctionErrorBody on the client.
 * Exact shapes, do not "improve".
 */

export function ok(res, data, status = 200) {
  return res.json({ data }, status);
}

export function fail(res, code, type = "general_error", message = "error") {
  return res.json({ data: { type, message, code } }, code);
}

/** Parse the JSON string body the client sends via createExecution body. */
export function readBody(req) {
  if (req.bodyJson !== undefined) return req.bodyJson;
  const raw = req.body;
  if (!raw || typeof raw !== "string") return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}
