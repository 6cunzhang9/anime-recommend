import { errorResponse, jsonResponse } from "../shared/store.mjs";

export const config = {
  path: "/api/anime-search",
  method: "GET",
  rateLimit: { action: "rate_limit", aggregateBy: "ip", windowSize: 60, windowLimit: 40 }
};

export default async function handler(req) {
  const keyword = new URL(req.url).searchParams.get("q")?.trim() || "";
  if (!keyword || keyword.length > 120) return errorResponse(400, "请输入 1–120 字的作品名");
  try {
    const response = await fetch("https://api.bgm.tv/v0/search/subjects?limit=10", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "6cunzhang9/anime-recommend (https://github.com/6cunzhang9/anime-recommend)"
      },
      body: JSON.stringify({ keyword, sort: "match", filter: { type: [2], nsfw: false } }),
      signal: AbortSignal.timeout(4000)
    });
    if (!response.ok) throw new Error(`Bangumi returned ${response.status}`);
    const { data } = await response.json();
    if (!Array.isArray(data)) throw new Error("Unexpected Bangumi search response");
    const items = data.filter((item) => item?.type === 2 && Number.isSafeInteger(item.id) && (item.name_cn || item.name))
      .slice(0, 10)
      .map((item) => ({
        provider: "bangumi",
        provider_id: String(item.id),
        canonical_url: `https://bgm.tv/subject/${item.id}`,
        title_display: (item.name_cn || item.name).slice(0, 160),
        title_canonical: (item.name || item.name_cn).slice(0, 160),
        media_type: "unknown",
        lookup_status: "matched",
        year: /^\d{4}/.exec(item.date || "")?.[0] || ""
      }));
    return jsonResponse({ ok: true, items });
  } catch (error) {
    console.warn("Bangumi lookup failed:", error.message);
    return errorResponse(502, "暂时无法连接 Bangumi");
  }
}
