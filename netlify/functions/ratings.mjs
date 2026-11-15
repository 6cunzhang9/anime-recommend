import { errorResponse, getResponsesStore, jsonResponse, ratingKey } from "../shared/store.mjs";
import { ValidationError, validateRating } from "../shared/validation.mjs";

const MAX_BODY_BYTES = 20 * 1024;

export const config = {
  path: "/api/ratings",
  method: "POST",
  rateLimit: {
    action: "rate_limit",
    aggregateBy: "ip",
    windowSize: 60,
    windowLimit: 30
  }
};

export default async function handler(req) {
  try {
    const contentType = String(req.headers.get("content-type") || "");
    if (!contentType.includes("application/json")) {
      return errorResponse(415, "Content-Type must be application/json");
    }
    const raw = await req.text();
    if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) {
      return errorResponse(413, "评价内容过长");
    }
    let payload;
    try {
      payload = JSON.parse(raw);
    } catch {
      return errorResponse(400, "请求内容不是合法的 JSON");
    }
    const rating = validateRating(payload);
    const store = getResponsesStore();
    await store.setJSON(ratingKey(rating.id), rating);
    return jsonResponse({ ok: true, id: rating.id, received_at: rating.received_at }, 201);
  } catch (error) {
    if (error instanceof ValidationError) return errorResponse(error.status, error.message);
    console.error("ratings function failed:", error);
    return errorResponse(500, "服务器保存评价失败，请稍后再试");
  }
}
