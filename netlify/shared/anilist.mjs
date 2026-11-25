// 轻量元数据适配层：AniList 只负责番名、别称、年份、制作厂商和系列关系。
// 所有查询按请求参数做进程内短时缓存，避免每次搜索都打外部 API。
import { digest } from "./auth.mjs";

const ENDPOINT = "https://graphql.anilist.co";
const USER_AGENT = "6cunzhang9/anime-recommend (https://github.com/6cunzhang9/anime-recommend)";
const memory = new Map();
const pending = new Map();
const FRESH = 1000 * 60 * 60 * 6;

const MEDIA_FIELDS = `
  id
  title { romaji native english }
  synonyms
  format
  seasonYear
  startDate { year }
  studios(isMain: true) { nodes { name } }
  genres
`;

function chineseTitle(media) {
  const names = [media.title?.native, media.title?.romaji, media.title?.english, ...(media.synonyms || [])].filter(Boolean);
  return names.find((name) => /[\u4e00-\u9fff]/.test(name) && !/[\u3040-\u30ff]/.test(name)) ||
    media.title?.native || media.title?.romaji || media.title?.english || "未命名";
}

export function toAniListReference(media) {
  if (!media?.id) return null;
  const year = media.startDate?.year || media.seasonYear || null;
  const rawFormat = String(media.format || "");
  const mediaType = rawFormat === "TV" || rawFormat === "TV_SHORT" ? "tv"
    : rawFormat === "MOVIE" ? "movie" : /OVA|OAD/.test(rawFormat) ? "ova"
      : /ONA|WEB/.test(rawFormat) ? "ona" : "unknown";
  const title = chineseTitle(media);
  return {
    provider: "anilist",
    provider_id: String(media.id),
    canonical_url: `https://anilist.co/anime/${media.id}`,
    title_display: title,
    title_canonical: media.title?.romaji || media.title?.native || title,
    aliases: [...new Set([media.title?.native, media.title?.romaji, media.title?.english, ...(media.synonyms || [])]
      .filter(Boolean))].slice(0, 20),
    media_type: mediaType,
    year: year ? String(year) : "",
    studio: media.studios?.nodes?.[0]?.name || "",
    genres: (media.genres || []).slice(0, 12),
    lookup_status: "matched",
    resolved_at: new Date().toISOString()
  };
}

async function query(query, variables) {
  const hash = digest(JSON.stringify({ query, variables }));
  if (pending.has(hash)) return pending.get(hash);
  const cached = memory.get(hash);
  if (cached && Date.now() - cached.time < FRESH) return cached.value;
  const request = (async () => {
    const response = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", "User-Agent": USER_AGENT },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(5200)
    });
    if (!response.ok) throw new Error(`AniList ${response.status}`);
    const payload = await response.json();
    if (payload.errors?.length) throw new Error(payload.errors[0].message || "AniList 查询失败");
    memory.set(hash, { time: Date.now(), value: payload.data });
    if (memory.size > 240) memory.delete(memory.keys().next().value);
    return payload.data;
  })();
  pending.set(hash, request);
  try { return await request; }
  finally { pending.delete(hash); }
}

export async function searchAniList(keyword, { limit = 12 } = {}) {
  const search = String(keyword || "").trim();
  if (!search) return [];
  const data = await query(`query($search:String,$limit:Int){Page(perPage:$limit){media(search:$search,type:ANIME,isAdult:false,sort:SEARCH_MATCH){${MEDIA_FIELDS}}}}`,
    { search, limit: Math.min(20, Math.max(1, limit)) });
  return (data?.Page?.media || []).map(toAniListReference).filter(Boolean);
}

export async function animeDetails(id) {
  if (!/^\d{1,12}$/.test(String(id || ""))) return null;
  const data = await query(`query($id:Int){Media(id:$id,type:ANIME){${MEDIA_FIELDS} description(asHtml:false)}}`, { id: Number(id) });
  if (!data?.Media) return null;
  return { ...toAniListReference(data.Media), summary: data.Media.description || "" };
}

const SERIES_RELATIONS = new Set(["PREQUEL", "SEQUEL", "PARENT", "SIDE_STORY", "SPIN_OFF", "ALTERNATIVE", "SUMMARY"]);

async function mediaRelations(id) {
  const data = await query(`query($id:Int){Media(id:$id,type:ANIME){${MEDIA_FIELDS}
    relations { edges { relationType node { ${MEDIA_FIELDS} } } }}}`, { id: Number(id) });
  const media = data?.Media;
  if (!media) return null;
  return {
    media,
    related: (media.relations?.edges || [])
      .filter((edge) => SERIES_RELATIONS.has(edge.relationType))
      .map((edge) => ({ relation: edge.relationType, media: edge.node }))
      .filter((edge) => edge.media?.id)
  };
}

export async function seriesForAniList(id) {
  const key = `series:${id}`;
  const cached = memory.get(key);
  if (cached && Date.now() - cached.time < FRESH) return cached.value;
  const rootData = await mediaRelations(id);
  if (!rootData) return { items: [], root: null };
  const items = new Map();
  const queue = [String(id)];
  const visited = new Set(queue);
  for (let depth = 0; depth < 2 && queue.length && items.size < 30; depth += 1) {
    const batch = queue.splice(0, 4);
    const results = await Promise.allSettled(batch.map((entry) => mediaRelations(entry)));
    for (const result of results) {
      if (result.status !== "fulfilled" || !result.value) continue;
      for (const { media } of result.value.related) {
        if (!media?.id || String(media.id) === String(id)) continue;
        const ref = toAniListReference(media);
        if (!ref) continue;
        items.set(ref.provider_id, ref);
        if (!visited.has(ref.provider_id)) {
          visited.add(ref.provider_id);
          queue.push(ref.provider_id);
        }
      }
    }
  }
  const all = [...items.values()];
  const root = [toAniListReference(rootData.media), ...all]
    .filter(Boolean).sort((left, right) => String(left.year || "9999").localeCompare(String(right.year || "9999")))[0]
    || toAniListReference(rootData.media);
  const value = { items: all.slice(0, 30), root };
  memory.set(key, { time: Date.now(), value });
  return value;
}
