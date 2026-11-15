import { errorResponse, jsonResponse } from "../shared/store.mjs";

export const config = {
  path: "/api/anime-search",
  method: "GET",
  rateLimit: { action: "rate_limit", aggregateBy: "ip", windowSize: 60, windowLimit: 40 }
};

const userAgent = "6cunzhang9/anime-recommend (https://github.com/6cunzhang9/anime-recommend)";

function toReference(item) {
  return {
    provider: "bangumi", provider_id: String(item.id),
    canonical_url: `https://bgm.tv/subject/${item.id}`,
    title_display: (item.name_cn || item.name).slice(0, 160),
    title_canonical: (item.name || item.name_cn).slice(0, 160),
    media_type: "unknown", lookup_status: "matched",
    year: /^\d{4}/.exec(item.date || "")?.[0] || ""
  };
}

function isAnime(item) {
  return item?.type === 2 && Number.isSafeInteger(item.id) && Boolean(item.name_cn || item.name);
}

async function relatedAnime(id) {
  const signal = AbortSignal.timeout(2400);
  const items = new Map();
  let root;
  let next = id;
  for (let hop = 0; hop < 3 && next; hop++) {
    const response = await fetch(`https://api.bgm.tv/v0/subjects/${next}/subjects`, {
      headers: { "User-Agent": userAgent }, signal
    });
    if (!response.ok) break;
    const data = await response.json();
    if (!Array.isArray(data)) break;
    const related = data.filter((item) => isAnime(item) && /^(前传|前作|续集|番外篇|总集篇|不同演绎)$/.test(item.relation));
    for (const item of related) items.set(item.id, toReference(item));
    const earlier = related.find((item) => /^(前传|前作)$/.test(item.relation) && item.id !== id && item.id !== next);
    if (earlier && root?.provider_id !== String(earlier.id)) {
      root = toReference(earlier);
      next = earlier.id;
    } else next = null;
  }
  return jsonResponse({ ok: true, items: [...items.values()].slice(0, 20), root });
}

export default async function handler(req) {
  const params = new URL(req.url).searchParams;
  const related = params.get("related");
  if (related !== null) {
    if (!/^\d{1,12}$/.test(related)) return errorResponse(400, "作品编号无效");
    try { return await relatedAnime(Number(related)); }
    catch { return errorResponse(502, "暂时无法读取作品关系"); }
  }
  const keyword = params.get("q")?.trim() || "";
  if (!keyword || keyword.length > 120) return errorResponse(400, "请输入 1–120 字的作品名");
  try {
    const response = await fetch("https://api.bgm.tv/v0/search/subjects?limit=10", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": userAgent
      },
      body: JSON.stringify({ keyword, sort: "match", filter: { type: [2], nsfw: false } }),
      signal: AbortSignal.timeout(4000)
    });
    if (!response.ok) throw new Error(`Bangumi returned ${response.status}`);
    const { data } = await response.json();
    if (!Array.isArray(data)) throw new Error("Unexpected Bangumi search response");
    const items = data.filter(isAnime).slice(0, 10).map(toReference);
    return jsonResponse({ ok: true, items });
  } catch (error) {
    console.warn("Bangumi lookup failed:", error.message);
    return errorResponse(502, "暂时无法连接 Bangumi");
  }
}
