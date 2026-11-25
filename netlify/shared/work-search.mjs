import catalogData from "../../catalog.js";
import watch from "../../watch-model.js";
import { animeDetails as anilistDetails, searchAniList, seriesForAniList } from "./anilist.mjs";
import { animeRelations, getAnime, searchAnime, searchCharacters } from "./bangumi.mjs";

const knownSeries = [
  { id: "29648", title: "中二病也要谈恋爱！", aliases: ["中二病", "中二病也要談戀愛", "chu2koi"],
    works: [["29648", "中二病也要谈恋爱！", "2012", "tv"], ["72942", "中二病也要谈恋爱！恋", "2014", "tv"],
      ["215425", "电影 中二病也要谈恋爱！-Take On Me-", "2018", "movie"], ["50331", "中二病也要谈恋爱！Lite", "2012", "ona"]],
    seasons: ["29648", "72942"] },
  { id: "13603", title: "罗小黑战记", aliases: ["罗小黑", "羅小黑", "羅小黑戰記", "小黑战记"],
    works: [["13603", "罗小黑战记", "2011", "ona"], ["159725", "罗小黑战记", "2019", "movie"],
      ["442114", "罗小黑战记2", "2025", "movie"]], seasons: ["13603"] }
];
const aliases = new Map([
  ["石头门", "命运石之门"], ["巨人", "进击的巨人"], ["钢炼", "钢之炼金术师"],
  ["钢炼fa", "钢之炼金术师 fullmetal alchemist"], ["刀剑", "刀剑神域"],
  ["魔圆", "魔法少女小圆"], ["少战", "少女与战车"], ["轻音", "轻音少女"], ["物语", "化物语"],
  ["月刊少女", "月刊少女野崎君"], ["路人超能", "灵能百分百"], ["石纪元", "Dr.STONE"]
]);
const normalized = watch.normalize;
const relations = /^(前传|前作|续集|续作|番外篇|番外|总集篇|总集|不同演绎|剧场版|电影版|特别篇|衍生|主线故事|主线|正篇|外传)$/;
const names = (item) => [item.title_display, item.title_canonical, ...(item.aliases || [])].map(normalized);
const distinct = (items) => {
  const result = new Map();
  for (const item of items) {
    if (!item?.provider_id) continue;
    const provider = item.provider === "anilist-candidate-snapshot" ? "anilist" : item.provider || "unknown";
    const key = `${provider}:${item.provider_id}`;
    // 先出现的数据源优先；AniList 结果放在本地快照之前时保留更完整的元数据。
    if (!result.has(key)) result.set(key, item);
  }
  return [...result.values()];
};
const catalog = Array.isArray(catalogData?.ANIME_CATALOG) ? catalogData.ANIME_CATALOG : [];
const localSeries = new Map();

function localMediaType(format) {
  return /movie|剧场版|劇場版/i.test(format) ? "movie"
    : /ova|oad/i.test(format) ? "ova"
      : /ona|web/i.test(format) ? "ona" : "tv";
}

export function seriesHint(ref) {
  return localSeriesHint(ref);
}

function localSeriesHint(ref) {
  const title = String(ref?.title_display || ref?.title_canonical || "").trim();
  if (!title) return null;
  const match = title.match(/^(.*?)(?:\s*(?:第\s*[一二三四五六七八九十百零\d]+\s*[季期部篇]|season\s*\d+|s\d{1,2}|part\s*\d+|final season|最终季|完結篇|完结篇|剧场版|劇場版|电影版|電影版|after story|ova|oad|特别篇|特別篇|番外篇|总集篇|總集篇|外传|外傳|[\u4e00-\u9fff]{2,10}(?:篇|章)).*)$/i);
  if (!match?.[1]) return null;
  const base = match[1].replace(/[\s:：·・,，。!！?？\-—_]+$/g, "").trim();
  if (!base || base.length < 2 || normalized(base) === normalized(title)) return null;
  const id = `auto-${normalized(base).slice(0, 80)}`;
  if (!localSeries.has(id)) {
    if (localSeries.size > 500) localSeries.clear();
    localSeries.set(id, { id, title: base });
  }
  return localSeries.get(id);
}

function localReference(anime) {
  const id = String(anime?.anilistId || "");
  if (!/^\d{1,12}$/.test(id) || !anime?.title) return null;
  const ref = {
    provider: "anilist-candidate-snapshot",
    provider_id: id,
    canonical_url: anime.anilistUrl || `https://anilist.co/anime/${id}`,
    title_display: anime.title,
    title_canonical: anime.romaji || anime.english || anime.title,
    media_type: localMediaType(anime.format),
    lookup_status: "matched",
    year: anime.year ? String(anime.year) : "",
    aliases: watch.tags([anime.romaji, anime.english, anime.native, ...(anime.aliases || [])], 16),
    features: watch.tags([...(anime.tags || []), ...(anime.rawTagNames || [])], 16),
    summary: "",
    cover: ""
  };
  const hint = localSeriesHint(ref);
  if (hint) Object.assign(ref, { series_id: hint.id, series_title: hint.title });
  return ref;
}

function localSearch(query, limit = 12) {
  const wanted = normalized(query);
  if (!wanted) return [];
  const scored = [];
  for (const anime of catalog) {
    const titles = [anime.title, anime.romaji, anime.english, anime.native, ...(anime.aliases || [])]
      .map(normalized).filter(Boolean);
    if (!titles.length) continue;
    const exact = titles.includes(wanted);
    const prefix = titles.some((title) => title.startsWith(wanted) || wanted.startsWith(title));
    const contains = titles.some((title) => title.includes(wanted) || wanted.includes(title));
    if (!exact && !prefix && !contains) continue;
    const ref = localReference(anime);
    if (ref) scored.push({ ref, score: exact ? 100 : prefix ? 70 : 40 });
  }
  return scored.sort((a, b) => b.score - a.score || (Number(b.ref.year) || 0) - (Number(a.ref.year) || 0))
    .slice(0, limit).map(({ ref }) => ref);
}

function annotateSeries(items) {
  return items.map((item) => {
    if (item.series_id && item.series_title) return item;
    const hint = localSeriesHint(item);
    return hint ? { ...item, series_id: hint.id, series_title: hint.title } : item;
  });
}

function seasonRequest(query) {
  const value = query.trim();
  const match = value.match(/^(.*?)(?:\s*(?:第\s*)?([一二三四五六七八九十\d]+)\s*(?:季|期)|\s+(?:s(?:eason)?\s*)(\d{1,2})|([一二三四五六七八九十]))$/i);
  if (!match?.[1]) return { title: value, season: null };
  const numeral = match[2] || match[3] || match[4];
  const season = "〇一二三四五六七八九十".indexOf(numeral);
  return { title: match[1].trim(), season: season > 0 ? season : Number(numeral) || null };
}

function reference([id, title, year, media_type], group) {
  return { provider: "bangumi", provider_id: id, title_display: title, media_type, year, lookup_status: "matched",
    canonical_url: `https://bgm.tv/subject/${id}`, series_id: group.id, series_title: group.title };
}

function fromKnown(group) {
  const items = group.works.map((item) => reference(item, group));
  return { root: items[0], items, series: { id: group.id, title: group.title } };
}

export function knownGroup(id) {
  return knownSeries.find(({ works }) => works.some(([entry]) => entry === id));
}

const seriesCache = new Map();
const SERIES_TTL = 10 * 60 * 1000;

async function buildSeries(id) {
  const deadline = AbortSignal.timeout(4600);
  const items = new Map();
  const visited = new Set([String(id)]);
  const frontier = [String(id)];
  let firstError = null;
  for (let depth = 0; depth < 2 && frontier.length && items.size < 20; depth += 1) {
    const batch = frontier.splice(0, 4);
    const settled = await Promise.allSettled(batch.map((entry) => animeRelations(entry, deadline)));
    const next = [];
    let succeeded = 0;
    for (const outcome of settled) {
      if (outcome.status !== "fulfilled") {
        firstError ||= outcome.reason;
        continue;
      }
      succeeded += 1;
      for (const { relation, ...item } of outcome.value) {
        if (!relations.test(relation) || item.provider_id === String(id)) continue;
        if (!items.has(item.provider_id)) items.set(item.provider_id, item);
        if (!visited.has(item.provider_id)) {
          visited.add(item.provider_id);
          next.push(item.provider_id);
        }
      }
    }
    if (!succeeded && depth === 0 && !items.size) throw firstError || new Error("Bangumi 关系查询失败");
    frontier.push(...next.slice(0, 16));
  }
  if (!items.size) return { items: [], root: null };
  const all = [...items.values()];
  const root = all.slice().sort((left, right) => {
    const leftDate = String(left.date || left.year || "9999");
    const rightDate = String(right.date || right.year || "9999");
    return leftDate.localeCompare(rightDate) || (left.media_type === "tv" ? -1 : 1);
  })[0];
  return { items: all.slice(0, 20), root };
}

export async function seriesFor(id) {
  const known = knownGroup(id);
  if (known) return fromKnown(known);
  const key = String(id);
  const cached = seriesCache.get(key);
  if (cached && Date.now() - cached.time < SERIES_TTL) return cached.promise;
  const promise = buildSeries(key);
  seriesCache.set(key, { time: Date.now(), promise });
  if (seriesCache.size > 120) seriesCache.delete(seriesCache.keys().next().value);
  promise.catch(() => seriesCache.delete(key));
  return promise;
}

export async function lookupWorks(query, mode = "title", { fast = false } = {}) {
  if (mode === "character") return { items: await searchCharacters(query), exact: null };
  if (mode === "description") {
    const terms = query.split(/[，、,\s]+/).map((term) => term.trim()).filter(Boolean).slice(0, 5);
    const candidates = [searchAnime(query, { limit: 14 })];
    if (terms.length) candidates.push(searchAnime("", { filter: { tag: terms.slice(0, 2) }, limit: 12 }));
    const attempts = await Promise.allSettled(candidates);
    if (attempts.every(({ status }) => status === "rejected")) throw attempts[0].reason;
    return { items: distinct(attempts.flatMap((row) => row.status === "fulfilled" ? row.value : [])).slice(0, 16), exact: null };
  }

  const { title, season } = seasonRequest(query);
  const key = normalized(title);
  const group = knownSeries.find(({ title: canonical, aliases: terms }) => [canonical, ...terms].some((term) => normalized(term) === key));
  if (group && fast) {
    const result = fromKnown(group);
    const exact = season ? result.items.find(({ provider_id }) => provider_id === group.seasons[season - 1]) : null;
    return { ...result, exact: exact || null, intent: season ? "season" : "series" };
  }

  const local = annotateSeries(localSearch(query, fast ? 8 : 12));
  const localExact = local.filter((item) => names(item).includes(key) || names(item).includes(normalized(query)));
  if (fast && local.length) {
    return { items: local, exact: localExact.length === 1 ? localExact[0] : null, intent: "local" };
  }

  const expanded = aliases.get(key) || query;
  try {
    const anilist = await searchAniList(expanded, { limit: fast ? 8 : 14 });
    if (anilist.length) {
      const exact = anilist.filter((item) => names(item).includes(normalized(expanded)) || names(item).includes(normalized(query)));
      return {
        items: distinct([...anilist, ...local]),
        exact: exact.length === 1 ? exact[0] : null,
        intent: "anilist"
      };
    }
  } catch (error) {
    console.warn("AniList lookup:", error.message);
    if (group) {
      const result = fromKnown(group);
      const exact = season ? result.items.find(({ provider_id }) => provider_id === group.seasons[season - 1]) : null;
      return { ...result, exact: exact || null, intent: "local-fallback" };
    }
  }
  let remote = [];
  try {
    remote = await searchAnime(expanded, {
      limit: fast ? 8 : 12,
      signal: AbortSignal.timeout(fast ? 2000 : 3200)
    });
  } catch (error) {
    if (local.length) return { items: local, exact: null, fallback: true, intent: "local-fallback" };
    throw error;
  }
  remote = annotateSeries(remote);
  const exact = remote.filter((item) => names(item).includes(normalized(expanded)) || names(item).includes(normalized(query)));
  const items = distinct([...local, ...remote]);
  const groupForResult = knownGroup(items[0]?.provider_id);
  if (groupForResult) {
    const result = fromKnown(groupForResult);
    return { ...result, items: distinct([...result.items, ...items.map((item) => knownGroup(item.provider_id) === groupForResult
      ? { ...item, series_id: groupForResult.id, series_title: groupForResult.title } : item)]), exact: exact.length === 1 ? exact[0] : null };
  }
  return { items, exact: exact.length === 1 ? exact[0] : localExact.length === 1 ? localExact[0] : null };
}

export async function aniListSeries(id) {
  return seriesForAniList(id);
}

export async function aniListWorkDetails(id) {
  const [work, group] = await Promise.all([
    anilistDetails(id).catch(() => null),
    seriesForAniList(id).catch(() => null)
  ]);
  if (!work) return null;
  const root = group?.root || work;
  const series = { id: `anilist-${root.provider_id}`, title: root.title_display, provider: "anilist" };
  return {
    work: { ...work, series_id: series.id, series_title: series.title },
    series,
    items: distinct([root, ...(group?.items || []), work])
      .map((item) => ({ ...item, series_id: series.id, series_title: series.title }))
  };
}

export async function workDetails(id) {
  const [remote, group] = await Promise.all([getAnime(id).catch((error) => {
    if (!knownGroup(id)) throw error;
    return null;
  }), seriesFor(id).catch(() => null)]);
  const work = remote || group?.items.find((item) => item.provider_id === id);
  if (!work) return null;
  if (!group?.items.length) return { work, items: [] };
  const root = group.root || work;
  const series = group.series || { id: root.provider_id, title: root.title_display };
  return { work: { ...work, series_id: series.id, series_title: series.title }, series,
    items: distinct([root, ...group.items, work]).map((item) => ({ ...item, series_id: series.id, series_title: series.title })) };
}
