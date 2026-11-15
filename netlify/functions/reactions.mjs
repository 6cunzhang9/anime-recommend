import { errorResponse, getRecord, getResponsesStore, jsonResponse, reactionKey } from "../shared/store.mjs";
import { ValidationError, validateReaction } from "../shared/validation.mjs";

const MAX_BODY_BYTES = 8 * 1024;

export const config = {
  path: "/api/reactions",
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
      return errorResponse(413, "反馈内容过长");
    }
    let payload;
    try {
      payload = JSON.parse(raw);
    } catch {
      return errorResponse(400, "请求内容不是合法的 JSON");
    }

    const reaction = validateReaction(payload);
    const record = await getRecord(reaction.responseId);
    if (!record) return errorResponse(404, "找不到对应的匿名样本");
    const allowed = (record.recommendations || []).some((item) => item.animeId === reaction.animeId);
    if (!allowed) return errorResponse(400, "只能反馈本次推荐的作品");

    const store = getResponsesStore();
    await store.setJSON(reactionKey(reaction.responseId, reaction.animeId), reaction);
    return jsonResponse({ ok: true, receivedAt: reaction.receivedAt }, 201);
  } catch (error) {
    if (error instanceof ValidationError) return errorResponse(error.status, error.message);
    console.error("reactions function failed:", error);
    return errorResponse(500, "服务器保存反馈失败，请稍后再试");
  }
}
