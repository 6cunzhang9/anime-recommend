import watch from "../../watch-model.js";
import { digest } from "./auth.mjs";
import { getResponsesStore } from "./store.mjs";

export const userAgent = "6cunzhang9/anime-recommend (https://github.com/6cunzhang9/anime-recommend)";
const headers = { "User-Agent": userAgent, "Content-Type": "application/json" };
const origin = "https://api.bgm.tv";
const pending = new Map();
const memory = new Map();
const freshFor = 1000 * 60 * 60 * 6;
const staleFor = 1000 * 60 * 60 * 48;

const localBudget = { window: 0, count: 0, retryAfter: 0 };
function allowRequest() {
  const now = Date.now();
  if (localBudget.retryAfter > now) return false;
  const window = Math.floor(now / 60000);
  if (localBudget.window !== window) {
    localBudget.window = window;
    localBudget.count = 0;
  }
  if (localBudget.count >= 60) return false;
  localBudget.count += 1;
  return true;
}

async function queryBangumi(path, { body, signal, ttl = freshFor } = {}) {
  const hash = digest(JSON.stringify([path, body]));
  if (pending.has(hash)) return pending.get(hash);
  const request = read();
  pending.set(hash, request);
  try { return await request; }
  finally { pending.delete(hash); }

  async function read() {
    const key = `external-cache/bangumi/${hash.slice(0, 3)}.json`;
    const now = Date.now();
    const store = getResponsesStore();
    const cached = memory.get(hash) || await store.get(key, { type: "json" }).catch(() => null);
    const matches = cached?.hash === hash;
    if (matches && cached.time + (cached.value == null || Array.isArray(cached.value) && !cached.value.length ? 300000 : ttl) > now) {
      return cached.value;
    }
    try {
      if (signal?.aborted || !allowRequest()) throw new Error("Bangumi 查询暂忙");
      const response = await fetch(origin + path, { headers, signal: signal || AbortSignal.timeout(4200),
        ...(body && { method: "POST", body: JSON.stringify(body) }) });
      if (response.status === 429) {
        const delay = Math.min(600, Math.max(15, Number(response.headers.get("retry-after")) || 60));
        localBudget.retryAfter = Math.max(localBudget.retryAfter, now + delay * 1000);
      }
      if (!response.ok && response.status !== 404) throw new Error(`Bangumi returned ${response.status}`);
      const value = response.status === 404 ? null : await response.json();
      const entry = { hash, time: now, value };
      memory.set(hash, entry);
      if (memory.size > 256) memory.delete(memory.keys().next().value);
      await store.setJSON(key, entry).catch(() => {});
      return value;
    } catch (error) {
      if (matches && cached.time + staleFor > now) return cached.value;
      throw error;
    }
  }
}

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
  const aliases = watch.tags(infobox.filter(({ key }) => /别名|別名|简称|簡稱/.test(key))
    .flatMap(({ value }) => Array.isArray(value) ? value.map((row) => row?.v) : [value]), 16);
  const cover = Object.values(item.images || {}).find((url) => typeof url === "string" && /^https:\/\/lain\.bgm\.tv\//.test(url)) || "";
  return {
    provider: "bangumi", provider_id: String(item.id), canonical_url: `https://bgm.tv/subject/${item.id}`,
    title_display: (item.name_cn || item.name).slice(0, 160), title_canonical: (item.name || item.name_cn).slice(0, 160),
    media_type: format, lookup_status: "matched", year: /^\d{4}/.exec(item.date || "")?.[0] || "",
    date: item.date || "", minutes: minutes > 0 && minutes <= 400 ? minutes : null, features,
    score: Number(item.rating?.score) || null, votes: Number(item.rating?.total) || 0, aliases, cover,
    summary: typeof item.summary === "string" ? item.summary.slice(0, 900) : "",
    episodes: Number(item.total_episodes || item.eps) || null
  };
}

export async function searchAnime(keyword, { sort = "match", filter = {}, limit = 16, offset = 0, signal = AbortSignal.timeout(4600) } = {}) {
  const result = await queryBangumi(`/v0/search/subjects?limit=${limit}&offset=${offset}`, {
    body: { keyword, sort, filter: { ...filter, type: [2], nsfw: false } },
    signal
  });
  const data = result?.data;
  if (!Array.isArray(data)) throw new Error("Unexpected Bangumi result");
  return data.filter(isAnime).map(toReference);
}

export async function animeRelations(id, signal = AbortSignal.timeout(2600)) {
  if (!/^\d{1,12}$/.test(id)) return [];
  const data = await queryBangumi(`/v0/subjects/${id}/subjects`, { signal });
  if (data === null) return [];
  if (!Array.isArray(data)) throw new Error("Unexpected Bangumi relations");
  return data.filter(isAnime).map((item) => ({ ...toReference(item), relation: item.relation }));
}

export async function getAnime(id) {
  if (!/^\d{1,12}$/.test(id)) return null;
  const data = await queryBangumi(`/v0/subjects/${id}`, { signal: AbortSignal.timeout(3200) });
  return isAnime(data) ? toReference(data) : null;
}

export async function searchCharacters(keyword) {
  const result = await queryBangumi("/v0/search/characters?limit=4", { body: { keyword } });
  const rows = await Promise.allSettled((result?.data || []).slice(0, 3).map(({ id }) =>
    queryBangumi(`/v0/characters/${Number(id)}/subjects`)));
  return [...new Map(rows.flatMap((row) => row.status === "fulfilled" && Array.isArray(row.value) ? row.value : [])
    .filter(isAnime).map((item) => [item.id, toReference(item)])).values()].slice(0, 12);
}
