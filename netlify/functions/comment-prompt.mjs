import { getUser, readJson, RequestError } from "../shared/auth.mjs";
import { errorResponse, jsonResponse } from "../shared/store.mjs";
import { pickCommentPrompt, rateComment } from "../shared/comment-data.mjs";

export const config = {
  path: "/api/comment-prompt",
  method: ["GET", "POST"],
  rateLimit: { action: "rate_limit", aggregateBy: "ip", windowSize: 60, windowLimit: 30 }
};

export default async function handler(req) {
  try {
    const user = await getUser(req);
    if (!user) return errorResponse(401, "登录后可以查看匿名评论");
    if (req.method === "GET") {
      const comment = await pickCommentPrompt(user);
      return jsonResponse({ ok: true, comment });
    }
    const payload = await readJson(req, 2000);
    const accepted = await rateComment(user, payload.comment_kind, payload.comment_id, Number(payload.score));
    if (!accepted) return errorResponse(409, "这条评论已经评过分，或当前不可评分");
    return jsonResponse({ ok: true });
  } catch (error) {
    if (error instanceof RequestError) return errorResponse(error.status, error.message);
    console.error("Comment prompt:", error);
    return errorResponse(500, "匿名评论暂时不可用");
  }
}
