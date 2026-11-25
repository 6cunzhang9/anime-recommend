import watch from "../../watch-model.js";
import { checkAccountContext, getUser, readJson, RequestError } from "../shared/auth.mjs";
import { changeWatchlist, importWatchlist, listWatchlist } from "../shared/watchlist.mjs";
import { findWorkProfile, profileTags, readWorkProfileIndex } from "../shared/work-features.mjs";
import { errorResponse, jsonResponse } from "../shared/store.mjs";

export const config = { path: "/api/watchlist", method: ["GET", "POST"],
  rateLimit: { action: "rate_limit", aggregateBy: "ip", windowSize: 60, windowLimit: 60 } };

export default async function handler(req) {
  try {
    const user = await getUser(req);
    if (!user) return errorResponse(401, "请登录后查看追番清单");
    if (req.method === "GET") {
      const rawItems = await listWatchlist(user.id);
      const index = await readWorkProfileIndex();
      const items = rawItems.map((item) => ({
        ...item,
        internalTags: profileTags(findWorkProfile(index, item.work))
      }));
      const tagCounts = new Map();
      for (const item of items) {
        for (const tag of item.internalTags) tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
      }
      const internalTags = [...tagCounts].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([tag]) => tag);
      return jsonResponse({ ok: true, items, stats: { ...watch.tastes(items), internalTags } });
    }
    const payload = await readJson(req, 14000);
    checkAccountContext(payload, user);
    if (payload.action === "import") return jsonResponse({ ok: true, matches: await importWatchlist(user.id, payload.lines, payload.status) });
    return jsonResponse({ ok: true, item: await changeWatchlist(user.id, payload) });
  } catch (error) {
    if (error instanceof RequestError || error.status === 400) return errorResponse(error.status, error.message);
    console.error("Watchlist:", error);
    return errorResponse(500, "追番清单暂时不可用");
  }
}
