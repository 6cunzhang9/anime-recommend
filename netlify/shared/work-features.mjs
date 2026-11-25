import v4 from "../../v4-validation.js";
import features from "../../features.js";
import watch from "../../watch-model.js";
import { readObservations } from "./observations.mjs";
import { readAllRatings } from "./store.mjs";
import { findWorkCommentAggregate, readWorkCommentIndex } from "./comment-data.mjs";

const CACHE_MS = 30_000;
let cache = null;
let cacheAt = 0;
let ratingCache = null;
let ratingCacheAt = 0;

const providerKey = (ref) => ref?.provider && ref?.provider_id ? `${ref.provider}:${ref.provider_id}` : "";
const titleKeys = (ref) => [...new Set([
  ref?.title_display, ref?.title_canonical, ...(ref?.aliases || [])
].filter(Boolean).map(watch.normalize).filter(Boolean))];

function addIndex(map, key, profile) {
  if (key && !map.has(key)) map.set(key, profile);
}

export function buildWorkProfiles(observations = []) {
  const buckets = new Map();
  for (const observation of observations) {
    const ref = observation.work;
    if (!ref?.provider_id) continue;
    const key = providerKey(ref) || v4.workIdentity(ref);
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { ref, axes: new Map(), tags: new Map(), count: 0 };
      buckets.set(key, bucket);
    }
    bucket.count += 1;
    bucket.ref = { ...bucket.ref, ...ref };
    for (const [axis, raw] of Object.entries(observation.axes || {})) {
      const value = Number(raw?.level ?? raw);
      if (!Number.isFinite(value) || !features.axisById.has(axis)) continue;
      const current = bucket.axes.get(axis) || { total: 0, count: 0 };
      current.total += value;
      current.count += 1;
      bucket.axes.set(axis, current);
    }
    for (const tag of observation.tags || []) {
      if (features.tagById.has(tag)) bucket.tags.set(tag, (bucket.tags.get(tag) || 0) + 1);
    }
  }

  const byKey = new Map();
  const byTitle = new Map();
  for (const [key, bucket] of buckets) {
    const profile = {
      found: true,
      work: bucket.ref,
      evidenceCount: bucket.count,
      axes: Object.fromEntries([...bucket.axes].map(([id, entry]) => [id, {
        value: Math.round(entry.total / entry.count),
        count: entry.count
      }])),
      tags: Object.fromEntries(bucket.tags)
    };
    byKey.set(key, profile);
    for (const title of titleKeys(bucket.ref)) addIndex(byTitle, title, profile);
  }
  return { byKey, byTitle };
}

export async function readWorkProfileIndex() {
  if (cache && Date.now() - cacheAt < CACHE_MS) return cache;
  const index = buildWorkProfiles(await readObservations().catch(() => []));
  cache = index;
  cacheAt = Date.now();
  return index;
}

export async function readWorkRatingIndex() {
  if (ratingCache && Date.now() - ratingCacheAt < CACHE_MS) return ratingCache;
  const rows = await readAllRatings().catch(() => []);
  const byKey = new Map();
  const byTitle = new Map();
  const add = (map, key, rating) => {
    if (!key) return;
    const current = map.get(key) || { total: 0, count: 0 };
    current.total += rating;
    current.count += 1;
    map.set(key, current);
  };
  for (const row of rows) {
    if (!Number.isFinite(Number(row.rating))) continue;
    const ref = row.external_ref || row.work_ref;
    const rating = Number(row.rating);
    add(byKey, providerKey(ref), rating);
    for (const title of titleKeys(ref)) add(byTitle, title, rating);
  }
  ratingCache = { byKey, byTitle };
  ratingCacheAt = Date.now();
  return ratingCache;
}

export function findWorkRating(index, ref) {
  if (!index || !ref) return null;
  let row = index.byKey.get(providerKey(ref));
  if (!row) {
    for (const title of titleKeys(ref)) {
      row = index.byTitle.get(title);
      if (row) break;
    }
  }
  if (!row) return null;
  return { value: Math.round(row.total / row.count * 10) / 10, count: row.count };
}

export function findWorkProfile(index, ref) {
  if (!index || !ref) return null;
  const direct = index.byKey.get(providerKey(ref));
  if (direct) return direct;
  for (const title of titleKeys(ref)) {
    const found = index.byTitle.get(title);
    if (found) return found;
  }
  return null;
}

export function publicWorkProfile(ref, profile, rating = null, comments = null) {
  const entry = profile || null;
  return {
    found: Boolean(entry?.found),
    evidenceCount: entry?.evidenceCount || 0,
    rating,
    comments,
    work: entry?.work || ref,
    axes: features.AXES.map((axis) => ({
      id: axis.id,
      label: axis.label,
      low: axis.low,
      high: axis.high,
      value: entry?.axes?.[axis.id]?.value ?? null,
      count: entry?.axes?.[axis.id]?.count || 0
    })),
    tags: features.TAGS.map((tag) => ({
      id: tag.id,
      label: tag.label,
      definition: tag.definition,
      count: entry?.tags?.[tag.id] || 0,
      present: Boolean(entry?.tags?.[tag.id])
    }))
  };
}

export function profileTags(profile) {
  if (!profile) return [];
  return features.TAGS.filter((tag) => profile.tags?.[tag.id]).map((tag) => tag.label);
}

export function profileAxes(profile) {
  if (!profile) return {};
  return Object.fromEntries(Object.entries(profile.axes || {}).map(([id, row]) => [id, row.value]));
}
