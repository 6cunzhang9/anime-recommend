import watch from "../../watch-model.js";
import v4 from "../../v4-validation.js";
import { digest, RequestError } from "../shared/auth.mjs";
import { getAnime, userAgent } from "../shared/bangumi.mjs";
import { errorResponse, getResponsesStore, jsonResponse } from "../shared/store.mjs";

export const config = { path: "/api/external-comments", method: "GET",
  rateLimit: { action: "rate_limit", aggregateBy: "ip", windowSize: 60, windowLimit: 20 } };

async function fetchJson(url, headers = {}) {
  const response = await fetch(url, { headers: { "User-Agent": userAgent, ...headers }, signal: AbortSignal.timeout(3600) });
  if (!response.ok) throw new Error(`Source returned ${response.status}`);
  return response.json();
}

function candidates(rows) {
  const selected = [];
  const seenUrls = new Set();
  const seenText = new Set();
  const blocks = (value) => new Set(Array.from({ length: Math.min(2400, value.length - 1) }, (_, i) => value.slice(i, i + 2)));
  const nearlySame = (left, right) => {
    if (Math.min(left.length, right.length) < 40 || Math.min(left.length, right.length) / Math.max(left.length, right.length) < 0.8) return false;
    const a = blocks(left);
    const b = blocks(right);
    const common = [...a].filter((chunk) => b.has(chunk)).length;
    return common * 2 / (a.size + b.size) >= 0.9;
  };
  for (const row of rows.sort((a, b) => b.likes - a.likes)) {
    const clean = row.text.replace(/<[^>]*>/g, " ");
    const normalized = watch.normalize(clean);
    if (!normalized || row.likes <= 0 || seenUrls.has(row.url) || seenText.has(normalized) || [...seenText].some((previous) => nearlySame(previous, normalized))) continue;
    const tags = watch.abstract(clean);
    seenUrls.add(row.url);
    seenText.add(normalized);
    selected.push({ source: row.source, url: row.url, likes: row.likes, tags });
    if (selected.length >= 5) break;
  }
  return selected;
}

async function kitsu(ref) {
  if (!ref.year) return [];
  const headers = { Accept: "application/vnd.api+json" };
  const titles = [...new Set([ref.title_canonical, ref.title_display].filter(Boolean))];
  const wanted = new Set(titles.map(watch.normalize));
  const find = async (title) => {
    const query = new URLSearchParams({ "filter[text]": title, "page[limit]": "10" });
    const result = await fetchJson(`https://kitsu.app/api/edge/anime?${query}`, headers);
    return (result.data || []).filter(({ id, attributes }) => {
    const aliases = [attributes?.canonicalTitle, attributes?.slug, ...Object.values(attributes?.titles || {}), ...(attributes?.abbreviatedTitles || [])];
    return /^\d+$/.test(id) && +String(attributes?.startDate || "").slice(0, 4) === ref.year &&
      aliases.some((title) => wanted.has(watch.normalize(title))) &&
      !attributes?.nsfw && (!["tv", "movie", "ova", "ona"].includes(ref.media_type) || !attributes?.subtype || String(attributes.subtype).toLowerCase() === ref.media_type);
    });
  };
  const attempts = await Promise.allSettled(titles.map(find));
  if (attempts.every(({ status }) => status === "rejected")) throw attempts[0].reason;
  const matches = new Set(attempts.flatMap((item) => item.status === "fulfilled" ? item.value.map(({ id }) => id) : []));
  if (matches.size !== 1) return [];
  const id = [...matches][0];
  const filters = new URLSearchParams({ "filter[mediaId]": id, "filter[mediaType]": "Anime", sort: "-likesCount", "page[limit]": "20" });
  const reviews = await fetchJson(`https://kitsu.app/api/edge/reviews?${filters}`, headers).catch(() =>
    fetchJson(`https://kitsu.app/api/edge/anime/${id}/reviews?sort=-likesCount&page%5Blimit%5D=20`, headers));
  return (reviews.data || []).filter(({ id, attributes }) => /^\d+$/.test(id) && !attributes?.spoiler &&
      typeof (attributes?.content || attributes?.review) === "string")
    .map(({ id, attributes }) => ({
      source: "Kitsu", url: `https://kitsu.app/reviews/${id}`,
      likes: Number(attributes.likesCount || attributes.likes_count || attributes.upVotesCount || 0), text: attributes.content || attributes.review
    }));
}

async function bangumi(ref) {
  // The public v0 catalogue has no short-comment feed. A deployment can supply a licensed JSON endpoint.
  const endpoint = process.env.BANGUMI_COMMENT_FEED;
  if (!endpoint || !["bangumi", "bangumi-series"].includes(ref.provider)) return null;
  const url = new URL(endpoint);
  if (url.protocol !== "https:") return [];
  url.searchParams.set("subject_id", ref.provider_id);
  const response = await fetchJson(url);
  return (Array.isArray(response.data) ? response.data : []).slice(0, 40).flatMap((row) => {
    if (!row || row.spoiler || typeof row.text !== "string") return [];
    const link = new URL(`https://bgm.tv/subject/${ref.provider_id}/comments`);
    if (/^\d+$/.test(row.id)) link.hash = `comment_${row.id}`;
    return [{ source: "Bangumi", url: link.href, likes: Number(row.likes) || 0, text: row.text }];
  });
}

export default async function handler(req) {
  try {
    const params = new URL(req.url).searchParams;
    let ref = v4.validateExternalRef({
      provider: params.get("provider"), provider_id: params.get("id"), title_display: params.get("title"),
      title_canonical: params.get("name"), year: params.get("year"), media_type: params.get("format")
    }, true);
    if (["bangumi", "bangumi-series"].includes(ref.provider) && (!ref.year || ref.title_canonical === ref.title_display)) {
      const resolved = await getAnime(ref.provider_id).catch(() => null);
      if (resolved) ref = v4.validateExternalRef(resolved, true);
    }
    const links = ["bangumi", "bangumi-series"].includes(ref.provider)
      ? [{ source: "Bangumi", url: `https://bgm.tv/subject/${ref.provider_id}/comments` }] : [];
    const store = getResponsesStore();
    const key = `external-insights/v2/${digest(JSON.stringify([ref.provider, ref.provider_id, ref.title_canonical, ref.year, ref.media_type]))}.json`;
    const cached = await store.get(key, { type: "json" });
    if (cached && Date.now() - cached.time < (cached.items.length ? 6 * 3600000 : 5 * 60000)) {
      return jsonResponse({ ok: true, ...cached, links });
    }
    const sources = await Promise.allSettled([bangumi(ref), kitsu(ref)]);
    const items = candidates(sources.flatMap((item) => item.status === "fulfilled" && item.value ? item.value : []));
    const unavailable = sources.some(({ status }) => status === "rejected");
    const previous = unavailable && cached?.items.length && Date.now() - cached.time < 48 * 3600000 ? cached.items : [];
    const output = { items: items.length ? items : previous, time: Date.now(), unavailable };
    await store.setJSON(key, output);
    return jsonResponse({ ok: true, ...output, links });
  } catch (error) {
    if (error instanceof RequestError || error.status === 400) return errorResponse(error.status, error.message);
    console.error("External reviews:", error);
    return errorResponse(502, "暂时无法汇总站外讨论");
  }
}
