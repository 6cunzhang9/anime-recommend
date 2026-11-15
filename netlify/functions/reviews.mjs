import { threadSummary } from "../shared/discussions.mjs";
import v4 from "../../v4-validation.js";
import { errorResponse, jsonResponse } from "../shared/store.mjs";

import { cursorPattern, pagePosts, readPostRecords } from "../shared/posts.mjs";

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
    const type = ["review", "favorite"].includes(params.get("type")) ? params.get("type") : "";
    const page = pagePosts(await readPostRecords(type), { query, cursor, type });
    const posts = await Promise.all(page.posts.map(async (post) => ({ ...post, ...(await threadSummary(post.id)) })));
    return jsonResponse({ ok: true, ...page, posts });
  } catch (error) {
    console.error("reviews function failed:", error);
    return errorResponse(500, "读取树洞评价失败");
  }
}
