import { animeRelations, searchAnime } from "../shared/bangumi.mjs";
import { errorResponse, jsonResponse } from "../shared/store.mjs";

export const config = {
  path: "/api/anime-search",
  method: "GET",
  rateLimit: { action: "rate_limit", aggregateBy: "ip", windowSize: 60, windowLimit: 40 }
};

async function relatedAnime(id) {
  const signal = AbortSignal.timeout(2400);
  const items = new Map();
  let root;
  const visited = new Set();
  let next = String(id);
  for (let hop = 0; hop < 4 && next && !visited.has(next); hop++) {
    visited.add(next);
    const rows = await animeRelations(next, signal).catch((error) => {
      if (hop === 0) throw error;
      return [];
    });
    const related = rows.filter(({ relation }) => /^(前传|前作|续集|番外篇|番外|总集篇|总集|不同演绎|剧场版|电影版|特别篇|衍生|主线故事|主线|正篇)$/.test(relation));
    for (const { relation, ...item } of related) items.set(item.provider_id, item);
    const unvisited = related.filter(({ provider_id }) => !visited.has(provider_id));
    const origin = unvisited.find(({ relation }) => /^(主线故事|主线|正篇)$/.test(relation))
      || unvisited.find(({ relation }) => /^(前传|前作)$/.test(relation));
    if (!origin) break;
    next = origin.provider_id;
    root = items.get(next);
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
    const items = await searchAnime(keyword, { limit: 12 });
    return jsonResponse({ ok: true, items });
  } catch (error) {
    console.warn("Bangumi lookup failed:", error.message);
    return errorResponse(502, "暂时无法连接 Bangumi");
  }
}
