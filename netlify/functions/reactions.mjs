import { checkCanPublish } from "../shared/members.mjs";
import { checkAccountContext, getUser, readJson, RequestError } from "../shared/auth.mjs";
import { errorResponse, getRecord, getResponsesStore, jsonResponse, reactionKey } from "../shared/store.mjs";
import { ValidationError, validateFeedback } from "../shared/validation.mjs";

const MAX_BODY_BYTES = 12 * 1024;

export const config = {
  path: "/api/reactions",
  method: "POST",
  rateLimit: {
    action: "rate_limit",
    aggregateBy: "ip",
    windowSize: 60,
    windowLimit: 40
  }
};

export default async function handler(req) {
  try {
    const payload = await readJson(req, MAX_BODY_BYTES);
    const user = await getUser(req);
    checkAccountContext(payload, user);
    if (payload.action === "delete") {
      if (!user || typeof payload.responseId !== "string" || typeof payload.animeId !== "string" ||
        !/^[A-Za-z0-9_-]{6,100}$/.test(payload.responseId) || !/^[A-Za-z0-9_-]{1,100}$/.test(payload.animeId)) {
        return errorResponse(400, "反馈编号无效");
      }
      await getResponsesStore().delete(reactionKey(payload.responseId, payload.animeId, user.id));
      return jsonResponse({ ok: true });
    }
    if (user) await checkCanPublish(user);
    const feedback = validateFeedback(payload);
    const record = await getRecord(feedback.responseId, user?.id);
    if (!record) return errorResponse(404, "找不到对应的匿名问卷");
    const recommended = (record.recommendation_snapshot?.top || []).some((item) => item.anime_id === feedback.animeId);
    if (!recommended) return errorResponse(400, "只能反馈本次推荐的作品");
    const store = getResponsesStore();
    await store.setJSON(reactionKey(feedback.responseId, feedback.animeId, user?.id), feedback);
    return jsonResponse({ ok: true, receivedAt: feedback.receivedAt }, 201);
  } catch (error) {
    if (error instanceof ValidationError || error instanceof RequestError) return errorResponse(error.status, error.message);
    console.error("reactions function failed:", error);
    return errorResponse(500, "服务器保存反馈失败，请稍后再试");
  }
}
