import v4 from "../../v4-validation.js";
import watch from "../../watch-model.js";
import { digest, RequestError } from "./auth.mjs";
import { seriesForAniList } from "./anilist.mjs";
import { changeEntry } from "./records.mjs";
import { getResponsesStore } from "./store.mjs";
import { knownGroup, lookupWorks, seriesHint } from "./work-search.mjs";

const scope = (owner) => `watchlist/${owner}/`;
const indexKey = (owner) => scope(owner) + "_index.json";
const keyOf = (work) => digest(v4.workIdentity(work));
const byDate = (a, b) => String(b.updated).localeCompare(String(a.updated));
const migrations = new Map();

async function ensureIndex(owner, store) {
  const shared = await store.get(indexKey(owner), { type: "json" });
  if (shared) return shared;
  if (migrations.has(owner)) return migrations.get(owner);
  const migrate = (async () => {
    const { blobs } = await store.list({ prefix: scope(owner) });
    const items = {};
    const keys = blobs.filter(({ key }) => key !== indexKey(owner));
    for (let start = 0; start < keys.length; start += 25) {
      const rows = await Promise.all(keys.slice(start, start + 25).map(({ key }) => store.get(key, { type: "json" })));
      for (const row of rows.filter((value) => value?.work)) items[keyOf(row.work)] = row;
    }
    const index = { items };
    const result = await store.setJSON(indexKey(owner), index, { onlyIfNew: true });
    return result.modified ? index : await store.get(indexKey(owner), { type: "json" });
  })();
  migrations.set(owner, migrate);
  try { return await migrate; }
  finally { migrations.delete(owner); }
}

function decorate(item) {
  if (item.work.series_id && item.work.series_title) return item;
  if (item.work.provider === "bangumi") {
    const group = knownGroup(item.work.provider_id);
    if (group) return { ...item, work: { ...item.work, series_id: group.id, series_title: group.title } };
  }
  const hint = seriesHint(item.work);
  return hint ? { ...item, work: { ...item.work, series_id: hint.id, series_title: hint.title } } : item;
}

export async function listWatchlist(owner) {
  const index = await ensureIndex(owner, getResponsesStore());
  return Object.values(index?.items || {}).map(decorate).sort(byDate);
}

export async function watchedWork(owner, work) {
  const index = await ensureIndex(owner, getResponsesStore());
  return index?.items[keyOf(work)]?.status === "watched";
}

function entryFor(work, previous, params) {
  const review = watch.review(params.review);
  if (params.review && !review) throw new RequestError(400, "评价每项均需选择 1–10 分");
  const status = params.action === "rewatch" ? "watched" : ["wanted", "watched"].includes(params.status)
    ? params.status : previous?.status || "wanted";
  const count = params.action === "rewatch" ? (previous?.plays || 0) + 1
    : Number.isInteger(params.plays) ? params.plays : previous?.plays || 1;
  const members = Array.isArray(params.members) ? params.members.filter((key) => typeof key === "string" && /^\d{1,12}$/.test(key)).slice(0, 50) : [];
  const hint = !work.series_id ? seriesHint(work) : null;
  const storedWork = hint ? { ...work, series_id: hint.id, series_title: hint.title } : work;
  return {
    work: { ...previous?.work, ...storedWork },
    status,
    plays: status === "watched" ? Math.min(999, Math.max(1, count)) : 0,
    love: ["favorite", "like", "neutral", "dislike"].includes(params.love) ? params.love : previous?.love || "neutral",
    review: review || previous?.review || null,
    features: watch.tags([...(previous?.features || []), ...(work.features || []), ...watch.tags(params.features)], 16),
    members: [...new Set([...(previous?.members || []), ...members])].slice(0, 64),
    updated: new Date().toISOString()
  };
}

export async function changeWatchlist(owner, params) {
  let work = v4.validateExternalRef(params.work, true);
  if (["add", "save"].includes(params.action) && work.provider === "anilist" && !work.series_id) {
    const group = await seriesForAniList(work.provider_id).catch(() => null);
    if (group?.root) work = {
      ...work,
      series_id: `anilist-${group.root.provider_id}`,
      series_title: group.root.title_display
    };
  }
  const key = keyOf(work);
  const store = getResponsesStore();
  await ensureIndex(owner, store);
  if (!["remove", "save", "add", "rewatch"].includes(params.action)) throw new RequestError(400, "未知清单操作");
  const result = await changeEntry(store, indexKey(owner), (previous) => {
    const items = { ...previous?.items };
    if (params.action === "remove") delete items[key];
    else if (params.action === "add" && items[key]) return null;
    else items[key] = entryFor(work, items[key], params);
    return { items };
  });
  if (result.conflict) throw new RequestError(409, "清单已经变化，请重试");
  return result.record?.items[key] || null;
}

export async function importWatchlist(owner, lines, status) {
  if (!Array.isArray(lines) || !lines.length || lines.length > 8 || !["wanted", "watched"].includes(status) ||
      lines.some((title) => typeof title !== "string" || !title.trim() || title.length > 120)) throw new RequestError(400, "每批可匹配 1–8 条作品名");
  const matches = await Promise.all(lines.map(async (input) => {
    try {
      const result = await lookupWorks(input.trim(), "title", { fast: true });
      return { input, exact: result.exact, items: result.items.slice(0, 8), series: result.series || null, intent: result.intent };
    } catch {
      return { input, items: [], retry: true };
    }
  }));
  const store = getResponsesStore();
  await ensureIndex(owner, store);
  const result = await changeEntry(store, indexKey(owner), (previous) => {
    const items = { ...previous.items };
    for (const row of matches) {
      if (!row.exact) continue;
      const work = v4.validateExternalRef(row.exact, true);
      const key = keyOf(work);
      if (!items[key] || status === "watched" && items[key].status !== "watched") {
        items[key] = entryFor(work, items[key], { status, action: "add" });
      }
    }
    return { items };
  });
  if (result.conflict) throw new RequestError(409, "清单已变动，请重试");
  return matches.map((row) => row.exact
    ? { input: row.input, item: result.record.items[keyOf(v4.validateExternalRef(row.exact, true))] }
    : row);
}
