import watch from "../../watch-model.js";
import { RequestError } from "../shared/auth.mjs";
import { getAnime, userAgent } from "../shared/bangumi.mjs";
import { errorResponse, jsonResponse } from "../shared/store.mjs";
import { lookupWorks } from "../shared/work-search.mjs";

export const config = {
  path: "/api/photo-search",
  method: ["GET", "POST"],
  rateLimit: { action: "rate_limit", aggregateBy: "ip", windowSize: 60, windowLimit: 8 }
};

const MAX_BYTES = 480000;
const clean = (value) => typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, 120) : "";
const responses = (value) => Array.isArray(value) ? value : [];
const textClue = (text, source, mode = "title") => ({ text: clean(text), mode, source });

async function readImage(req) {
  const origin = req.headers.get("origin");
  if (origin && origin !== new URL(req.url).origin) throw new RequestError(403, "请求来源不正确。");
  if (req.headers.get("content-type")?.split(";")[0] !== "image/jpeg" || !req.body) {
    throw new RequestError(415, "请选择图片后再搜索。");
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of req.body) {
    size += chunk.byteLength;
    if (size > MAX_BYTES) throw new RequestError(413, "图片过大，请重新选择。");
    chunks.push(chunk);
  }
  const image = Buffer.concat(chunks);
  if (image[0] !== 255 || image[1] !== 216 || image[2] !== 255) throw new RequestError(400, "无法读取这张图片。");
  return new Blob([image], { type: "image/jpeg" });
}

async function getJson(url, init, signal) {
  const response = await fetch(url, { ...init, signal, redirect: "error",
    headers: { "User-Agent": userAgent, Accept: "application/json", ...init?.headers } });
  if (!response.ok) throw new Error("搜图服务请求失败");
  return response.json();
}

async function trace(image) {
  const data = await getJson("https://api.trace.moe/search?anilistInfo&cutBorders=1", {
    method: "POST", headers: { "Content-Type": image.type }, body: image
  }, AbortSignal.timeout(6000));
  if (data.error) throw new Error("trace.moe 搜索失败");
  const hits = new Map();
  for (const scene of responses(data.result)) {
    const media = scene?.anilist;
    if (!media?.id || media.isAdult || !(scene.similarity >= .88) || hits.has(media.id)) continue;
    const titles = [media.title?.native, media.title?.romaji, media.title?.english].map(clean).filter(Boolean);
    if (titles.length) hits.set(media.id, { ...textClue(titles[0], "trace.moe"), titles });
    if (hits.size >= 2) break;
  }
  return [...hits.values()];
}

function postId(links, hosts, pattern) {
  for (const link of responses(links)) {
    let url;
    try { url = new URL(link); }
    catch { continue; }
    if (url.protocol === "https:" && hosts.includes(url.hostname)) {
      const match = pattern.exec(url.pathname);
      if (match) return match[1];
    }
  }
  return null;
}

async function safeArtTags(id) {
  const post = await getJson(`https://danbooru.donmai.us/posts/${id}.json`, undefined, AbortSignal.timeout(3200)).catch(() => null);
  if (post?.rating !== "g") return [];
  const tags = (value) => clean(value).split(" ").map((tag) => tag.replace(/_+/g, " ").replace(/\s*\([^)]*\)$/, ""));
  return [
    ...tags(post.tag_string_copyright).filter((tag) => !["original", "crossover"].includes(tag)).slice(0, 2)
      .map((title) => textClue(title, "SauceNAO")),
    ...tags(post.tag_string_character).slice(0, 2).map((name) => textClue(name, "SauceNAO", "character"))
  ].filter(({ text }) => text.length >= 2);
}

async function sauce(image, key) {
  const form = new FormData();
  form.append("file", image, "image.jpg");
  form.set("api_key", key);
  form.set("output_type", "2");
  form.set("numres", "6");
  // Pixiv, Danbooru and general anime indices.
  form.set("dbmask", String((1 << 5) | (1 << 9) | (1 << 21)));
  const data = await getJson("https://saucenao.com/search.php", { method: "POST", body: form }, AbortSignal.timeout(6000));
  if (Number(data.header?.status) < 0) throw new Error("SauceNAO 搜索失败");
  const matches = responses(data.results).filter((hit) => Number(hit.header?.similarity) >= 72).slice(0, 4);
  const id = matches.map(({ data }) => postId(data?.ext_urls, ["danbooru.donmai.us"], /^\/posts\/(\d{1,12})\/?$/)).find(Boolean);
  const tags = id ? await safeArtTags(id) : [];
  return [...matches.flatMap(({ data, header }) => {
    const bangumi = postId(data?.ext_urls, ["bgm.tv", "bangumi.tv", "chii.in"], /^\/subject\/(\d{1,12})\/?$/);
    if (bangumi) return [{ ...textClue(data?.source || data?.title, "SauceNAO"), id: bangumi }];
    if (Number(header?.index_id) === 21) return [textClue(data?.source, "SauceNAO")];
    if (Number(header?.index_id) === 5 && data?.title) return [textClue(data.title, "SauceNAO", "auto")];
    return [];
  }), ...tags];
}

async function lens(image, key) {
  const signal = AbortSignal.timeout(8300);
  const form = new FormData();
  form.append("image", image, "image.jpg");
  form.set("api_key", key);
  const uploaded = await getJson("https://serpapi.com/image", { method: "POST", body: form }, signal);
  if (typeof uploaded.image_id !== "string" || !uploaded.image_id) throw new Error("Google Lens 图片上传失败");
  const query = new URLSearchParams({ engine: "google_lens", image_id: uploaded.image_id, api_key: key, safe: "active" });
  const data = await getJson(`https://serpapi.com/search.json?${query}`, undefined, signal);
  if (data.error) throw new Error("Google Lens 搜索失败");
  const rows = [...responses(data.exact_matches), ...responses(data.visual_matches)].slice(0, 8);
  return rows.flatMap((row) => {
    const title = clean(row?.title).split(/\s*[|｜]\s*|\s+[–—-]\s+/)[0];
    const id = postId([row?.link], ["bgm.tv", "bangumi.tv", "chii.in"], /^\/subject\/(\d{1,12})\/?$/);
    return id ? [{ ...textClue(title, "Google Lens"), id }] : title.length >= 2 ? [textClue(title, "Google Lens", "auto")] : [];
  });
}

function uniqueClues(clues) {
  return [...new Map(clues.filter(({ text, id }) => id || text.length >= 2)
    .map((clue) => [clue.id || `${clue.mode}:${watch.normalize(clue.text)}`, clue])).values()].slice(0, 8);
}

async function resolveClue(clue) {
  if (clue.id) {
    const work = await getAnime(clue.id);
    return work ? [work] : [];
  }
  if (clue.mode === "character") return (await lookupWorks(clue.text, "character")).items.slice(0, 4);
  for (const title of (clue.titles || [clue.text]).slice(0, 2)) {
    const data = await lookupWorks(title);
    if (data.exact) return [data.exact];
    if (data.items.length && clue.mode !== "auto") return data.items.slice(0, 3);
  }
  if (clue.mode === "auto") return (await lookupWorks(clue.text, "character")).items.slice(0, 3);
  return [];
}

export default async function handler(req) {
  const sauceKey = process.env.SAUCENAO_API_KEY?.trim();
  const lensKey = process.env.SERPAPI_API_KEY?.trim();
  const providers = ["trace.moe", ...(sauceKey ? ["SauceNAO"] : []), ...(lensKey ? ["Google Lens"] : [])];
  if (req.method === "GET") return jsonResponse({ ok: true, providers });
  try {
    const image = await readImage(req);
    const checks = await Promise.allSettled([trace(image), ...(sauceKey ? [sauce(image, sauceKey)] : [])]);
    const clues = checks.flatMap((row) => row.status === "fulfilled" ? row.value : []);
    let providersFailed = checks.filter(({ status }) => status === "rejected").length;
    if (lensKey && !clues.some(({ text, id, mode }) => id || text.length >= 2 && mode !== "auto")) {
      try { clues.unshift(...await lens(image, lensKey)); }
      catch { providersFailed++; }
    }
    if (providersFailed === providers.length) return errorResponse(502, "外部搜图服务暂时无法响应，请稍后再试。");
    const unique = uniqueClues(clues);
    const checked = await Promise.allSettled(unique.slice(0, 3).map(async (clue) =>
      (await resolveClue(clue)).map((work) => ({ ...work, image_source: clue.source }))));
    const works = checked.flatMap((row) => row.status === "fulfilled" ? row.value : []);
    return jsonResponse({ ok: true, providers, items: [...new Map(works.map((work) => [work.provider_id, work])).values()].slice(0, 8),
      clues: unique.map(({ text, source, mode }) => ({ text, source, mode })).filter(({ text }) => text),
      catalogUnavailable: checked.some(({ status }) => status === "rejected") });
  } catch (error) {
    if (error instanceof RequestError) return errorResponse(error.status, error.message);
    return errorResponse(502, "外部搜图暂时不可用，请稍后重试。");
  }
}
