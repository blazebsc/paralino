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

/** Parse the body the client sends via createExecution. */
export function readBody(req) {
  // bodyJson is a throwing getter on non-JSON bodies — guard it.
  try {
    if (req.bodyJson !== undefined && req.bodyJson !== null) return req.bodyJson;
  } catch { /* body is not valid JSON — fall through to raw text */ }
  let raw;
  try {
    raw = req.bodyText ?? req.body;
  } catch {
    return {};
  }
  if (!raw || typeof raw !== "string") return raw ?? {};
  try {
    return JSON.parse(raw);
  } catch {
    return raw; // plain-text body (e.g. POST /login sends a bare email string)
  }
}
