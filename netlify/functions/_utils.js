// netlify/functions/_utils.js
export function jsonResponse(status = 200, data = {}, extraHeaders = {}) {
  return {
    statusCode: status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      ...extraHeaders,
    },
    body: JSON.stringify(data),
  };
}

export function withCORS(handler) {
  return async (event, context) => {
    if (event.httpMethod === "OPTIONS") return jsonResponse(200, { ok: true });
    try {
      const res = await handler(event, context);
      // بعض المكتبات ترجع Response جاهز — نتأكد من الهيدر
      if (res && typeof res === "object" && "statusCode" in res) {
        res.headers = {
          ...(res.headers || {}),
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Headers": "Content-Type, Authorization",
          "Access-Control-Allow-Methods": "POST, OPTIONS",
        };
      }
      return res;
    } catch (err) {
      console.error("Unhandled error:", err);
      return jsonResponse(500, { error: "Internal Server Error" });
    }
  };
}

export function safeParse(body, fallback = {}) {
  try {
    return JSON.parse(body || "{}");
  } catch {
    return fallback;
  }
}
