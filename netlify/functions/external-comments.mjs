import watch from "../../watch-model.js";
import v4 from "../../v4-validation.js";
import { digest, RequestError } from "../shared/auth.mjs";
import { userAgent } from "../shared/bangumi.mjs";
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
    const normalized = watch.normalize(row.text);
    if (!normalized || row.likes <= 0 || seenUrls.has(row.url) || seenText.has(normalized) || [...seenText].some((previous) => nearlySame(previous, normalized))) continue;
    const tags = watch.abstract(row.text);
    if (!tags.length) continue;
    seenUrls.add(row.url);
    seenText.add(normalized);
    selected.push({ source: row.source, url: row.url, likes: row.likes, tags });
    if (selected.length >= 5) break;
  }
  return selected;
}

async function kitsu(ref) {
  if (!ref.year) return [];
  const query = new URLSearchParams({ "filter[text]": ref.title_canonical, "page[limit]": "10" });
  const result = await fetchJson(`https://kitsu.app/api/edge/anime?${query}`, { Accept: "application/vnd.api+json" });
  const wanted = new Set([ref.title_canonical, ref.title_display].map(watch.normalize));
  const matches = (result.data || []).filter(({ id, attributes }) => {
    const aliases = [attributes?.canonicalTitle, ...Object.values(attributes?.titles || {}), ...(attributes?.abbreviatedTitles || [])];
    return /^\d+$/.test(id) && +String(attributes?.startDate || "").slice(0, 4) === ref.year &&
      aliases.some((title) => wanted.has(watch.normalize(title))) &&
      !attributes?.nsfw && (!["tv", "movie", "ova", "ona"].includes(ref.media_type) || !attributes?.subtype || String(attributes.subtype).toLowerCase() === ref.media_type);
  });
  if (matches.length !== 1) return [];
  const [media] = matches;
  const reviews = await fetchJson(`https://kitsu.app/api/edge/anime/${media.id}/reviews?sort=-likesCount&page%5Blimit%5D=20`,
    { Accept: "application/vnd.api+json" });
  return (reviews.data || []).filter(({ id, attributes }) => /^\d+$/.test(id) && !attributes?.spoiler)
    .map(({ id, attributes }) => ({
      source: "Kitsu", url: `https://kitsu.app/reviews/${id}`,
      likes: Number(attributes.likesCount || attributes.upVotesCount || 0), text: attributes.content || attributes.review || ""
    }));
}

async function bangumi(ref) {
  // The public v0 catalogue has no short-comment feed. A deployment can supply a licensed JSON endpoint.
  const endpoint = process.env.BANGUMI_COMMENT_FEED;
  if (!endpoint || ref.provider !== "bangumi") return [];
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
    const ref = v4.validateExternalRef({
      provider: params.get("provider"), provider_id: params.get("id"), title_display: params.get("title"),
      title_canonical: params.get("name"), year: params.get("year"), media_type: params.get("format")
    }, true);
    const links = ref.provider === "bangumi"
      ? [{ source: "Bangumi", url: `https://bgm.tv/subject/${ref.provider_id}/comments` }] : [];
    const store = getResponsesStore();
    const key = `external-insights/${digest(JSON.stringify([ref.provider, ref.provider_id, ref.title_canonical, ref.year, ref.media_type]))}.json`;
    const cached = await store.get(key, { type: "json" });
    if (cached && Date.now() - cached.time < (cached.items.length ? 6 * 3600000 : 20 * 60000)) {
      return jsonResponse({ ok: true, ...cached, links });
    }
    const sources = await Promise.allSettled([bangumi(ref), kitsu(ref)]);
    const items = candidates(sources.flatMap((item) => item.status === "fulfilled" ? item.value : []));
    const output = { items: items.length ? items : cached?.items || [], time: Date.now() };
    await store.setJSON(key, output);
    return jsonResponse({ ok: true, ...output, links });
  } catch (error) {
    if (error instanceof RequestError || error.status === 400) return errorResponse(error.status, error.message);
    console.error("External reviews:", error);
    return errorResponse(502, "暂时无法汇总站外讨论");
  }
}
