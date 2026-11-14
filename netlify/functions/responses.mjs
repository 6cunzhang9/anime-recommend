import { errorResponse, getResponsesStore, jsonResponse, responseKey } from "../shared/store.mjs";
import { ValidationError, validateRecord } from "../shared/validation.mjs";

const MAX_BODY_BYTES = 160 * 1024;

export const config = {
  path: "/api/responses",
  method: "POST",
  rateLimit: {
    action: "rate_limit",
    aggregateBy: "ip",
    windowSize: 60,
    windowLimit: 10
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
      return errorResponse(413, "请求内容过长");
    }

    let payload;
    try {
      payload = JSON.parse(raw);
    } catch {
      return errorResponse(400, "请求内容不是合法的 JSON");
    }

    const record = validateRecord(payload);
    const store = getResponsesStore();
    const key = responseKey(record.id);
    const result = await store.setJSON(key, record, { onlyIfNew: true });

    if (!result.modified) {
      return jsonResponse({ ok: true, id: record.id, duplicate: true, receivedAt: record.receivedAt }, 200);
    }

    return jsonResponse({ ok: true, id: record.id, receivedAt: record.receivedAt }, 201);
  } catch (error) {
    if (error instanceof ValidationError) return errorResponse(error.status, error.message);
    console.error("responses function failed:", error);
    return errorResponse(500, "服务器保存样本失败，请稍后再试");
  }
}
