/**
 * One-time ghost-data seeder.
 *
 * It reads public AniList metadata, aggregate tags and public review scores,
 * then writes structured records into the SAME Blobs/local-store prefixes used
 * by future users:
 *   ratings/<ghostOwner>/<ratingId>.json
 *   observations/<observationId>.json
 *
 * It does NOT store review text, usernames or avatars. Review author ids are
 * hashed into opaque ghost owners. The seed is data, not a runtime catalog.
 *
 * Usage:
 *   node scripts/seed-ghost-data.mjs --limit 200 --reviews 4
 *   node scripts/seed-ghost-data.mjs --limit 200 --reviews 4 --apply
 *   node scripts/seed-ghost-data.mjs --limit 200 --reviews 4 --apply --remote
 */
import { createHash, randomUUID } from "node:crypto";
import { readFile, writeFile, rename } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import features from "../features.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const catalog = require("../catalog.js").ANIME_CATALOG || [];
const ENDPOINT = "https://graphql.anilist.co";
const USER_AGENT = "anime-soul-lab-one-time-seed/1.0";
const NOW = new Date().toISOString();
const digest = (value) => createHash("sha256").update(String(value)).digest("hex");

const args = new Map();
for (let index = 2; index < process.argv.length; index += 1) {
  const value = process.argv[index];
  if (!value.startsWith("--")) continue;
  const key = value.slice(2);
  const next = process.argv[index + 1];
  if (next && !next.startsWith("--")) { args.set(key, next); index += 1; }
  else args.set(key, true);
}
const limit = Math.max(1, Math.min(500, Number(args.get("limit")) || 200));
const reviewLimit = Math.max(0, Math.min(8, Number(args.get("reviews")) || 4));
const apply = args.has("apply");
const remote = args.has("remote");
const remoteUrl = String(args.get("remote-url") || "").replace(/\/+$/, "");
const adminToken = String(args.get("admin-token") || process.env.ADMIN_TOKEN || "");
const fromPath = args.get("from") ? resolve(ROOT, String(args.get("from"))) : "";
const outPath = resolve(ROOT, String(args.get("out") || "data/ghost-seed.json"));

const QUERY = `
query($page:Int) {
  Page(page:$page, perPage:50) {
    media(type:ANIME, isAdult:false, sort:POPULARITY_DESC) {
      id
      title { romaji native english }
      synonyms
      format
      seasonYear
      startDate { year }
      studios(isMain:true) { nodes { name } }
      genres
      tags { name rank isMediaSpoiler }
      averageScore
      meanScore
      popularity
      favourites
      reviews(perPage:8) { nodes { userId rating score createdAt } }
    }
  }
}`;

const ID_QUERY = `
query($ids:[Int]) {
  Page(page:1, perPage:50) {
    media(type:ANIME, isAdult:false, id_in:$ids) {
      id
      title { romaji native english }
      synonyms
      format
      seasonYear
      startDate { year }
      studios(isMain:true) { nodes { name } }
      genres
      tags { name rank isMediaSpoiler }
      averageScore
      meanScore
      popularity
      favourites
      reviews(perPage:8) { nodes { userId rating score createdAt } }
    }
  }
}`;

async function anilist(body, signal = AbortSignal.timeout(12000)) {
  const response = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": USER_AGENT },
    body: JSON.stringify(body),
    signal
  });
  if (!response.ok) throw new Error(`AniList ${response.status}`);
  const payload = await response.json();
  if (payload.errors?.length) throw new Error(payload.errors[0].message || "AniList query failed");
  return payload.data?.Page?.media || [];
}

function query(page) {
  return anilist({ query: QUERY, variables: { page } });
}

function queryIds(ids) {
  return anilist({ query: ID_QUERY, variables: { ids } });
}

const wait = (ms) => new Promise((resolveWait) => setTimeout(resolveWait, ms));

function chooseTitle(media) {
  const names = [media.title?.native, media.title?.romaji, media.title?.english, ...(media.synonyms || [])].filter(Boolean);
  return names.find((name) => /[\u4e00-\u9fff]/.test(name) && !/[\u3040-\u30ff]/.test(name)) ||
    media.title?.native || media.title?.romaji || media.title?.english || "未命名";
}

function mediaType(format) {
  const value = String(format || "");
  return value === "TV" || value === "TV_SHORT" ? "tv" : value === "MOVIE" ? "movie"
    : /OVA|OAD/.test(value) ? "ova" : /ONA|WEB/.test(value) ? "ona" : "unknown";
}

function workRef(media) {
  const title = chooseTitle(media);
  return {
    provider: "anilist-candidate-snapshot",
    provider_id: String(media.id),
    canonical_url: `https://anilist.co/anime/${media.id}`,
    title_display: title,
    title_canonical: media.title?.romaji || media.title?.native || title,
    aliases: [...new Set([media.title?.native, media.title?.romaji, media.title?.english, ...(media.synonyms || [])]
      .filter(Boolean))].slice(0, 20),
    media_type: mediaType(media.format),
    lookup_status: "matched",
    resolved_at: NOW,
    year: media.startDate?.year || media.seasonYear || null,
    studio: media.studios?.nodes?.[0]?.name || "",
    genres: (media.genres || []).slice(0, 12)
  };
}

const AXIS_RULES = {
  pace: {
    high: [/action/i, /adventure/i, /thriller/i, /sports/i, /military/i, /racing/i],
    low: [/slice of life/i, /iyashikei/i, /episodic/i]
  },
  clue_inference: {
    high: [/mystery/i, /detective/i, /psychological/i, /crime/i],
    low: [/slice of life/i, /comedy/i, /school/i]
  },
  cast_spread: {
    high: [/ensemble cast/i, /episodic/i, /multiple protagonists/i],
    low: [/male protagonist/i, /female protagonist/i]
  },
  emotion_restraint: {
    high: [/drama/i, /psychological/i, /melodrama/i],
    low: [/comedy/i, /slapstick/i, /parody/i]
  },
  intensity: {
    high: [/action/i, /thriller/i, /horror/i, /tragedy/i, /war/i],
    low: [/slice of life/i, /iyashikei/i, /comedy/i]
  },
  comic_relief: {
    high: [/comedy/i, /slapstick/i, /parody/i, /gag/i],
    low: [/horror/i, /thriller/i, /tragedy/i]
  },
  romance_share: {
    high: [/romance/i, /love triangle/i, /harem/i],
    low: [/action/i, /adventure/i, /military/i]
  },
  payoff_span: {
    high: [/mystery/i, /epic/i, /time skip/i, /foreshadow/i],
    low: [/episodic/i, /slice of life/i, /comedy/i]
  }
};

const TAG_RULES = [
  [/ensemble cast/i, "ensemble_relation"],
  [/coming of age/i, "coming_of_age"],
  [/found family/i, "found_family"],
  [/episodic/i, "episodic"],
  [/unreliable narrator/i, "unreliable_narrator"],
  [/anti-?hero|morally ambiguous/i, "moral_gray"],
  [/world building/i, "world_rules"],
  [/foreshadow/i, "foreshadow_payoff"],
  [/rivalr/i, "rivalry"],
  [/romance|love triangle|harem/i, "romance_subplot"],
  [/comedy|parody|slapstick|gag/i, "comedy_balance"],
  [/surreal|visual arts|abstract/i, "visual_style"],
  [/music|sound/i, "sound_direction"],
  [/mentor/i, "mentor_lineage"],
  [/team|ensemble/i, "ensemble_relation"]
];

function deriveAxes(tags) {
  const rows = (tags || []).filter((tag) => !tag.isMediaSpoiler && Number(tag.rank) >= 35);
  const axes = {};
  for (const [axis, rules] of Object.entries(AXIS_RULES)) {
    let total = 0;
    let weight = 0;
    for (const tag of rows) {
      const name = String(tag.name || "");
      const w = Math.max(0, Math.min(100, Number(tag.rank) || 0)) / 100;
      if (w < .35) continue;
      if (rules.high.some((pattern) => pattern.test(name))) { total += 80 * w; weight += w; }
      else if (rules.low.some((pattern) => pattern.test(name))) { total += 20 * w; weight += w; }
    }
    if (weight >= .25) axes[axis] = Math.round(total / weight);
  }
  return axes;
}

function deriveTags(tags) {
  const result = [];
  for (const tag of tags || []) {
    if (tag.isMediaSpoiler) continue;
    const name = String(tag.name || "");
    const rule = TAG_RULES.find(([pattern]) => pattern.test(name));
    if (rule && !result.includes(rule[1])) result.push(rule[1]);
  }
  return result.slice(0, 12);
}

function reviewDate(value) {
  if (!value) return NOW;
  const date = new Date(Number(value) * 1000);
  return Number.isNaN(date.getTime()) ? NOW : date.toISOString();
}

function uuidFrom(value) {
  const hex = digest(value).slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

async function collect() {
  const media = new Map();
  for (let page = 1; (page - 1) * 50 < limit; page += 1) {
    const rows = await query(page);
    for (const item of rows) if (item?.id && !media.has(item.id)) media.set(item.id, item);
    console.log(`Fetched AniList page ${page}: ${rows.length} media (${media.size} unique)`);
    if (rows.length < 50) break;
    await wait(650);
  }

  // catalog 是本站实际可搜索、可推荐的基线作品；只补齐这些必要条目，
  // 不把 AniList 的全量动画库搬进来。
  const catalogIds = [...new Set(catalog.map((anime) => Number(anime.anilistId)).filter(Boolean))];
  const missingCatalog = catalogIds.filter((id) => !media.has(id));
  for (let index = 0; index < missingCatalog.length; index += 50) {
    const rows = await queryIds(missingCatalog.slice(index, index + 50));
    for (const item of rows) if (item?.id && !media.has(item.id)) media.set(item.id, item);
    console.log(`Fetched catalog batch ${Math.floor(index / 50) + 1}: ${rows.length} media`);
    if (index + 50 < missingCatalog.length) await wait(650);
  }

  const ghostOwner = digest("anilist-public-notes").slice(0, 32);
  const ghostName = "ghost_anilist_notes";
  const ratings = [];
  const observations = [];
  const works = [];

  for (const item of [...media.values()]) {
    const ref = workRef(item);
    const axes = deriveAxes(item.tags);
    const tags = deriveTags(item.tags);
    if (Object.keys(axes).length || tags.length) {
      const observation = {
        id: uuidFrom(`anilist-work-notes:${item.id}`),
        owner: ghostOwner,
        owner_username: ghostName,
        ghost: true,
        source: "anilist-public-snapshot",
        source_url: `https://anilist.co/anime/${item.id}`,
        work: ref,
        axes,
        tags,
        review: null,
        attachments: [],
        comment: "",
        created: NOW,
        updated: NOW
      };
      observations.push({ key: `observations/${observation.id}.json`, value: observation });
    }
    works.push({ id: item.id, title: ref.title_display, year: ref.year, studio: ref.studio,
      popularity: item.popularity || 0, averageScore: item.averageScore ?? null,
      axisCount: Object.keys(axes).length, tagCount: tags.length });

    const seen = new Set();
    for (const review of (item.reviews?.nodes || []).slice(0, reviewLimit)) {
      if (!review?.userId || seen.has(review.userId)) continue;
      seen.add(review.userId);
      const rawScore = Number(review.score ?? item.averageScore);
      if (!Number.isFinite(rawScore)) continue;
      const rating = Math.max(1, Math.min(5, Math.round(rawScore / 20)));
      const owner = digest(`anilist-user:${review.userId}`).slice(0, 32);
      const id = digest(`anilist-rating:${item.id}:${review.userId}`);
      const date = reviewDate(review.createdAt);
      const record = {
        schemaVersion: 4,
        id,
        record_format: "compact-v1",
        external_ref: ref,
        status: "seen",
        rating,
        sentiment: rating >= 4 ? "like" : rating <= 2 ? "dislike" : "neutral",
        reason_tags: [],
        comment: "",
        anonymous_use: false,
        public_review: false,
        watched: true,
        created_at: date,
        updated_at: date,
        received_at: date,
        ghost: true,
        source: "anilist-public-snapshot"
      };
      ratings.push({ key: `ratings/${owner}/${id}.json`, value: record });
    }
  }

  return {
    version: 1,
    generated_at: NOW,
    source: "AniList public GraphQL snapshot",
    ghost_owner: ghostOwner,
    counts: { media: works.length, observations: observations.length, ratings: ratings.length },
    works,
    ratings,
    observations
  };
}

async function writeLocal(bundle) {
  const file = resolve(ROOT, "data/site-blobs.json");
  let rows;
  try { rows = JSON.parse(await readFile(file, "utf8")); }
  catch (error) {
    if (error.code !== "ENOENT") throw error;
    rows = [];
  }
  const map = new Map(rows);
  let added = 0;
  for (const record of [...bundle.ratings, ...bundle.observations]) {
    if (map.has(record.key)) continue;
    map.set(record.key, { data: record.value, etag: randomUUID() });
    added += 1;
  }
  const temp = `${file}.tmp`;
  await writeFile(temp, JSON.stringify([...map]), "utf8");
  await rename(temp, file);
  return { added, total: map.size };
}

async function writeRemoteUrl(bundle) {
  if (!remoteUrl) throw new Error("--remote-url is required");
  if (!adminToken) throw new Error("--remote-url requires ADMIN_TOKEN or --admin-token");
  const rows = [...bundle.ratings, ...bundle.observations];
  let added = 0;
  let skipped = 0;
  for (let index = 0; index < rows.length; index += 50) {
    const batch = rows.slice(index, index + 50);
    const response = await fetch(`${remoteUrl}/api/ghost-import`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ records: batch })
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload?.ok) {
      throw new Error(payload?.error || `幽灵导入接口返回 ${response.status}`);
    }
    added += Number(payload.added) || 0;
    skipped += Number(payload.skipped) || 0;
    console.log(`Remote URL seeded ${Math.min(index + 50, rows.length)} / ${rows.length}`);
  }
  return { added, skipped, total: rows.length };
}

async function writeRemote(bundle) {
  const siteID = process.env.NETLIFY_SITE_ID;
  const token = process.env.NETLIFY_AUTH_TOKEN;
  if (!siteID || !token) throw new Error("--remote requires NETLIFY_SITE_ID and NETLIFY_AUTH_TOKEN");
  const { getStore } = await import("@netlify/blobs");
  const store = getStore({
    name: process.env.BLOBS_STORE_NAME || "anime-soul-responses",
    siteID,
    token,
    region: process.env.BLOBS_REGION || "ap-southeast-1"
  });
  let added = 0;
  const rows = [...bundle.ratings, ...bundle.observations];
  for (let index = 0; index < rows.length; index += 8) {
    const batch = rows.slice(index, index + 8);
    const results = await Promise.all(batch.map((record) =>
      store.setJSON(record.key, record.value, { onlyIfNew: true }).catch((error) => ({ error }))));
    for (const result of results) {
      if (result?.modified) added += 1;
      else if (result?.error) console.warn("Seed write failed:", result.error.message);
    }
    if (index % 80 === 0) console.log(`Remote seeded ${Math.min(index + 8, rows.length)} / ${rows.length}`);
  }
  return { added, total: rows.length };
}

const bundle = fromPath
  ? JSON.parse(await readFile(fromPath, "utf8"))
  : await collect();
if (!bundle?.ratings || !bundle?.observations) throw new Error("幽灵数据包格式不正确");
if (!fromPath) await writeFile(outPath, JSON.stringify(bundle, null, 2), "utf8");
console.log(`Bundle: ${fromPath || outPath}`);
console.log(`Seed counts: ${JSON.stringify(bundle.counts || {
  ratings: bundle.ratings.length, observations: bundle.observations.length
})}`);

if (apply) {
  const result = remoteUrl ? await writeRemoteUrl(bundle)
    : remote ? await writeRemote(bundle) : await writeLocal(bundle);
  console.log(`Applied ${result.added} new records (${result.total} considered).`);
  if (result.skipped) console.log(`Skipped ${result.skipped} existing records.`);
} else {
  console.log("Preview only. Add --apply for local store, --apply --remote for direct Netlify Blobs, or --apply --remote-url for the admin import function.");
}
