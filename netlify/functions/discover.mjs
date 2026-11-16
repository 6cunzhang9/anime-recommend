import watch from "../../watch-model.js";
import { getUser, readJson, RequestError } from "../shared/auth.mjs";
import { animeRelations, getAnime, searchAnime } from "../shared/bangumi.mjs";
import { discoverySignals, isAvoided, scoreWork } from "../shared/discovery-signals.mjs";
import { postFromRecord, readPostRecords } from "../shared/posts.mjs";
import { defaultTags, proposalKey } from "../shared/review-tags.mjs";
import { listWatchlist } from "../shared/watchlist.mjs";
import { errorResponse, getResponsesStore, jsonResponse, readAllRecords } from "../shared/store.mjs";

export const config = { path: "/api/discover", method: "POST",
  rateLimit: { action: "rate_limit", aggregateBy: "ip", windowSize: 60, windowLimit: 12 } };

const recentYear = 2012;
const axes = Object.keys(watch.criteria);
const matchesTag = (item, tag) => item.features.some((value) => watch.normalize(value) === watch.normalize(tag));
const rollup = (value) => Math.round(value * 10) / 10;
const getData = (id) => getAnime(id).catch(() => null);
const sideStory = /^(?:番外(?:篇|篇章)?|剧场版|劇場版|电影版|特别篇|特別篇|衍生(?:作品)?|外传|外傳)$/;
const workId = (item) => item.work.provider === "bangumi" ? item.work.provider_id : "";

function optionalNumber(value, min, max, label, integer = false) {
  if (value === undefined || value === null || value === "") return null;
  const number = Number(value);
  if (!["string", "number"].includes(typeof value) || (typeof value === "string" && !value.trim()) ||
    !Number.isFinite(number) || number < min || number > max || (integer && !Number.isInteger(number))) {
    throw new RequestError(400, `${label}必须在 ${min}–${max} 之间`);
  }
  return number;
}

async function communityFilters(settings) {
  const { dimensions = [], tags = [] } = settings;
  if (!Array.isArray(dimensions) || dimensions.length > 16 || !Array.isArray(tags) || tags.length > 16) {
    throw new RequestError(400, "最多添加 16 条评分条件和 16 个标签");
  }
  const conditions = dimensions.map((item) => {
    if (!item || ![...axes, "average"].includes(item.axis) || !["min", "max"].includes(item.operator) ||
      !Number.isInteger(item.score) || item.score < 1 || item.score > 10) {
      throw new RequestError(400, "评分条件需要维度及 1–10 的整数分值");
    }
    return item;
  });
  const selected = watch.tags(tags, 16).map(watch.normalize);
  const labels = new Set(defaultTags.map(watch.normalize));
  const store = getResponsesStore();
  const proposals = await Promise.all(selected.filter((label) => !labels.has(label))
    .map((label) => store.get(proposalKey(label), { type: "json" })));
  if (proposals.some((item) => item?.status !== "approved")) throw new RequestError(400, "只能用已通过审核的标签筛选");
  return { conditions, selected };
}

async function matchingPublicWorks(user, conditions, selected) {
  const posts = (await readPostRecords()).map(postFromRecord).filter((post) =>
    post && !post.moderated && post.target.owner !== user?.id).sort((a, b) => b.sortKey.localeCompare(a.sortKey));
  const byWork = new Map();
  for (const post of posts) {
    for (const { external_ref: ref, review } of post.works) {
      if (ref.provider !== "bangumi" || !ref.provider_id || !review) continue;
      const points = watch.scores(review.dimensions);
      if (!points) continue;
      if (!byWork.has(ref.provider_id)) byWork.set(ref.provider_id, new Map());
      const authors = byWork.get(ref.provider_id);
      if (!authors.has(post.target.owner)) authors.set(post.target.owner, { points, tags: watch.tags(review.tags) });
    }
  }
  const matches = new Map();
  for (const [id, ratings] of byWork) {
    const rows = [...ratings.values()];
    const scores = Object.fromEntries(axes.map((axis) => [axis, rows.reduce((sum, row) => sum + row.points[axis], 0) / rows.length]));
    scores.average = axes.reduce((sum, axis) => sum + scores[axis], 0) / axes.length;
    const tags = [...new Map(rows.flatMap((row) => row.tags).map((tag) => [watch.normalize(tag), tag])).values()];
    if (conditions.some(({ axis, operator, score }) => (operator === "min" ? scores[axis] < score : scores[axis] > score))) continue;
    if (selected.some((label) => !tags.some((tag) => watch.normalize(tag) === label))) continue;
    matches.set(id, { scores: Object.fromEntries(Object.entries(scores).map(([axis, value]) => [axis, rollup(value)])),
      count: rows.length, tags });
  }
  return matches;
}

async function watchedRelations(saved) {
  const watched = saved.filter(({ status }) => status === "watched");
  const direct = watched.filter(({ work }) => ["bangumi", "bangumi-series"].includes(work.provider))
    .map(({ work }) => work.provider_id);
  const legacy = watched.filter(({ work }) => !["bangumi", "bangumi-series"].includes(work.provider));
  const lookupDeadline = AbortSignal.timeout(2400);
  const resolved = await Promise.all(legacy.slice(0, 12).map(async ({ work }) => {
    const names = new Set([work.title_display, work.title_canonical].map(watch.normalize).filter(Boolean));
    const matches = await searchAnime(work.title_display, { limit: 8, signal: lookupDeadline }).catch(() => []);
    const exact = matches.filter((item) => (!work.year || item.year === work.year) &&
      [item.title_display, item.title_canonical].some((title) => names.has(watch.normalize(title))));
    return exact.length === 1 ? exact[0].provider_id : null;
  }));
  const ids = [...new Set([...direct, ...resolved.filter(Boolean)])];
  const deadline = AbortSignal.timeout(4000);
  const extras = new Set();
  let checked = 0;
  for (let start = 0; start < ids.length; start += 12) {
    if (deadline.aborted) break;
    const results = await Promise.allSettled(ids.slice(start, start + 12).map((id) => animeRelations(id, deadline)));
    for (let i = 0; i < results.length; i++) {
      if (results[i].status !== "fulfilled") continue;
      checked += 1;
      for (const { provider_id, relation } of results[i].value) {
        if (sideStory.test(relation)) extras.add(provider_id);
      }
    }
  }
  return { extras, checked, total: ids.length, watched: watched.length };
}

function listedWorks(entries) {
  const ids = new Set(entries.map(workId).filter(Boolean));
  const aliases = entries.filter(({ work }) => !["bangumi", "bangumi-series", "series"].includes(work.provider))
    .map(({ work }) => ({ year: work.year, names: [work.title_display, work.title_canonical].map(watch.normalize).filter(Boolean) }));
  return { ids, has(item) {
    if (ids.has(item.provider_id)) return true;
    const titles = [item.title_display, item.title_canonical].map(watch.normalize).filter(Boolean);
    return aliases.some(({ year, names }) => (!year || !item.year || Number(year) === Number(item.year)) && titles.some((title) => names.includes(title)));
  } };
}

export default async function handler(req) {
  try {
    const settings = await readJson(req, 10000);
    if (!settings || typeof settings !== "object" || Array.isArray(settings)) return errorResponse(400, "找番筛选无效");
    const user = await getUser(req);
    const minScore = optionalNumber(settings.scoreMin, 0, 10, "Bangumi 最低评分");
    const maxScore = optionalNumber(settings.scoreMax, 0, 10, "Bangumi 最高评分");
    const start = optionalNumber(settings.since, 1900, 2100, "最早年份", true);
    const end = optionalNumber(settings.until, 1900, 2100, "最晚年份", true);
    if (minScore !== null && maxScore !== null && minScore > maxScore) return errorResponse(400, "最低评分不可高于最高评分");
    if (start !== null && end !== null && start > end) return errorResponse(400, "最早年份不可晚于最晚年份");
    const { conditions, selected } = await communityFilters(settings);
    const useCommunity = conditions.length > 0 || selected.length > 0;
    const wantsExtras = settings.type === "side";
    const [saved, profile, evidence] = await Promise.all([
      user ? listWatchlist(user.id) : [],
      user ? readAllRecords(user.id).then((data) => data.at(-1)) : null,
      useCommunity ? matchingPublicWorks(user, conditions, selected) : null
    ]);
    const stats = watch.tastes(saved);
    const assessment = settings.assessment;
    const answers = assessment?.answers || profile?.answers;
    const signals = discoverySignals(answers, assessment?.preferences || profile?.preferences, stats);
    const features = signals.map(({ tag }) => tag);
    const reasons = new Set(watch.tags([...stats.topReasons,
      ...(profile?.actual_favorites || []).flatMap((item) => item.review?.tags || [])], 20).map(watch.normalize));
    const theme = watch.tags([settings.theme], 1)[0] || "";
    const rare = settings.popularity === "rare";
    const popular = settings.popularity === "popular";
    const filter = {};
    if (theme) filter.tag = [theme];
    const scores = [...(minScore === null ? [] : [`>=${minScore}`]), ...(maxScore === null ? [] : [`<=${maxScore}`])];
    if (scores.length) filter.rating = scores;
    const dates = [...(start === null ? [] : [`>=${start}-01-01`]), ...(end === null ? [] : [`<=${end}-12-31`])];
    if (dates.length) filter.air_date = dates;
    const limitedToRecent = start === null && (end === null || end >= recentYear) && !wantsExtras;
    const recentFilter = limitedToRecent ? { ...filter, air_date: [...dates, `>=${recentYear}-01-01`] } : filter;
    if (rare || popular) filter.rating_count = rare ? [">=1", "<=4500"] : [">4500"];

    const mode = settings.mode === "different" ? "different" : "similar";
    const sort = minScore !== null ? "score" : rare ? "rank" : "heat";
    const useType = ["ordinary", "movie"].includes(settings.type);
    const requests = [];
    if (!useCommunity && !wantsExtras) {
      requests.push(searchAnime("", { filter: recentFilter, sort, limit: 40 }));
      if (useType || maxScore !== null || theme) requests.push(searchAnime("", { filter: recentFilter, sort, limit: 40, offset: 40 }));
      if (!theme && mode === "similar") {
        for (const tag of features.slice(0, 3)) requests.push(searchAnime("", { filter: { ...recentFilter, tag: [tag] }, sort, limit: 20 }));
        if (limitedToRecent && features.length >= 3) requests.push(searchAnime("", {
          filter: { ...filter, air_date: [`<${recentYear}-01-01`], tag: features.slice(0, 2) }, sort: "score", limit: 12
        }));
      }
    }
    const wantedWorks = listedWorks(saved.filter((item) => item.status === "wanted"));
    const watchedWorks = listedWorks(saved.filter((item) => item.status === "watched"));
    const favorites = new Set((Array.isArray(assessment?.favorites) ? assessment.favorites : [])
      .filter((id) => typeof id === "string" && /^\d{1,12}$/.test(id)).slice(0, 8));
    const [search, series] = await Promise.all([
      Promise.allSettled(requests),
      wantsExtras ? watchedRelations(saved) : null
    ]);
    const base = search.flatMap((result) => result.status === "fulfilled" ? result.value : []);
    const candidateMap = new Map(base.map((item) => [item.provider_id, item]));
    const needsDetails = new Set(settings.queue === "exclude" ? [] : wantedWorks.ids);
    if (evidence) for (const id of evidence.keys()) needsDetails.add(id);
    if (series) for (const id of series.extras.keys()) needsDetails.add(id);
    const missing = [...needsDetails].filter((id) => !watchedWorks.ids.has(id) &&
      (!evidence || evidence.has(id)) && (!series || series.extras.has(id)) &&
      (!candidateMap.has(id) || useType && candidateMap.get(id).media_type === "unknown"));
    if (useType) for (const item of candidateMap.values()) {
      if (item.media_type === "unknown" && !needsDetails.has(item.provider_id) && !watchedWorks.ids.has(item.provider_id)) missing.push(item.provider_id);
    }
    const details = await Promise.all(missing.slice(0, 50).map(getData));
    for (const item of details.filter(Boolean)) candidateMap.set(item.provider_id, item);
    if (search.length && search.every(({ status }) => status === "rejected") && !candidateMap.size ||
        missing.length && !details.some(Boolean) && !candidateMap.size) {
      return errorResponse(502, "Bangumi 暂时无法返回候选，请稍后重试");
    }
    if (series?.total && !series.checked) return errorResponse(502, "暂时无法读取 Bangumi 系列关系，请稍后重试");
    const candidates = [...candidateMap.values()].filter((item) => {
      const id = item.provider_id;
      if (watchedWorks.has(item) || favorites.has(id) || settings.queue === "exclude" && wantedWorks.has(item)) return false;
      if (isAvoided(item, answers)) return false;
      if (evidence && !evidence.has(id) || series && !series.extras.has(id)) return false;
      if (settings.type === "movie" && item.media_type !== "movie") return false;
      if (settings.type === "ordinary" && !["tv", "ova", "ona"].includes(item.media_type)) return false;
      if (theme && !matchesTag(item, theme) && !base.some((work) => work.provider_id === id)) return false;
      if (scores.length && (item.score === null || minScore !== null && item.score < minScore || maxScore !== null && item.score > maxScore)) return false;
      if (rare && (item.votes < 1 || item.votes > 4500) || popular && item.votes <= 4500) return false;
      return !dates.length || item.year && (start === null || +item.year >= start) && (end === null || +item.year <= end);
    });
    const ranked = candidates.map((item) => {
      const community = evidence?.get(item.provider_id);
      const { keywords: overlap, fit } = scoreWork(item, signals, community?.tags);
      const reasonMatches = (community?.tags || item.features).filter((tag) => reasons.has(watch.normalize(tag)));
      const wanted = wantedWorks.has(item);
      const likeness = fit + reasonMatches.length * 0.55;
      return { ...item, overlap, reasonMatches, wanted, ...(community && { community }),
        fit, older: limitedToRecent && Number(item.year) < recentYear,
        order: likeness * (mode === "different" ? -1 : 1) + (item.score || 5) * 0.35 };
    }).filter((item) => !item.older || Boolean(item.year) && (item.wanted && settings.queue === "prefer" ||
      mode === "similar" && item.overlap.length >= 3 && item.fit >= 4));
    ranked.sort((a, b) => (settings.queue === "prefer" ? Number(b.wanted) - Number(a.wanted) : 0) ||
      Number(a.older) - Number(b.older) || b.order - a.order || a.provider_id.localeCompare(b.provider_id));
    return jsonResponse({ ok: true, items: ranked.slice(0, 12).map(({ order, fit, ...item }) => item),
    series: series ? { checked: series.checked, total: series.total, watched: series.watched } : null });
  } catch (error) {
    if (error instanceof RequestError) return errorResponse(error.status, error.message);
    console.error("Discovery:", error);
    return errorResponse(500, "找番暂时不可用");
  }
}
