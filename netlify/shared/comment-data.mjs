import watch from "../../watch-model.js";
import { getResponsesStore } from "./store.mjs";
import { readAllRatings } from "./store.mjs";
import { readObservations } from "./observations.mjs";
import { listWatchlist } from "./watchlist.mjs";

const FEEDBACK_PREFIX = "comment-feedback/";
const CACHE_MS = 20_000;
let cache = null;
let cacheAt = 0;

const keyPart = (kind, id) => `${kind}:${id}`;
const refKey = (ref) => ref?.provider && ref?.provider_id ? `${ref.provider}:${ref.provider_id}` : "";
const titleKey = (ref) => watch.normalize(ref?.title_display || ref?.title_canonical || "");

function dimensionsOf(record) {
  return Object.fromEntries(Object.entries(record?.review?.dimensions || {})
    .filter(([id, value]) => watch.criteria[id] && Number.isFinite(Number(value)))
    .map(([id, value]) => [id, Number(value)]));
}

function matchWork(ref, watched) {
  if (!ref) return false;
  const key = refKey(ref);
  if (key && watched.keys.has(key)) return true;
  const title = titleKey(ref);
  return Boolean(title && watched.titles.has(title));
}

async function readFeedback() {
  const store = getResponsesStore();
  const { blobs } = await store.list({ prefix: FEEDBACK_PREFIX });
  const map = new Map();
  for (let index = 0; index < blobs.length; index += 50) {
    const rows = await Promise.all(blobs.slice(index, index + 50).map(async ({ key }) => {
      const parts = key.slice(FEEDBACK_PREFIX.length).split("/");
      if (parts.length !== 2 || !/^[a-f0-9]{32}\.json$/.test(parts[1])) return null;
      const record = await store.get(key, { type: "json" }).catch(() => null);
      if (!record || !Number.isFinite(Number(record.score))) return null;
      const comment = parts[0].replace(/^(observation|rating)-/, "$1:");
      return [comment, { owner: parts[1].replace(/\.json$/, ""), score: Number(record.score) }];
    }));
    for (const row of rows.filter(Boolean)) {
      if (!map.has(row[0])) map.set(row[0], []);
      map.get(row[0]).push(row[1]);
    }
  }
  return map;
}

function feedbackWeight(rows) {
  if (!rows?.length) return 1;
  return Math.max(.2, rows.reduce((sum, row) => sum + row.score, 0) / rows.length / 3);
}

export async function readCommentData() {
  if (cache && Date.now() - cacheAt < CACHE_MS) return cache;
  const [observations, ratings, feedback] = await Promise.all([
    readObservations().catch(() => []), readAllRatings().catch(() => []), readFeedback()
  ]);
  const comments = [];
  for (const observation of observations) {
    if (observation.ghost || !observation.work || !observation.comment?.trim()) continue;
    const id = observation.id;
    const key = keyPart("observation", id);
    comments.push({
      kind: "observation", id, key, owner: observation.owner, work: observation.work,
      text: observation.comment.trim().slice(0, 600), dimensions: dimensionsOf(observation),
      created: observation.created || observation.updated || "", feedback: feedback.get(key) || []
    });
  }
  for (const rating of ratings) {
    if (rating.ghost || !rating.accountOwner || !rating.external_ref || !rating.comment?.trim()) continue;
    const key = keyPart("rating", rating.id);
    comments.push({
      kind: "rating", id: rating.id, key, owner: rating.accountOwner, work: rating.external_ref,
      text: rating.comment.trim().slice(0, 600), dimensions: dimensionsOf(rating),
      created: rating.updated_at || rating.created_at || "", feedback: feedback.get(key) || []
    });
  }
  for (const comment of comments) comment.weight = feedbackWeight(comment.feedback);
  cache = comments;
  cacheAt = Date.now();
  return comments;
}

export function clearCommentCache() {
  cache = null;
  cacheAt = 0;
}

export async function readWorkCommentIndex() {
  const comments = await readCommentData();
  const byKey = new Map();
  const byTitle = new Map();
  const buckets = new Map();
  for (const comment of comments) {
    const key = refKey(comment.work) || titleKey(comment.work);
    if (!key) continue;
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { work: comment.work, comments: 0, dimensions: new Map() };
      buckets.set(key, bucket);
    }
    bucket.comments += 1;
    for (const [id, value] of Object.entries(comment.dimensions)) {
      const current = bucket.dimensions.get(id) || { count: 0, total: 0, weights: 0 };
      current.count += 1;
      current.total += value * comment.weight;
      current.weights += comment.weight;
      bucket.dimensions.set(id, current);
    }
  }
  for (const [key, bucket] of buckets) {
    if (!bucket.dimensions.size) continue;
    const totalCount = [...bucket.dimensions.values()].reduce((sum, row) => sum + row.count, 0);
    const dimensions = [...bucket.dimensions].map(([id, row]) => ({
      id, label: watch.criteria[id],
      value: Math.round(row.total / row.weights * 10) / 10,
      count: row.count,
      frequency: row.count / totalCount
    }));
    const frequencyTotal = dimensions.reduce((sum, row) => sum + row.frequency, 0);
    const aggregate = {
      comments: bucket.comments,
      dimensions,
      overall: Math.round(dimensions.reduce((sum, row) => sum + row.value * row.frequency, 0) /
        Math.max(.0001, frequencyTotal) * 10) / 10
    };
    byKey.set(key, aggregate);
    const title = titleKey(bucket.work);
    if (title && !byTitle.has(title)) byTitle.set(title, aggregate);
  }
  return { byKey, byTitle };
}

export function findWorkCommentAggregate(index, ref) {
  if (!index || !ref) return null;
  return index.byKey.get(refKey(ref)) || index.byTitle.get(titleKey(ref)) || null;
}

function watchedIndex(items) {
  const keys = new Set();
  const titles = new Set();
  for (const item of items.filter((row) => row.status === "watched")) {
    if (refKey(item.work)) keys.add(refKey(item.work));
    if (titleKey(item.work)) titles.add(titleKey(item.work));
  }
  return { keys, titles };
}

export async function pickCommentPrompt(user) {
  if (!user) return null;
  const watched = watchedIndex(await listWatchlist(user.id).catch(() => []));
  if (!watched.keys.size && !watched.titles.size) return null;
  const comments = await readCommentData();
  const candidates = comments.filter((comment) => comment.owner !== user.id &&
    matchWork(comment.work, watched) && !comment.feedback.some((row) => row.owner === user.id));
  if (!candidates.length) return null;
  const comment = candidates[Math.floor(Math.random() * candidates.length)];
  return {
    kind: comment.kind,
    id: comment.id,
    text: comment.text,
    work: {
      provider: comment.work.provider,
      provider_id: comment.work.provider_id,
      title_display: comment.work.title_display || comment.work.title_canonical || "一部作品",
      year: comment.work.year || null,
      studio: comment.work.studio || ""
    }
  };
}

export async function rateComment(user, kind, id, score) {
  if (!user || !["observation", "rating"].includes(kind) || !/^[a-zA-Z0-9_-]{6,100}$/.test(id)) return false;
  if (!Number.isInteger(score) || score < 1 || score > 5) return false;
  const watched = watchedIndex(await listWatchlist(user.id).catch(() => []));
  const comments = await readCommentData();
  const comment = comments.find((row) => row.kind === kind && row.id === id);
  if (!comment || comment.owner === user.id || !matchWork(comment.work, watched)) return false;
  const key = `${FEEDBACK_PREFIX}${kind}-${id}/${user.id}.json`;
  const result = await getResponsesStore().setJSON(key, { score, kind, id, created: new Date().toISOString() }, { onlyIfNew: true });
  clearCommentCache();
  return result.modified;
}
