import watch from "../../watch-model.js";

export const userAgent = "6cunzhang9/anime-recommend (https://github.com/6cunzhang9/anime-recommend)";
const headers = { "User-Agent": userAgent, "Content-Type": "application/json" };
const origin = "https://api.bgm.tv";

export function isAnime(item) {
  return item?.type === 2 && Number.isSafeInteger(item.id) && !item.nsfw && Boolean(item.name_cn || item.name);
}

export function toReference(item) {
  const infobox = Array.isArray(item.infobox) ? item.infobox : [];
  const runtime = infobox.find(({ key }) => /^(片长|每集长|每话长|单集片长|时长)$/.test(key))?.value;
  const parts = typeof runtime === "string" ? runtime.match(/(?:(\d+)\s*(?:小时|時間|h))?\s*(\d+)?\s*(?:分钟|分|min)/i) : null;
  const minutes = parts ? Number(parts[1] || 0) * 60 + Number(parts[2] || 0) : null;
  const platform = String(item.platform || "");
  const format = /剧场|劇場|電影|电影|Movie/i.test(platform) ? "movie"
    : /\bTV\b/i.test(platform) ? "tv" : /\bO[AV]D\b|\bOVA\b/i.test(platform) ? "ova"
      : /\b(?:WEB|ONA)\b/i.test(platform) ? "ona"
        : /^(?:剧场版|劇場版)|(?:剧场版|劇場版)$/.test(item.name_cn || item.name || "") ? "movie" : "unknown";
  const features = watch.tags([...(item.meta_tags || []), ...(item.tags || []).map((tag) => typeof tag === "string" ? tag : tag.name)], 20);
  return {
    provider: "bangumi", provider_id: String(item.id), canonical_url: `https://bgm.tv/subject/${item.id}`,
    title_display: (item.name_cn || item.name).slice(0, 160), title_canonical: (item.name || item.name_cn).slice(0, 160),
    media_type: format, lookup_status: "matched", year: /^\d{4}/.exec(item.date || "")?.[0] || "",
    date: item.date || "", minutes: minutes > 0 && minutes <= 400 ? minutes : null, features,
    score: Number(item.rating?.score) || null, votes: Number(item.rating?.total) || 0
  };
}

export async function searchAnime(keyword, { sort = "match", filter = {}, limit = 16, offset = 0, signal = AbortSignal.timeout(4600) } = {}) {
  const response = await fetch(`${origin}/v0/search/subjects?limit=${limit}&offset=${offset}`, {
    method: "POST", headers, body: JSON.stringify({ keyword, sort, filter: { ...filter, type: [2], nsfw: false } }),
    signal
  });
  if (!response.ok) throw new Error(`Bangumi returned ${response.status}`);
  const { data } = await response.json();
  if (!Array.isArray(data)) throw new Error("Unexpected Bangumi result");
  return data.filter(isAnime).map(toReference);
}

export async function animeRelations(id, signal = AbortSignal.timeout(2600)) {
  if (!/^\d{1,12}$/.test(id)) return [];
  const response = await fetch(`${origin}/v0/subjects/${id}/subjects`, { headers, signal });
  if (!response.ok) throw new Error(`Bangumi relations returned ${response.status}`);
  const data = await response.json();
  if (!Array.isArray(data)) throw new Error("Unexpected Bangumi relations");
  return data.filter(isAnime).map((item) => ({ ...toReference(item), relation: item.relation }));
}

export async function getAnime(id) {
  if (!/^\d{1,12}$/.test(id)) return null;
  const response = await fetch(`${origin}/v0/subjects/${id}`, { headers, signal: AbortSignal.timeout(3100) });
  if (!response.ok) return null;
  const data = await response.json();
  return isAnime(data) ? toReference(data) : null;
}
