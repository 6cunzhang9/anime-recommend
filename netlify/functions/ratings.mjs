import v4 from "../../v4-validation.js";
import { checkAccountContext, digest, getUser, keyPart, readJson, RequestError } from "../shared/auth.mjs";
import { errorResponse, getResponsesStore, jsonResponse, ratingKey } from "../shared/store.mjs";
import { changeEntry, packRating, publicationFor } from "../shared/records.mjs";
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
    const payload = await readJson(req, MAX_BODY_BYTES);
    const user = await getUser(req);
    checkAccountContext(payload, user);
    const store = getResponsesStore();
    if (!user) return errorResponse(401, "登录后即可匿名发布评价");
    if (payload.action === "delete") {
      if (!keyPart.test(payload.id || "")) return errorResponse(400, "评价编号无效");
      await store.delete(ratingKey(payload.id, user.id));
      return jsonResponse({ ok: true });
    }
    const rating = validateRating(payload);
    if (!keyPart.test(rating.id)) return errorResponse(400, "评价编号无效");
    const editing = payload.action === "update";
    if (rating.rating === null && !rating.comment && !rating.reason_tags.length && rating.sentiment === "neutral") {
      return errorResponse(400, "请填写评分、感受或短评后再发布");
    }

    rating.id = editing ? rating.id : digest(`${user.id}:${v4.workIdentity(rating.external_ref)}`);
    const key = ratingKey(rating.id, user.id);
    const result = await changeEntry(store, key, (previous) => {
      if (editing && !previous) return null;
      const publication = publicationFor(previous || {}) || {
        published_at: rating.received_at, moderated: false
      };
      return packRating({ ...rating, external_ref: previous?.external_ref || rating.external_ref,
        created_at: previous?.created_at || rating.received_at,
        updated_at: rating.received_at,
        anonymous_use: Boolean(publication), public_review: Boolean(publication),
        ...(publication && { publication })
      });
    });
    if (result.conflict) return errorResponse(409, "评价已变更，请重试");
    if (!result.record) return errorResponse(404, "评价已删除或不存在");
    return jsonResponse({ ok: true, rating: result.record, duplicate: !result.modified }, result.modified ? 201 : 200);
  } catch (error) {
    if (error instanceof ValidationError || error instanceof RequestError) return errorResponse(error.status, error.message);
    console.error("ratings function failed:", error);
    return errorResponse(500, "服务器保存评价失败，请稍后再试");
  }
}
