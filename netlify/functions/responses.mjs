import { errorResponse, getResponsesStore, jsonResponse, responseKey } from "../shared/store.mjs";
import { ValidationError, validateQuestionnaire } from "../shared/validation.mjs";

const MAX_BODY_BYTES = 220 * 1024;

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

    const record = validateQuestionnaire(payload);
    if (!record.consent.profile_storage) {
      return errorResponse(400, "用户未允许保存画像");
    }
    const store = getResponsesStore();
    const result = await store.setJSON(responseKey(record.response_id), record, { onlyIfNew: true });
    if (!result.modified) {
      return jsonResponse({ ok: true, id: record.response_id, duplicate: true, receivedAt: record.received_at }, 200);
    }
    return jsonResponse({ ok: true, id: record.response_id, receivedAt: record.received_at }, 201);
  } catch (error) {
    if (error instanceof ValidationError) return errorResponse(error.status, error.message);
    console.error("responses function failed:", error);
    return errorResponse(500, "服务器保存问卷失败，请稍后再试");
  }
}
