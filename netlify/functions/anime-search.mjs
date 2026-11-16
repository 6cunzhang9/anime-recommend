import { lookupWorks, seriesFor, workDetails } from "../shared/work-search.mjs";
import { errorResponse, jsonResponse } from "../shared/store.mjs";

export const config = {
  path: "/api/anime-search",
  method: "GET",
  rateLimit: { action: "rate_limit", aggregateBy: "ip", windowSize: 60, windowLimit: 40 }
};

const browserCache = { "Netlify-CDN-Cache-Control": "public, s-maxage=600, stale-while-revalidate=300" };
const publicResult = (data) => jsonResponse({ ok: true, ...data }, 200, browserCache);

export default async function handler(req) {
  const params = new URL(req.url).searchParams;
  const id = params.get("id") || params.get("related");
  try {
    if (id !== null) {
      if (!/^\d{1,12}$/.test(id)) return errorResponse(400, "作品编号无效");
      if (params.has("related")) return publicResult(await seriesFor(id));
      const data = await workDetails(id);
      return data ? publicResult(data) : errorResponse(404, "作品不存在");
    }
    const keyword = params.get("q")?.trim() || "";
    if (!keyword || keyword.length > 120) return errorResponse(400, "请输入 1–120 字的搜索内容");
    return publicResult(await lookupWorks(keyword, params.get("mode")));
  } catch (error) {
    console.warn("Bangumi lookup:", error.message);
    return errorResponse(502, "作品索引暂时繁忙，请稍后再试");
  }
}
