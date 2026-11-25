import v4 from "../../v4-validation.js";
import { errorResponse, jsonResponse } from "../shared/store.mjs";
import { findWorkCommentAggregate, readWorkCommentIndex } from "../shared/comment-data.mjs";
import { findWorkProfile, findWorkRating, publicWorkProfile, readWorkProfileIndex, readWorkRatingIndex } from "../shared/work-features.mjs";

export const config = {
  path: "/api/work-features",
  method: "GET",
  rateLimit: { action: "rate_limit", aggregateBy: "ip", windowSize: 60, windowLimit: 90 }
};

function fromQuery(params) {
  const provider = params.get("provider") || "";
  const providerId = params.get("id") || "";
  const title = params.get("title") || "";
  if (!["bangumi", "bangumi-series", "anilist", "anilist-candidate-snapshot", "manual"].includes(provider) ||
    !/^\d{1,12}$/.test(providerId) && provider !== "manual") {
    return null;
  }
  return v4.validateExternalRef({
    provider,
    provider_id: providerId,
    title_display: title,
    lookup_status: "matched"
  }, true);
}

export default async function handler(req) {
  try {
    const ref = fromQuery(new URL(req.url).searchParams);
    if (!ref) return errorResponse(400, "作品引用不完整");
    const [index, ratings, comments] = await Promise.all([
      readWorkProfileIndex(), readWorkRatingIndex(), readWorkCommentIndex()
    ]);
    const profile = findWorkProfile(index, ref);
    return jsonResponse({ ok: true, profile: publicWorkProfile(ref, profile, findWorkRating(ratings, ref),
      findWorkCommentAggregate(comments, ref)) });
  } catch (error) {
    console.error("Work features:", error);
    return errorResponse(500, "作品特征暂时不可用");
  }
}
