import { threadSummary } from "../shared/discussions.mjs";
import v4 from "../../v4-validation.js";
import { errorResponse, jsonResponse } from "../shared/store.mjs";

import { cursorPattern, pagePosts, readPostRecords } from "../shared/posts.mjs";
import { seriesFor } from "../shared/work-search.mjs";

export const config = {
  path: "/api/reviews",
  method: "GET",
  rateLimit: { action: "rate_limit", aggregateBy: "ip", windowSize: 60, windowLimit: 30 }
};

export default async function handler(req) {
  try {
    const params = new URL(req.url).searchParams;
    const cursor = params.get("before") || "";
    if (cursor && !cursorPattern.test(cursor)) return errorResponse(400, "分页标记无效");
    const query = v4.normalizeWorkTitle(params.get("q")?.slice(0, 120));
    const type = ["review", "favorite", "general"].includes(params.get("type")) ? params.get("type") : "";
    const board = params.get("board");
    if (board !== null && !/^\d{1,12}$/.test(board)) return errorResponse(400, "讨论区编号无效");
    const [records, group] = await Promise.all([readPostRecords(type), board ? seriesFor(board).catch(() => null) : null]);
    const page = pagePosts(records, { query, cursor, type, board: group?.series?.id || group?.root?.provider_id || board,
      related: group?.items.map(({ provider_id }) => provider_id) });
    const posts = await Promise.all(page.posts.map(async (post) => ({ ...post, ...(await threadSummary(post.id)) })));
    return jsonResponse({ ok: true, ...page, posts, board: group?.series || (group?.root ? { id: group.root.provider_id, title: group.root.title_display } : null) });
  } catch (error) {
    console.error("reviews function failed:", error);
    return errorResponse(500, "读取树洞评价失败");
  }
}
