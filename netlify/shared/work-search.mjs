import watch from "../../watch-model.js";
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
const distinct = (items) => [...new Map(items.map((item) => [item.provider_id, item])).values()];

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

export async function seriesFor(id) {
  const known = knownGroup(id);
  if (known) return fromKnown(known);
  const deadline = AbortSignal.timeout(2750);
  const items = new Map();
  let root;
  const visited = new Set();
  let next = String(id);
  for (let hop = 0; hop < 4 && next && !visited.has(next); hop++) {
    visited.add(next);
    const rows = await animeRelations(next, deadline).catch((error) => {
      if (hop === 0) throw error;
      return [];
    });
    const related = rows.filter(({ relation }) => relations.test(relation));
    for (const { relation, ...item } of related) items.set(item.provider_id, item);
    const unvisited = related.filter(({ provider_id }) => !visited.has(provider_id));
    const origin = unvisited.find(({ relation }) => /^(主线故事|主线|正篇)$/.test(relation))
      || unvisited.find(({ relation }) => /^(前传|前作)$/.test(relation));
    if (!origin) break;
    next = origin.provider_id;
    root = items.get(next);
  }
  return { items: [...items.values()].slice(0, 25), root };
}

export async function lookupWorks(query, mode = "title") {
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
  if (group) {
    const result = fromKnown(group);
    const exact = season ? result.items.find(({ provider_id }) => provider_id === group.seasons[season - 1]) : null;
    return { ...result, exact: exact || null, intent: season ? "season" : "series" };
  }
  const expanded = aliases.get(key) || query;
  const items = await searchAnime(expanded, { limit: 12 });
  const exact = items.filter((item) => names(item).includes(normalized(expanded)) || names(item).includes(normalized(query)));
  const groupForResult = knownGroup(items[0]?.provider_id);
  if (groupForResult) {
    const result = fromKnown(groupForResult);
    return { ...result, items: distinct([...result.items, ...items.map((item) => knownGroup(item.provider_id) === groupForResult
      ? { ...item, series_id: groupForResult.id, series_title: groupForResult.title } : item)]), exact: exact.length === 1 ? exact[0] : null };
  }
  return { items, exact: exact.length === 1 ? exact[0] : null };
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
