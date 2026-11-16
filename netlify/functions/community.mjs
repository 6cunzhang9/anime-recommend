import { getUser, readJson, RequestError } from "../shared/auth.mjs";
import v4 from "../../v4-validation.js";
import { errorResponse, jsonResponse, readAllRatings, readAllRecords } from "../shared/store.mjs";
import { listWatchlist } from "../shared/watchlist.mjs";

const MAX_BODY_BYTES = 8 * 1024;

export const config = {
  path: "/api/community",
  method: "POST",
  rateLimit: {
    action: "rate_limit",
    aggregateBy: "ip",
    windowSize: 60,
    windowLimit: 20
  }
};

export default async function handler(req) {
  try {
    const payload = await readJson(req, MAX_BODY_BYTES);
    const user = await getUser(req);
    const [records, ratings, list] = await Promise.all([
      payload.consent_similar === true ? readAllRecords() : [],
      readAllRatings(), user ? listWatchlist(user.id) : []
    ]);
    const community = v4.buildCommunity(records, ratings, { ...payload, accountOwner: user?.id });
    const watched = new Set(list.filter(({ status }) => status === "watched").map(({ work }) => v4.workIdentity(work)));
    const available = (items) => items.filter(({ external_ref }) => !watched.has(v4.workIdentity(external_ref)));
    const similar = available(community.similar);
    const suggestions = available(community.community);
    return jsonResponse({ ok: true, available_similar: Boolean(similar.length), similar,
      available_community: Boolean(suggestions.length), community: suggestions });
  } catch (error) {
    if (error instanceof RequestError) return errorResponse(error.status, error.message);
    console.error("community function failed:", error);
    return errorResponse(500, "读取社区聚合失败");
  }
}
